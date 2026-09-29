const store=require('../server/works/store.cjs');
const {extractSignText}=require('../server/works/sign-text.cjs');
const {previewFields}=require('../server/works/preview.cjs');
const {safeURL}=require('../server/works/permit.cjs');
const {eligibility,findDuplicate,findCandidates,publish}=require('../server/works/publication.cjs');
const {resolveParcels,proposeParcels}=require('../server/works/parcels.cjs');
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
function originOK(req){const origin=req.headers.origin;try{const u=new URL(origin);return process.env.WORKS_ORIGIN?origin===process.env.WORKS_ORIGIN:u.protocol==='https:'&&u.origin===origin&&u.host===req.headers.host;}catch{return false;}}
async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    const url=new URL(req.url,'https://local.invalid'),action=url.searchParams.get('action')||'list',id=url.searchParams.get('id');
    if(req.method==='GET'&&action==='config')return res.status(200).json({registry:store.configured(),photos:Boolean(process.env.BLOB_READ_WRITE_TOKEN),ocr:'browser',municipalAdapters:[]});
    if(req.method==='GET'&&action==='list'){
      if(!store.configured())return res.status(200).json({enabled:false,works:[],message:'El registro público todavía no está configurado. El simulador está disponible.'});
      const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
      const ids=await store.redis(['ZREVRANGE',store.PREFIX+'public-index',offset,offset+99]);
      const rows=ids.length?await store.redis(['MGET',...ids.map(id=>store.PREFIX+'public:'+id)]):[];
      return res.status(200).json({enabled:true,works:rows.filter(Boolean).map(JSON.parse),nextOffset:ids.length===100?offset+100:null});
    }
    if(req.method==='GET'&&action==='work'&&validId(id)){const work=await store.get('public',id);if(!work)return res.status(404).json({error:'Obra no encontrada.'});return res.status(200).json(work);}
    if(req.method==='GET'&&action==='job'&&validId(id)){const job=await store.owned(req,id);return res.status(200).json({...store.privateView(job),publicationIssues:eligibility(job)});}
    if(req.method==='GET'&&action==='proposal'&&validId(id)){const job=await store.owned(req,id);return res.status(200).json({proposal:await proposeParcels(job.extracted?.fields?.municipality?.value,job.extracted?.parcelIds)});}
    if(req.method==='GET'&&action==='photo'&&validId(id)){
      const work=await store.get('public',id);let path=work?.photo?.path;
      if(!path){const job=await store.owned(req,id);path=job.photo?.pathname;}
      if(!path)return res.status(404).json({error:'Foto no disponible.'});
      const {get}=await import('@vercel/blob');const blob=await get(path,{access:'private'});
      if(!blob||blob.statusCode!==200)throw Error('No se pudo recuperar la foto.');
      res.setHeader('Content-Type','image/jpeg');res.setHeader('Content-Disposition','inline');
      const {Readable}=require('node:stream');Readable.fromWeb(blob.stream).pipe(res);return;
    }
    if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
    if(!originOK(req))return res.status(403).json({error:'Origen no autorizado.'});
    await store.rateLimit(req);
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body||JSON.stringify(body).length>100000)throw Object.assign(Error('Aporte demasiado grande o inválido.'),{status:400});
    if(action==='create'){
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      if(!validId(body.id)||!/^[a-f0-9]{64}$/.test(token))throw Object.assign(Error('Clave de recuperación inválida.'),{status:400});
      const qrURL=!body.textOnly&&body.qrURL?safeURL(body.qrURL):null;
      const job=await store.createJob(body.id,token,{qrURL,ocrText:typeof body.ocrText==='string'?body.ocrText.slice(0,16000):'',ocrOrigin:'unverified-browser',parentWork:validId(body.parentWork)?body.parentWork:null});
      return res.status(200).json(store.privateView(job));
    }
    if(!validId(id))throw Object.assign(Error('Identificador inválido.'),{status:400});
    const job=await store.owned(req,id);
    if(action==='publish'&&job.status==='published')return res.status(200).json({result:'existing',id:job.publishedId});
    if(job.status==='published')throw Object.assign(Error('La obra ya es pública. Creá un aporte nuevo para conservar su historial.'),{status:409});
    if(body.revision!==job.revision)throw Object.assign(Error('El aporte cambió. Actualizá su estado.'),{status:409});
    if(action==='preview'){
      job.previewFields=previewFields(body.fields);
      await store.saveJob(job,body.revision);
      return res.status(200).json({...store.privateView(job),publicationIssues:eligibility(job)});
    }
    if(action==='process'){
      if(Array.isArray(body.detectedQR))job.input.detectedQR=body.detectedQR.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,2000));
      if(typeof body.ocrText==='string'){job.input.ocrText=body.ocrText.slice(0,16000);job.input.ocrEdited=body.ocrEdited===true;}
      job.signExtraction=extractSignText(job.input.ocrText||'',undefined,job.input.ocrEdited);
      if(body.textOnly===true||(!body.qrURL&&!job.input.qrURL)){
        job.status='review-required';job.stage='Texto del cartel leído; requiere revisión';
        job.issues=['Datos obtenidos del texto del cartel, sin verificar el permiso.',...job.signExtraction.issues];
        if(!Object.keys(job.signExtraction.fields).length)job.issues.push('No se reconocieron campos con suficiente claridad. Revisá el texto o reemplazá la foto.');
        await store.saveJob(job,body.revision);
        return res.status(200).json({...store.privateView(job),publicationIssues:eligibility(job)});
      }
      if(job.status==='processing')return res.status(200).json(store.privateView(job));
      if(job.status==='queued'){await store.saveJob(job,body.revision);await store.enqueue(id);return res.status(200).json(store.privateView(job));}
      if(body.qrURL)job.input.qrURL=safeURL(body.qrURL);
      job.status='queued';job.stage='Esperando lectura del permiso';job.issues=[];job.extracted={};job.location=null;
      await store.saveJob(job,body.revision);await store.enqueue(id);
      return res.status(202).json(store.privateView(job));
    }
    if(action==='locate'){
      job.location=await resolveParcels(body.location);job.status='location-confirmed';job.stage='Ubicación confirmada por el aportante';
      job.duplicateId=await findDuplicate(job);job.candidateIds=await findCandidates(job);
      await store.saveJob(job,body.revision);
      return res.status(200).json({...store.privateView(job),publicationIssues:eligibility(job)});
    }
    if(action==='publish'){
      if(body.publicConsent!==true)throw Object.assign(Error('Confirmá que la obra será visible públicamente.'),{status:400});
      const duplicate=await findDuplicate(job);if(duplicate)return res.status(200).json({result:'duplicate',id:duplicate});
      return res.status(200).json(await publish(job,body.revision));
    }
    return res.status(400).json({error:'Acción desconocida.'});
  }catch(error){return res.status(error.status||503).json({error:error.message||'Servicio temporalmente no disponible.'});}
}
module.exports=handler;
module.exports.originOK=originOK;
