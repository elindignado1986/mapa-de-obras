// Operator-only command. No public review endpoint and no client-controlled verification flag.
const fs=require('node:fs');
const {get,saveJob}=require('../server/works/store.cjs');
const {extractNormalized}=require('../server/works/permit.cjs');
(async()=>{
  const [id,file,...flags]=process.argv.slice(2);
  if(!/^[a-f0-9-]{36}$/.test(id||'')||!file||!flags.includes('--confirm-source-reviewed'))throw Error('Uso: node scripts/review-work.cjs ID permiso.json --confirm-source-reviewed [--confirm-photo-reviewed]');
  const job=await get('job',id);if(!job||['published','queued','processing'].includes(job.status))throw Error('Aporte no disponible para revisión.');
  const extracted=extractNormalized(JSON.parse(fs.readFileSync(file,'utf8')),job.input.qrURL);
  if(extracted.issues.length)throw Error(extracted.issues.join(' '));
  extracted.verified=true;extracted.reviewedAt=new Date().toISOString();extracted.reviewMethod='operator-public-source-review';
  job.extracted=extracted;job.status='extracted';job.stage='Datos de la fuente revisados; falta confirmación del aportante';job.issues=[];
  if(flags.includes('--confirm-photo-reviewed'))job.photoReviewed=true;
  await saveJob(job,job.revision);console.log('Revisión guardada. La obra aún no se publicó; requiere ubicación y consentimiento del aportante.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
