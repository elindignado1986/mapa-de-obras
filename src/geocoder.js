import castelarBoundary from '../data/context/castelar-boundary.json';
import {contains} from './geometry.js';
import {CONFIG} from '../config/app.js';
export class Geocoder{
 constructor(provider=new PhotonProvider()){this.provider=provider;this.last=0;this.cache=new Map();}
 async search(query,municipality,signal){if(query.trim().length<3)throw Error('Escribí una calle y altura.');const key=municipality+query.trim().toLowerCase();if(this.cache.has(key))return this.cache.get(key);const now=Date.now();if(now-this.last<1100)throw Error('Esperá un momento antes de buscar de nuevo.');this.last=now;const results=await this.provider.search(query,municipality,signal);this.cache.set(key,results);if(this.cache.size>50)this.cache.delete(this.cache.keys().next().value);return results;}
}
const normalize=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^partido de /,'').trim();
const streetName=value=>String(value||'').replace(/^\d+\s*[-–]\s*/,'').trim();
const streetWords=value=>normalize(streetName(value)).replace(/\bavdor\.?\b/g,'aviador').replace(/\bav\.?\b/g,'avenida').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
export function addressParts(query){
 const address=query.split(',')[0].trim(),match=address.match(/^(.*?)\s+(\d{1,6}[a-z]?(?:\s+bis)?)\.?$/i);
 return {street:match?match[1]:address,number:match?normalize(match[2]):null};
}
export function photonResults(features,query,municipality){
 const {street,number}=addressParts(query),words=streetWords(street),addresses=[],references=new Map();
 const sameStreet=value=>{const candidate=streetWords(value);return words.length&&words.every(w=>candidate.includes(w));};
 for(const f of features){
  const p=f.properties||{},point=f.geometry?.coordinates;
  if(f.geometry?.type!=='Point'||!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||point[0]<-180||point[0]>180||point[1]<-90||point[1]>90)continue;
  if(p.countrycode?.toLowerCase()!=='ar'||!(municipality==='castelar'?contains(castelarBoundary.geometry,point):normalize(p.county)===normalize(CONFIG.municipalities.find(m=>m.id===municipality)?.name)))continue;
  // A bus stop named after an intersection is not a street address.
  const stop=p.osm_value==='bus_stop'||p.osm_key==='public_transport';
  if(number&&sameStreet(p.street)&&normalize(String(p.housenumber||''))===number&&!stop){
   addresses.push({label:[streetName(p.street),p.housenumber,p.city,p.county].filter(Boolean).join(', '),point,exact:true,kind:'address'});continue;
  }
  const road=p.type==='street'||(p.osm_key==='highway'&&['residential','tertiary','secondary','primary','unclassified','living_street','pedestrian'].includes(p.osm_value));
  if(road&&sameStreet(p.name||p.street)){
   const name=streetName(p.name||p.street),key=streetWords(name).join(' '),ext=p.extent;
   const bbox=Array.isArray(ext)&&ext.length===4&&ext.every(Number.isFinite)?[Math.min(ext[0],ext[2]),Math.min(ext[1],ext[3]),Math.max(ext[0],ext[2]),Math.max(ext[1],ext[3])]:[...point,...point];
   const previous=references.get(key);
   if(previous){previous.bounds=[Math.min(previous.bounds[0],bbox[0]),Math.min(previous.bounds[1],bbox[1]),Math.max(previous.bounds[2],bbox[2]),Math.max(previous.bounds[3],bbox[3])];previous.point=[(previous.bounds[0]+previous.bounds[2])/2,(previous.bounds[1]+previous.bounds[3])/2];}
   else references.set(key,{label:'Ubicar calle '+name+' · numeración sin localizar',point:[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2],bounds:bbox,exact:false,kind:'street'});
   continue;
  }
  // Free-form place searches still support landmarks, but a requested house
  // number never falls back to another number, intersection or business.
  if(!number&&!stop)addresses.push({label:'Referencia · '+[p.name,p.street,p.housenumber,p.city,p.county].filter(Boolean).join(', '),point,exact:false,kind:'place'});
 }
 return addresses.some(r=>r.exact)?addresses.filter(r=>r.exact):[...references.values(),...addresses];
}
export class PhotonProvider{
 async search(query,municipality,signal){const m=CONFIG.municipalities.find(m=>m.id===municipality),url=new URL(CONFIG.GEOCODER_URL);url.search=new URLSearchParams({q:`${query}, ${m.searchName||m.name}, Argentina`,limit:'10',countrycode:'AR',bbox:'-59.6,-35.5,-57.6,-33.7',...(m.center?{lon:m.center[0],lat:m.center[1]}:{})});const r=await fetch(url,{signal});if(!r.ok)throw Error('El buscador no está disponible. Podés explorar el mapa.');return photonResults((await r.json()).features||[],query,municipality);}
}
