const fs=require('node:fs/promises');
const path=require('node:path');
async function readDataset(relative){
  if(process.env.WORKS_DATA_ORIGIN){
    const origin=new URL(process.env.WORKS_DATA_ORIGIN);
    if(origin.protocol!=='https:'||origin.username||origin.password)throw Error('WORKS_DATA_ORIGIN debe ser un origen HTTPS propio.');
    const response=await fetch(new URL('/data/amba/'+relative,origin),{redirect:'error',signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw Error('Catastro del servidor no disponible.');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>8*1024*1024)throw Error('Celda catastral demasiado grande.');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return JSON.parse(await fs.readFile(path.resolve(__dirname,'../../data/amba',relative),'utf8'));
}
// Read authoritative geometry from our dataset, never accept user geometry for publication.
async function resolveParcels(input) {
  const root=path.resolve(__dirname,'../../data/amba');
  const manifest=await readDataset('municipality-manifest.json');
  const municipality=input?.municipality;
  if(!['tres-de-febrero','hurlingham','castelar','san-isidro','ituzaingo'].includes(municipality)||!manifest[municipality]?.available)throw Error('Municipio sin parcelario habilitado.');
  const m=manifest[municipality];
  if(!Array.isArray(input.parcels)||input.parcels.length<1||input.parcels.length>16)throw Error('Seleccioná entre 1 y 16 parcelas contiguas.');
  const features=[];
  for(const p of input.parcels){
    if(typeof p.id!=='string'||p.id.length>150||!Array.isArray(p.point)||p.point.length!==2||!p.point.every(Number.isFinite)||p.point[0]<-60||p.point[0]>-57||p.point[1]<-36||p.point[1]>-33)throw Error('Referencia parcelaria inválida.');
    const cell=`${Math.floor(p.point[0]/m.cellSize)}_${Math.floor(p.point[1]/m.cellSize)}`;
    let data;try{data=await readDataset(municipality+'/'+m.version+'/'+cell+'.json');}catch{throw Error('No se pudo verificar la parcela contra el catastro del servidor.');}
    const f=data.features.find(f=>String(f.id)===p.id);if(!f)throw Error('Parcela no encontrada en el catastro original.');features.push(f);
  }
  if(new Set(features.map(f=>String(f.id))).size!==features.length)throw Error('Hay parcelas repetidas.');
  const {connected,mergeParcels,center}=require('./geometry.cjs');
  if(!connected(features))throw Error('Las parcelas deben compartir un lado.');
  const merged=mergeParcels(features);
  return {municipality,datasetVersion:m.version,parcels:features.map(f=>({id:String(f.id),geometry:f.geometry})),parcel:{id:String(merged.id),geometry:merged.geometry},point:center(merged.geometry),confirmedAt:new Date().toISOString(),origin:'user-confirmed'};
}
module.exports={resolveParcels};
async function proposeParcels(municipality,ids){
  if(!['tres-de-febrero','hurlingham','castelar','san-isidro','ituzaingo'].includes(municipality)||!Array.isArray(ids)||!ids.length||ids.length>16)return null;
  const manifest=await readDataset('municipality-manifest.json'),version=manifest[municipality]?.version;if(!version)return null;
  const {createHash}=require('node:crypto'),found=new Map();
  const shards=[...new Set(ids.map(id=>createHash('sha256').update(id).digest('hex').slice(0,2)))];
  const buckets=await Promise.all(shards.map(code=>readDataset('../works-index/'+municipality+'/'+version+'/'+code+'.json').catch(()=>null)));
  for(const id of ids){const matches=buckets.flatMap(bucket=>bucket?.[id]||[]);if(!matches.length)return null;for(const match of matches)found.set(match.id,match);}
  if(!found.size||found.size>16)return null;
  const parcels=[...found.values()];return {point:[parcels.reduce((n,p)=>n+p.point[0],0)/parcels.length,parcels.reduce((n,p)=>n+p.point[1],0)/parcels.length],parcelIds:parcels.map(p=>p.id),source:'cadastral-identifiers'};
}
module.exports.proposeParcels=proposeParcels;
