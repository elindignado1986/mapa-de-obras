import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
await build({stdin:{contents:"export {connected,mergeParcels} from './src/parcel-selection.js'; export {center,validRing,footprintWithin} from './src/geometry.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:'server/works/geometry.cjs'});
require('../scripts/build-works-index.cjs').buildWorksIndex(process.cwd());
const {safeURL,publicIP,fetchPermit,extractNormalized}=require('../server/works/permit.cjs');
const {eligibility,duplicateKeys,makeWork,publish}=require('../server/works/publication.cjs');
const {resolveParcels,proposeParcels}=require('../server/works/parcels.cjs');
const store=require('../server/works/store.cjs');
const handler=require('../api/works.js');
const rectangle={type:'Polygon',coordinates:[[[-58.6,-34.6],[-58.599,-34.6],[-58.599,-34.599],[-58.6,-34.599],[-58.6,-34.6]]]};
const document={schema:'mapa-permiso-v1',fields:{municipality:'tres-de-febrero',address:'Dirección sintética 123',permit:'TEST-1',height:27,floors:8,coveredArea:150,totalArea:200,projectFOT:1.2,allowedFOT:2,permitDate:'2026-09-01'},parcelIds:['fixture-1']};
const complete=()=>({id:'11111111-1111-4111-8111-111111111111',revision:3,status:'location-confirmed',createdAt:'2026-09-29T00:00:00.000Z',input:{qrURL:'https://municipio.example/permiso/1'},extracted:{...extractNormalized(document,'https://municipio.example/permiso/1'),verified:true},location:{municipality:'tres-de-febrero',parcels:[{id:'fixture-1',geometry:rectangle}],parcel:{id:'fixture-1',geometry:rectangle},point:[-58.5995,-34.5995]}});

test('QR targets reject local and credentialed destinations; only configured exact hosts are fetched',async()=>{
  for(const u of ['http://municipio.example','https://127.0.0.1/','https://[::1]/','https://localhost/','file:///etc/passwd','https://user:pass@municipio.example/','https://municipio.example:8443/'])assert.throws(()=>safeURL(u));
  assert.equal(safeURL('https://municipio.example/p?a=1#x'),'https://municipio.example/p?a=1');
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','169.254.169.254','192.168.2.3','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','198.18.0.1'])assert.equal(publicIP(ip),false,ip);
  assert.equal(publicIP('8.8.8.8'),true);
  process.env.WORKS_PERMIT_HOSTS='municipio.example';
  await assert.rejects(fetchPermit('https://municipio.example.evil.invalid/'),/adaptador municipal/);delete process.env.WORKS_PERMIT_HOSTS;
});
test('extraction preserves field provenance and separates normative indicators, dates and missing data',()=>{
  const data=extractNormalized(document,'https://municipio.example');assert.equal(data.fields.projectFOT.value,1.2);assert.equal(data.fields.allowedFOT.value,2);assert.equal(data.fields.startDate,undefined);assert.equal(data.fields.height.origin,'public-source');assert.equal(data.fields.height.source,'https://municipio.example');assert.equal(data.verified,false);
  const bad=extractNormalized({...document,fields:{...document.fields,height:'27 pisos',totalArea:100}},'https://municipio.example');assert.equal(bad.fields.height,undefined);assert.equal(bad.issues.length,2);
  assert.throws(()=>extractNormalized({schema:'other'},'https://municipio.example'),/Formato/);
});
test('publications require reviewed sources, confirmed matching parcels and a documented height',()=>{
  const job=complete();assert.deepEqual(eligibility(job),[]);
  for(const mutate of [j=>j.extracted.verified=false,j=>j.location=null,j=>j.extracted.fields.height=undefined,j=>j.location.municipality='hurlingham',j=>j.extracted.parcelIds=['different'],j=>j.photo={pathname:'private'},j=>j.status='processing']){const copy=structuredClone(job);mutate(copy);assert(eligibility(copy).length>0);}
  assert.equal(makeWork(job).volume.kind,'approximate');
  job.extracted.footprint={geometry:rectangle,origin:'public-source',source:job.input.qrURL};assert.equal(makeWork(job).volume.kind,'documented');assert.deepEqual(eligibility(job),[]);
  job.extracted.footprint.geometry={type:'Polygon',coordinates:[[[-58.7,-34.6],[-58.69,-34.6],[-58.69,-34.59],[-58.7,-34.59],[-58.7,-34.6]]]};assert(eligibility(job).some(x=>x.includes('huella')));
});
test('publication exposes no raw OCR, owner secret, or arbitrary contributor personal fields',()=>{
  const job=complete();job.ownerHash='secret';job.input.ocrText='unreviewed phone number';job.input.email='private';const publicWork=makeWork(job),serialized=JSON.stringify(publicWork);assert(!serialized.includes('secret'));assert(!serialized.includes('unreviewed'));assert(!serialized.includes('email'));assert.equal(publicWork.height,27);
});
test('deduplication keys normalize permit whitespace and URL fragments',()=>{
  const job=complete(),other=structuredClone(job);other.input.qrURL+='#fragment';other.extracted.fields.permit.value=' test-1 ';assert.deepEqual(duplicateKeys(job),duplicateKeys(other));
});
test('server uses cadastral geometries and rejects forged or repeated references',async()=>{
  const manifest=JSON.parse(fs.readFileSync('data/amba/municipality-manifest.json'));const m=manifest['tres-de-febrero'];const geometry=require('../server/works/geometry.cjs');
  const dir=`data/amba/tres-de-febrero/${m.version}`;if(!fs.existsSync(dir))return;
  const cells=fs.readdirSync(dir).filter(x=>x.endsWith('.json'));let feature;
  for(const cell of cells){feature=JSON.parse(fs.readFileSync(dir+'/'+cell)).features?.[0];if(feature)break;}
  const reference={id:String(feature.id),point:geometry.center(feature.geometry)};
  const result=await resolveParcels({municipality:'tres-de-febrero',parcels:[{...reference,geometry:rectangle}]});assert.deepEqual(result.parcels[0].geometry,feature.geometry);
  const proposal=await proposeParcels('tres-de-febrero',[reference.id]);assert(proposal.parcelIds.includes(reference.id));assert.equal(proposal.source,'cadastral-identifiers');
  await assert.rejects(resolveParcels({municipality:'tres-de-febrero',parcels:[reference,reference]}),/repetidas/);
  await assert.rejects(resolveParcels({municipality:'tres-de-febrero',parcels:[{...reference,id:'forged'}]}),/no encontrada/);
});
const response=()=>({code:200,setHeader(){},status(c){this.code=c;return this;},json(data){this.body=data;return this;}});
test('unconfigured registry reports unavailable distinctly from a real empty list',async()=>{const before=[process.env.KV_REST_API_URL,process.env.KV_REST_API_TOKEN];delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN;try{const res=response();await handler({method:'GET',url:'/api/works?action=list',headers:{}},res);assert.equal(res.body.enabled,false);assert.deepEqual(res.body.works,[]);}finally{for(const [i,k]of ['KV_REST_API_URL','KV_REST_API_TOKEN'].entries())if(before[i]!==undefined)process.env[k]=before[i];}});
test('cross-origin writes are rejected before Redis calls',async()=>{const res=response();await handler({method:'POST',url:'/api/works?action=create',headers:{origin:'https://evil.example',host:'mapa.example'},body:{}},res);assert.equal(res.code,403);});
test('publication sends one atomic CAS + unique-index transaction and handles retries/conflicts',async()=>{
  const original=global.fetch;process.env.KV_REST_API_URL='https://redis.example.invalid';process.env.KV_REST_API_TOKEN='synthetic';let result=['published',complete().id],calls=[];
  global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({result})};};
  try{const job=complete();assert.equal((await publish(job,3)).result,'published');assert.equal(calls[0][0],'EVAL');assert(calls[0][1].includes('j.revision'));assert(calls[0][1].includes("'duplicate'"));assert.equal(calls.length,1);result=['existing',job.id];assert.equal((await publish(job,3)).result,'existing');result=['conflict'];await assert.rejects(publish(job,3),/cambió/);result=['duplicate','22222222-2222-4222-8222-222222222222'];assert.equal((await publish(job,3)).result,'duplicate');}finally{global.fetch=original;delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN;}
});
test('storage failures never report publication success',async()=>{const original=global.fetch;process.env.KV_REST_API_URL='https://redis.example.invalid';process.env.KV_REST_API_TOKEN='synthetic';global.fetch=async()=>({ok:false});try{await assert.rejects(publish(complete(),3),/registro/);}finally{global.fetch=original;delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN;}});
