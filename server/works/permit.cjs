const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const FIELDS = {
  municipality:'Municipio', locality:'Localidad', address:'Dirección', permit:'Permiso', expediente:'Expediente',
  type:'Tipo de obra', destination:'Destino', permitStatus:'Estado según el permiso', height:'Altura (m)', floors:'Pisos',
  landArea:'Superficie de terreno (m²)', coveredArea:'Superficie cubierta (m²)', totalArea:'Superficie total (m²)',
  projectFOT:'FOT declarado (m²/m²)', allowedFOT:'FOT normativo (m²/m²)', projectFOS:'FOS declarado (m²/m²)', allowedFOS:'FOS normativo (m²/m²)',
  projectDensity:'Densidad declarada (hab/ha)', allowedDensity:'Densidad normativa (hab/ha)',
  architect:'Arquitecto', designer:'Proyectista', director:'Director de obra', company:'Constructora', otherResponsible:'Otros responsables y funciones',
  permitDate:'Fecha del permiso', startDate:'Fecha de inicio', endDate:'Fecha de finalización'
};
function safeURL(value) {
  let u;try{u=new URL(value);}catch{throw Error('Pegá un enlace HTTPS válido del permiso.');}
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.href.length>2000||net.isIP(u.hostname.replace(/[\[\]]/g,''))||!u.hostname.includes('.')) throw Error('El enlace debe ser HTTPS, sin credenciales ni dirección IP.');
  u.hash='';return u.href;
}
function publicIP(address) {
  // Conservative: reject IPv6 (including mapped IPv4), special-use IPv4 and local networks.
  if(net.isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
}
function allowedHosts(){return (process.env.WORKS_PERMIT_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);}
async function fetchPermit(value, hops=0) {
  const url=new URL(safeURL(value));
  if(!allowedHosts().includes(url.hostname))throw Error('Este destino todavía requiere un adaptador municipal validado. El aporte queda pendiente de revisión.');
  const addresses=await dns.lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some(a=>!publicIP(a.address)))throw Error('El destino no tiene una dirección pública autorizada.');
  const chosen=addresses[0];
  const response=await new Promise((resolve,reject)=>{
    const request=https.get(url,{headers:{Accept:'application/json,text/html;q=0.8','Accept-Encoding':'identity','User-Agent':'MapaDeSombras/1.0 (public permit reader)'},lookup:(hostname,options,callback)=>options.all?callback(null,[chosen]):callback(null,chosen.address,chosen.family)},r=>{
      const chunks=[];let size=0;
      r.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){request.destroy(Error('El documento supera 1 MB. Requiere revisión.'));return;}chunks.push(chunk);});
      r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text:Buffer.concat(chunks).toString('utf8')}));r.on('error',reject);
    });
    const timer=setTimeout(()=>request.destroy(Error('El sitio del permiso no respondió a tiempo.')),10000);
    request.on('close',()=>clearTimeout(timer));request.on('error',reject);
  });
  if([301,302,303,307,308].includes(response.status)){
    if(hops>=3||!response.headers.location)throw Error('El permiso tiene demasiadas redirecciones.');
    return fetchPermit(new URL(response.headers.location,url).href,hops+1);
  }
  if([401,403].includes(response.status))throw Error('El permiso requiere acceso privado o bloquea la consulta.');
  if(response.status!==200)throw Error('El sitio del permiso no está disponible.');
  return {...response,url:url.href};
}
function extractNormalized(document, source, now=new Date().toISOString()) {
  if(document?.schema!=='mapa-permiso-v1'||!document.fields||typeof document.fields!=='object')throw Error('Formato de permiso no compatible. Requiere un adaptador municipal.');
  const fields={},issues=[];
  for(const key of Object.keys(FIELDS)){
    const value=document.fields[key];if(value===null||value===undefined||value==='')continue;
    if(!['string','number'].includes(typeof value)||String(value).length>500){issues.push('Dato inválido: '+FIELDS[key]);continue;}
    const numeric=['height','floors','landArea','coveredArea','totalArea','projectFOT','allowedFOT','projectFOS','allowedFOS','projectDensity','allowedDensity'].includes(key);
    if(numeric&&(typeof value!=='number'||!Number.isFinite(value)||value<0||(key==='height'&&(value<=0||value>300))||(key==='floors'&&!Number.isInteger(value)))){issues.push('Valor o unidad no válida: '+FIELDS[key]);continue;}
    fields[key]={value,source,queriedAt:now,origin:'public-source'};
  }
  if(fields.coveredArea&&fields.totalArea&&fields.coveredArea.value>fields.totalArea.value)issues.push('La superficie cubierta supera la total; verificar conceptos.');
  const parcelIds=Array.isArray(document.parcelIds)?document.parcelIds.filter(x=>typeof x==='string'&&x.length<=100).slice(0,16):[];
  const documents=Array.isArray(document.documents)?document.documents.slice(0,10).flatMap(x=>{try{return [safeURL(x)];}catch{return [];}}):[];
  let footprint=null;
  if(document.footprint){
    const g=document.footprint;
    const {validRing}=require('./geometry.cjs');
    if(g.type==='Polygon'&&Array.isArray(g.coordinates)&&g.coordinates.length===1&&Array.isArray(g.coordinates[0])&&g.coordinates[0].length>=4&&g.coordinates[0].length<=1000&&g.coordinates[0].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=-60&&p[0]<=-57&&p[1]>=-36&&p[1]<=-33)&&JSON.stringify(g.coordinates[0][0])===JSON.stringify(g.coordinates[0].at(-1))&&validRing(g.coordinates[0].slice(0,-1)))footprint={geometry:g,source,queriedAt:now,origin:'public-source'};
    else issues.push('Huella documentada inválida o no compatible: se requiere un polígono simple georreferenciado.');
  }
  return {fields,parcelIds,documents,footprint,issues,source,queriedAt:now,adapter:'normalized-v1',verified:false};
}
async function processPermit(url) {
  const page=await fetchPermit(url);
  if(!String(page.headers['content-type']).includes('application/json'))throw Error('La página pública necesita un adaptador para su formato HTML o PDF. El aporte se conserva para revisión.');
  return extractNormalized(JSON.parse(page.text),page.url);
}
module.exports={FIELDS,safeURL,publicIP,fetchPermit,extractNormalized,processPermit};
