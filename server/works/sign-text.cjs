// Deterministic candidates from untrusted OCR, never verified permit data.
const municipalities=require('../../config/ambaMunicipalities.json');
const clean=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const rules=[
 ['municipality','Municipio',/^(?:municipalidad(?: de)?|municipio|partido)\s*[:\-]?\s*(.+)$/i],
 ['locality','Localidad',/^(?:localidad|localizacion)\s*[:\-]\s*(.+)$/i],
 ['address','Dirección',/^(?:d[i1l]rec\s*c[i1l][o0]n(?: de (?:la )?obra)?|domicilio(?: de (?:la )?obra)?|ubicacion(?: de (?:la )?obra)?|obra sita en)\s*[:\-]?\s*(.+)$/i],
 ['permit','Permiso',/^(?:permiso(?: de (?:la )?obra)?|licencia de obra)\s*(?:numero|n[°ºo.]?)?\s*[:\-]?\s*(.+)$/i],
 ['expediente','Expediente',/^(?:expediente|expte\.?)\s*(?:numero|n[°ºo.]?)?\s*[:\-]?\s*(.+)$/i],
 ['height','Altura (m)',/^altura(?: (?:total|del edificio|de obra))?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(?:m|mts\.?|metros)\.?$/i,'number'],
 ['floors','Pisos',/^(?:cantidad de pisos|numero de pisos|pisos|plantas|niveles)\s*[:\-]?\s*(\d+)\s*$/i,'number'],
 ['landArea','Superficie de terreno (m²)',/^(?:superficie|sup\.?)\s*(?:de(?:l)?\s+)?(?:terreno|lote)\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|m\^2|metros cuadrados)\.?$/i,'number'],
 ['coveredArea','Superficie cubierta (m²)',/^(?:superficie|sup\.?)\s*cubierta\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|m\^2|metros cuadrados)\.?$/i,'number'],
 ['totalArea','Superficie total (m²)',/^(?:superficie|sup\.?)\s*total\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|m\^2|metros cuadrados)\.?$/i,'number'],
 ['type','Tipo de obra',/^(?:tipo(?: de obra)?|obra a ejecutar|trabajos a realizar)\s*[:\-]\s*(.+)$/i],
 ['destination','Destino',/^destino(?: de (?:la )?obra)?\s*[:\-]\s*(.+)$/i],
 ['architect','Arquitecto',/^(?:arquitecto|arquitecta|arq\.)\s*[:\-]?\s*(.+)$/i],
 ['designer','Proyectista',/^(?:proyectista|proyecto(?: y calculo)?)\s*[:\-]\s*(.+)$/i],
 ['director','Director de obra',/^(?:director(?:a)? de obra|direccion(?: tecnica)? de obra)\s*[:\-]\s*(.+)$/i],
 ['company','Constructora',/^(?:constructora|empresa constructora|constructor)\s*[:\-]\s*(.+)$/i],
 ['permitDate','Fecha del permiso',/^fecha (?:de(?:l)? )?(?:permiso|aprobacion)\s*[:\-]\s*(.+)$/i],
 ['startDate','Fecha de inicio',/^fecha (?:de )?inicio(?: de obra)?\s*[:\-]\s*(.+)$/i],
 ['endDate','Fecha de finalización',/^fecha (?:de )?(?:finalizacion|terminacion)(?: de obra)?\s*[:\-]\s*(.+)$/i],
 ['cadastralReference','Nomenclatura catastral',/^(?:nomenclatura catastral|identificacion catastral|partida(?: inmobiliaria)?)\s*[:\-]\s*(.+)$/i],
 ['permitStatus','Estado del permiso',/^estado del permiso\s*[:\-]\s*(.+)$/i],
];
for(const [short,label] of [['FOT','FOT'],['FOS','FOS'],['Density','Densidad']]){
 const term=short==='Density'?'densidad':short.toLowerCase().split('').join('\\.?')+'\\.?';
 for(const [prefix,qualifier]of [['project','(?:del proyecto|de proyecto|proyectado|proyectada|declarado|declarada)'],['allowed','(?:permitido|permitida|normativo|normativa|maximo|maxima)']])rules.push([prefix+short,label+(prefix==='project'?' del proyecto':' normativo'),new RegExp('^'+term+'\\s+'+qualifier+'\\s*[:\\-]?\\s*([\\d.,]+)\\s*'+(short==='Density'?'(?:hab/ha|habitantes/ha)':'(?:m²/m²|m2/m2)?')+'\\s*$','i'),'number']);
}
const labels={...Object.fromEntries(rules.map(([key,label])=>[key,label])),allowedHeight:'Altura máxima permitida (m)',projectHeight:'Hmax del proyecto (confirmar metros)'};
function number(value){
 if(/^\d{1,3}(?:\.\d{3})+,\d+$/.test(value))return Number(value.replaceAll('.','').replace(',','.'));
 // A single grouping separator is ambiguous in OCR; require review instead.
 if(/^\d{1,3}[.,]\d{3}$/.test(value))return null;
 if(!/^\d+(?:[.,]\d+)?$/.test(value))return null;
 return Number(value.replace(',','.'));
}
const addressKey=value=>clean(value).replace(/\s+/g,' ').replace(/[.,;]+$/,'').trim();
const addressHeading=/^(?:d[i1l]rec\s*c[i1l][o0]n(?: de (?:la )?obra)?|domicilio(?: de (?:la )?obra)?|ubicacion(?: de (?:la )?obra)?|obra sita en)\s*[:\-]?\s*$/i;
const otherHeading=/^(?:tipo|destino|expediente|permiso|propietario|profesional|altura|pisos|fos|fot|dn|hmax|permitido|proyectado|municipalidad|general|obras privadas|tecnica)\b/i;
function extractSignText(raw,now=new Date().toISOString(),edited=false){
 const origin=edited?'user-transcribed':'sign-ocr';
 const input=typeof raw==='string'?raw.slice(0,16000):'',fields={},candidates={},issues=[],lines=input.split(/\r?\n|\s*\|\s*|\t+/).map(x=>x.trim()).filter(Boolean);
 const add=(key,value,evidence)=>{(candidates[key]||=[]).push({value,origin,source:'photo',queriedAt:now,evidence,label:labels[key],verified:false});};
 // OCR may interleave the municipal heading and the right-hand department.
 const heading=clean(input.slice(0,2500));
 if(/municipalidad|municipio|partido/.test(heading))for(const m of municipalities){
  if(new RegExp('\\b'+clean(m.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')+'\\b').test(heading))add('municipality',m.id,input.slice(0,2500));
 }
 for(let i=0;i<lines.length;i++){
  // Preserve accents/case in values; matching uses an accent-normalized copy.
  const line=lines[i];
  // Discard finder-pattern noise before a known label, retaining original evidence.
  const start=clean(line).search(/\b(?:d[i1l]rec\s*c[i1l][o0]n|domicilio|ubicacion|expediente|expte|destino|tipo|altura|pisos|superficie|sup\.|profesional|municipalidad|municipio|partido|localidad|permiso|proyectista|director|constructora)\b/);
  const readable=start>0?line.slice(start):line,normalized=clean(readable);
  for(const [key,label,pattern,kind]of rules){
   let match=pattern.exec(normalized),evidence=readable;
   if(key==='address'&&addressHeading.test(normalized)&&lines[i+1]&&!otherHeading.test(clean(lines[i+1]))){evidence=readable+' '+lines[i+1];match=pattern.exec(clean(evidence));}
   if((!match||/^[:\-\s]*$/.test(match[1]))&&/[:\-]$/.test(readable)&&lines[i+1]){evidence=readable+' '+lines[i+1];match=pattern.exec(clean(evidence));}
   if(!match)continue;
   let value=evidence.slice(match.index+match[0].lastIndexOf(match[1]),match.index+match[0].lastIndexOf(match[1])+match[1].length).trim();
   if(!value||/^[:\-\s]*$/.test(value)||value.length>500)continue;
   if(kind==='number'){
    value=number(match[1]);if(value===null||!Number.isFinite(value)||(key==='height'&&(value<=0||value>300))){issues.push(label+': valor ambiguo o fuera de rango; revisá el texto.');continue;}
   }
   if(key==='municipality'){const m=municipalities.find(m=>clean(m.name)===clean(value));if(m)value=m.id;else continue;}
   if(key==='address'){
    value=value.replace(/\s+EXT\b.*$/i,'').replace(/\s+(?:PERMITIDO|PROYECTADO|FOS|FOT|DN|HMAX)\b.*$/i,'').trim();
    if(otherHeading.test(clean(value)))continue;
    const next=lines[i+(addressHeading.test(normalized)?2:1)];
    if(!/\d/.test(value)&&next&&/^\d{1,6}$/.test(next)){value+=' '+next;evidence+=' '+next;}
    // A decimal sequence following a house number belongs to the adjacent table.
    value=value.replace(/^(.+?\b\d{1,6})\s+(?:\d+[.,]\d+\s+)+.*$/,'$1').replace(/\s+/g,' ').trim();
   }
   if(key==='destination'&&lines[i+1]){const continuation=lines[i+1].match(/\bCOMERCIAL(?:ES)?(?:\s+Y\s+COCHERAS)?\b|\bY\s+COCHERAS\b/i);if(continuation){value+=' '+continuation[0];evidence+=' '+lines[i+1];}}
   const entry={value,origin,source:'photo',queriedAt:now,evidence,label,verified:false};
   (candidates[key]||=[]).push(entry);
  }
  if(/^(?:f\.?o\.?t\.?|f\.?o\.?s\.?|densidad)\b/.test(normalized)&&!/(permitid|normativ|maxim|proyect|declarad)/.test(normalized))issues.push('Indicador sin distinguir normativa y proyecto: '+line);
 }
 // Only complete, ordered table rows are usable. Never infer lost decimals or
 // take a regulatory maximum as the building height. Hmax needs unit review.
 if(/fos\s*\|?\s*fot\s*\|?\s*(?:dn|on)\s*\|?\s*h(?:max|mox)/i.test(clean(input))){
  for(const row of input.split(/\r?\n/)){
   const match=clean(row).replace(/\|/g,' ').match(/\b(permitido|proyectado)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/);
   if(!match)continue;
   const prefix=match[1]==='proyectado'?'project':'allowed';
   for(const [j,suffix]of ['FOS','FOT','Density','Height'].entries()){
    const value=number(match[j+2]);if(value===null||!Number.isFinite(value)||value<0||(suffix==='Height'&&(value<=0||value>300)))continue;
    add(prefix+suffix,value,row);
   }
  }
 }
 for(const [key,entries]of Object.entries(candidates)){
  if(key==='address'){
   // Multiple OCR passes often differ only in case, spacing or a cropped suffix.
   // Keep a complete reading only when every other reading is its exact prefix.
   const unique=[...new Map(entries.map(e=>[addressKey(e.value),e])).values()];
   const complete=unique.filter(e=>/\b\d{1,6}\b/.test(e.value));
   if(unique.length===1){fields[key]=unique[0];continue;}
   if(complete.length===1&&unique.every(e=>e===complete[0]||(!/\d/.test(e.value)&&addressKey(complete[0].value).startsWith(addressKey(e.value)+' ')))){fields[key]=complete[0];continue;}
  }
  const values=[...new Set(entries.map(e=>String(e.value)))];
  if(values.length===1)fields[key]=entries[0];else issues.push(labels[key]+': se leyeron valores distintos ('+values.join(' / ')+'). Revisalos en la foto.');
 }
 if(fields.coveredArea&&fields.totalArea&&fields.coveredArea.value>fields.totalArea.value)issues.push('La superficie cubierta leída supera la total; revisá los valores y sus conceptos.');
 return {fields,candidates,issues:[...new Set(issues)],queriedAt:now,origin,verified:false,rawText:input};
}
module.exports={extractSignText,labels};
