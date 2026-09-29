const sharp=require('sharp');
const {owned,saveJob,rateLimit}=require('../server/works/store.cjs');
const {originOK}=require('./works.js');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
    if(!originOK(req))return res.status(403).json({error:'Origen no autorizado.'});
    if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Falta configurar BLOB_READ_WRITE_TOKEN con un almacén privado para guardar fotos.'});
    await rateLimit(req);
    const url=new URL(req.url,'https://local.invalid'),id=url.searchParams.get('id');
    if(!/^[a-f0-9-]{36}$/.test(id||''))return res.status(400).json({error:'Aporte inválido.'});
    const job=await owned(req,id),revision=Number(url.searchParams.get('revision'));
    if(job.revision!==revision||['published','processing','queued'].includes(job.status))return res.status(409).json({error:'Actualizá el aporte antes de cambiar la foto.'});
    let size=0;const chunks=[];
    if(Buffer.isBuffer(req.body)){size=req.body.length;chunks.push(req.body);}
    else for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024)throw Error('La foto supera 3 MB.');chunks.push(chunk);}
    if(size>3*1024*1024)throw Error('La foto supera 3 MB.');
    const source=Buffer.concat(chunks),metadata=await sharp(source,{limitInputPixels:24000000}).metadata();
    if(!['jpeg','png','webp'].includes(metadata.format)||metadata.pages>1)throw Error('Usá una foto JPG, PNG o WebP estática.');
    const image=await sharp(source,{limitInputPixels:24000000}).rotate().resize({width:2200,height:2200,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
    const {put,del}=await import('@vercel/blob');
    const blob=await put(`works/${id}/${require('node:crypto').randomUUID()}.jpg`,image,{access:'private',contentType:'image/jpeg',addRandomSuffix:false});
    const previous=job.photo;job.photo={pathname:blob.pathname,uploadedAt:new Date().toISOString()};job.photoReviewed=false;
    try{await saveJob(job,revision);}catch(e){await del(blob.pathname).catch(()=>{});throw e;}
    // Previous photos remain referenced in immutable history, never silently overwritten.
    return res.status(200).json({photo:true,revision:job.revision,replaced:Boolean(previous)});
  }catch(e){return res.status(e.status||400).json({error:e.message||'No se pudo guardar la foto.'});}
};
module.exports.config={api:{bodyParser:false}};
