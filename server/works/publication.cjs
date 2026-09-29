const {PREFIX,hash,redis}=require('./store.cjs');
const {safeURL}=require('./permit.cjs');
const value=(job,key)=>job.extracted?.fields?.[key]?.value;
function duplicateKeys(job) {
  const keys=[];const municipality=value(job,'municipality');
  if(job.input?.qrURL)keys.push(PREFIX+'unique:url:'+hash(safeURL(job.input.qrURL)));
  for(const kind of ['permit','expediente'])if(municipality&&value(job,kind))keys.push(PREFIX+'unique:'+kind+':'+hash(municipality+':'+String(value(job,kind)).toLowerCase().replace(/\s+/g,'')));
  return keys;
}
async function findDuplicate(job){const keys=duplicateKeys(job);if(!keys.length)return null;const ids=await redis(['MGET',...keys]);return ids.find(Boolean)||null;}
function secondaryKeys(job){
  const municipality=job.location?.municipality||value(job,'municipality');if(!municipality)return [];
  const keys=(job.location?.parcels||[]).map(p=>PREFIX+'candidate:parcel:'+hash(municipality+':'+p.id));
  if(value(job,'address'))keys.push(PREFIX+'candidate:address:'+hash(municipality+':'+String(value(job,'address')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()));
  return keys;
}
async function findCandidates(job){const keys=secondaryKeys(job);return keys.length?(await redis(['SUNION',...keys])).slice(0,20):[];}
function eligibility(job){
  const issues=[...(job.extracted?.issues||[])];
  if(!job.extracted?.verified)issues.push('El formato del permiso y sus datos todavía necesitan revisión.');
  if(!value(job,'municipality')||!value(job,'address')||!(value(job,'permit')||value(job,'expediente')))issues.push('Faltan municipio, dirección o identificador del permiso.');
  if(!job.location)issues.push('Falta confirmar la parcela.');
  if(job.location&&value(job,'municipality')!==job.location.municipality)issues.push('El municipio del permiso no coincide con la ubicación.');
  const documented=job.extracted?.parcelIds||[];
  if(documented.length&&job.location){const ids=job.location.parcels.map(p=>p.id),matches=(id,ref)=>id===ref||id.replace(/-[a-f0-9]{16}$/,'')===ref;if(!documented.every(ref=>ids.some(id=>matches(id,ref)))||!ids.every(id=>documented.some(ref=>matches(id,ref))))issues.push('Los identificadores catastrales del permiso no coinciden con la selección.');}
  if(!Number.isFinite(value(job,'height'))||value(job,'height')<=0||value(job,'height')>300)issues.push('Falta una altura documentada en metros. Los pisos no se convierten en altura oficial.');
  if(!job.input?.qrURL)issues.push('Falta la fuente pública del permiso.');
  if(['queued','processing'].includes(job.status))issues.push('La lectura del permiso todavía no terminó.');
  if(job.extracted?.footprint&&job.location){const {footprintWithin}=require('./geometry.cjs');if(!footprintWithin(job.location.parcel.geometry,job.extracted.footprint.geometry.coordinates[0].slice(0,-1)))issues.push('La huella documentada no está contenida en las parcelas confirmadas.');}
  if(job.photo&&!job.photoReviewed)issues.push('La foto necesita revisión de datos personales antes de hacerse pública.');
  return [...new Set(issues)];
}
function makeWork(job){
  const now=new Date().toISOString();
  return {schemaVersion:1,id:job.id,status:'published',fields:job.extracted.fields,source:job.input.qrURL,documents:job.extracted.documents||[],queriedAt:job.extracted.queriedAt,createdAt:job.createdAt,publishedAt:now,updatedAt:now,location:job.location,height:value(job,'height'),footprint:job.extracted.footprint||null,volume:job.extracted.footprint?{kind:'documented',reason:'Volumen basado en la altura y la huella documentadas. Representación prismática; no modela detalles de fachada ni variaciones de altura.'}:{kind:'approximate',reason:'Extrusión de la parcela completa con altura documentada. Huella y retiros no disponibles; no representa la forma exacta del proyecto.'},photo:job.photo?{path:job.photo.pathname}:null};
}
async function publish(job,expectedRevision){
  const issues=eligibility(job);if(issues.length)throw Object.assign(Error(issues.join(' ')),{status:422});
  const work=makeWork(job),primary=duplicateKeys(job),secondary=secondaryKeys(job),keys=[...primary,...secondary],next={...job,status:'published',publishedId:job.id,revision:job.revision+1,updatedAt:work.updatedAt};
  // Ownership was checked by the handler; CAS and all uniqueness keys commit atomically.
  const script=`local old=redis.call('GET',KEYS[1]); if not old then return {'missing'} end; local j=cjson.decode(old); if j.status=='published' then return {'existing',j.publishedId} end; if j.revision~=tonumber(ARGV[1]) then return {'conflict'} end; local last=4+tonumber(ARGV[6]); for i=5,last do local id=redis.call('GET',KEYS[i]); if id then return {'duplicate',id} end end; redis.call('SET',KEYS[2],ARGV[2]); redis.call('SET',KEYS[1],ARGV[3]); redis.call('ZADD',KEYS[3],ARGV[4],ARGV[5]); redis.call('RPUSH',KEYS[4],old); for i=5,last do redis.call('SET',KEYS[i],ARGV[5]) end; for i=last+1,#KEYS do redis.call('SADD',KEYS[i],ARGV[5]) end; return {'published',ARGV[5]}`;
  const result=await redis(['EVAL',script,4+keys.length,PREFIX+'job:'+job.id,PREFIX+'public:'+job.id,PREFIX+'public-index',PREFIX+'history:'+job.id,...keys,expectedRevision,JSON.stringify(work),JSON.stringify(next),Date.now(),job.id,primary.length]);
  if(result[0]==='conflict')throw Object.assign(Error('El aporte cambió. Actualizá antes de publicar.'),{status:409});
  if(!['published','existing','duplicate'].includes(result[0]))throw Error('No se confirmó el guardado.');
  return {result:result[0],id:result[1]};
}
module.exports={duplicateKeys,findDuplicate,secondaryKeys,findCandidates,eligibility,makeWork,publish};
