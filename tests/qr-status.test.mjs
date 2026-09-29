import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{qrNotice}=require('../server/works/qr-status.cjs');

test('QR notices distinguish unreadable, unusable, multiple, pending and failed lookup',()=>{
 assert.equal(qrNotice({}), '');
 assert.match(qrNotice({input:{detectedQR:[]}}),/No se pudo leer el QR/);
 assert.match(qrNotice({input:{detectedQR:['texto']}}),/no contiene un enlace HTTPS/);
 assert.match(qrNotice({input:{detectedQR:['https://a.example','https://b.example']}}),/varios QR/);
 assert.match(qrNotice({status:'queued',input:{detectedQR:['https://a.example']}}),/consulta del permiso está pendiente/);
 assert.match(qrNotice({status:'processing'}),/Estamos consultando/);
 assert.match(qrNotice({qrStatus:'unavailable'}),/No pudimos consultar/);
 assert.match(qrNotice({qrStatus:'available'}),/Se pudo consultar/);
 assert.match(qrNotice({input:{qrURL:'https://a.example'}}),/disponibilidad no está confirmada/);
});

test('worker records lookup result, preserving OCR fallback on failure',async()=>{
 const store=require('../server/works/store.cjs'),permit=require('../server/works/permit.cjs'),publication=require('../server/works/publication.cjs');
 const original={redis:store.redis,get:store.get,saveJob:store.saveJob},processPermit=permit.processPermit,findDuplicate=publication.findDuplicate;
 const workerPath=require.resolve('../scripts/works-worker.cjs');
 try{
  for(const fail of [true,false]){
   const job={id:'fixture',revision:0,status:'queued',input:{qrURL:'https://fixture.example',ocrText:'Dirección: Prueba 123\nAltura: 20 m'}};
   store.redis=async command=>command[0]==='EVAL'?job.id:1;store.get=async()=>job;store.saveJob=async(j,rev)=>{assert.equal(j.revision,rev);j.revision++;};
   permit.processPermit=async()=>{if(fail)throw Error('Sitio inaccesible');return {fields:{},issues:[]};};publication.findDuplicate=async()=>null;
   delete require.cache[workerPath];const {tick}=require(workerPath);await tick();
   assert.equal(job.qrStatus,fail?'unavailable':'available');
   if(fail){assert.equal(job.signExtraction.fields.address.value,'Prueba 123');assert.match(qrNotice(job),/No pudimos consultar/);}
  }
 }finally{Object.assign(store,original);permit.processPermit=processPermit;publication.findDuplicate=findDuplicate;delete require.cache[workerPath];}
});
