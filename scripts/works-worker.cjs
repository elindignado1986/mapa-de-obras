// Run as a persistent external worker, never detach work inside a Vercel request.
const {PREFIX,redis,get,saveJob}=require('../server/works/store.cjs');
const {processPermit}=require('../server/works/permit.cjs');
const {findDuplicate}=require('../server/works/publication.cjs');
const {extractSignText}=require('../server/works/sign-text.cjs');
async function tick(){
  const now=Date.now();
  const id=await redis(['EVAL',"local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[1],'LIMIT',0,1); if #ids==0 then return false end; redis.call('ZADD',KEYS[1],ARGV[2],ids[1]); return ids[1]",1,PREFIX+'queue',now,now+120000]);
  if(!id)return false;
  let job=await get('job',id);if(!job||!['queued','processing'].includes(job.status)){await redis(['ZREM',PREFIX+'queue',id]);return true;}
  let revision=job.revision;
  job.status='processing';job.stage='Consultando permiso';await saveJob(job,revision);revision=job.revision;
  try{
    if(!job.input.qrURL)throw Error('No se pudo leer un QR. Reemplazá la foto o pegá el enlace del permiso.');
    job.extracted=await processPermit(job.input.qrURL);job.duplicateId=await findDuplicate(job);
    job.status='review-required';job.stage='Datos extraídos; requieren revisión';job.issues=job.extracted.issues;
  }catch(e){job.signExtraction=extractSignText(job.input.ocrText||'',undefined,job.input.ocrEdited);const hasText=Object.keys(job.signExtraction.fields).length>0;job.status=hasText?'review-required':'pending';job.stage=hasText?'Permiso inaccesible; texto del cartel disponible':'Aporte pendiente';job.issues=[e.message,...job.signExtraction.issues];}
  await saveJob(job,revision);await redis(['ZREM',PREFIX+'queue',id]);return true;
}
if(require.main===module)(async()=>{do{try{const worked=await tick();if(process.argv.includes('--once'))break;if(!worked)await new Promise(r=>setTimeout(r,5000));}catch(e){console.error('Worker:',e.message);if(process.argv.includes('--once')){process.exitCode=1;break;}await new Promise(r=>setTimeout(r,10000));}}while(true);})();
module.exports={tick};
