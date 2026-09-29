// Deterministic candidates from untrusted OCR, never verified permit data.
const municipalities=require('../../config/ambaMunicipalities.json');
const clean=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const rules=[
 ['municipality','Municipio',/^(?:municipalidad(?: de)?|municipio|partido)\s*[:\-]?\s*(.+)$/i],
 ['locality','Localidad',/^(?:localidad|localizacion)\s*[:\-]\s*(.+)$/i],
 ['address','Dirección',/^(?:direccion(?: de (?:la )?obra)?|domicilio(?: de (?:la )?obra)?|ubicacion(?: de (?:la )?obra)?|obra sita en)\s*[:\-]?\s*(.+)$/i],
 ['permit','Permiso',/^(?:permiso(?: de (?:la )?obra)?|licencia de obra)\s*(?:n[°ºo.]?|numero)?\s*[:\-]?\s*(.+)$/i],
 ['expediente','Expediente',/^(?:expediente|expte\.?)\s*(?:n[°ºo.]?|numero)?\s*[:\-]?\s*(.+)$/i],
 ['height','Altura (m)',/^altura(?: (?:total|del edificio|de obra))?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(?:m|mts\.?|metros)\.?$/i,'number'],
 ['floors','Pisos',/^(?:cantidad de pisos|numero de pisos|pisos|plantas|niveles)\s*[:\-]?\s*(\d+)\s*$/i,'number'],
 ['landArea','Superficie de terreno (m²)',/^(?:superficie|sup\.?)\s*(?:de(?:l)?\s+)?(?:terreno|lote)\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|m\^2|metros cuadrados)\.?$/i,'number'],
 ['coveredArea','Superficie cubierta (m²)',/^(?:superficie|sup\.?)\s*cubierta\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|m\^2|metros cuadrados)\.?$/i,'number'],
 ['totalArea','Superficie total (m²)',/^(?:superficie|sup\.?)\s*total\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|m\^2|metros cuadrados)\.?$/i,'number'],
 ['type','Tipo de obra',/^(?:tipo de obra|obra a ejecutar|trabajos a realizar)\s*[:\-]\s*(.+)$/i],
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
const labels=Object.fromEntries(rules.map(([key,label])=>[key,label]));
function number(value){
 if(/^\d{1,3}(?:\.\d{3})+,\d+$/.test(value))return Number(value.replaceAll('.','').replace(',','.'));
 // A single grouping separator is ambiguous in OCR; require review instead.
 if(/^\d{1,3}[.,]\d{3}$/.test(value))return null;
 if(!/^\d+(?:[.,]\d+)?$/.test(value))return null;
 return Number(value.replace(',','.'));
}
function extractSignText(raw,now=new Date().toISOString(),edited=false){
 const origin=edited?'user-transcribed':'sign-ocr';
 const input=typeof raw==='string'?raw.slice(0,16000):'',fields={},candidates={},issues=[],lines=input.split(/\r?\n|\s*\|\s*|\t+/).map(x=>x.trim()).filter(Boolean);
 for(let i=0;i<lines.length;i++){
  // Preserve accents/case in values; matching uses an accent-normalized copy.
  const line=lines[i],normalized=clean(line);
  for(const [key,label,pattern,kind]of rules){
   let match=pattern.exec(normalized),evidence=line;
   if((!match||/^[:\-\s]*$/.test(match[1]))&&/[:\-]$/.test(line)&&lines[i+1]){evidence=line+' '+lines[i+1];match=pattern.exec(clean(evidence));}
   if(!match)continue;
   let value=evidence.slice(match.index+match[0].lastIndexOf(match[1]),match.index+match[0].lastIndexOf(match[1])+match[1].length).trim();
   if(!value||/^[:\-\s]*$/.test(value)||value.length>500)continue;
   if(kind==='number'){
    value=number(match[1]);if(value===null||!Number.isFinite(value)||(key==='height'&&(value<=0||value>300))){issues.push(label+': valor ambiguo o fuera de rango; revisá el texto.');continue;}
   }
   if(key==='municipality'){const m=municipalities.find(m=>clean(m.name)===clean(value));if(m)value=m.id;}
   const entry={value,origin,source:'photo',queriedAt:now,evidence,label,verified:false};
   (candidates[key]||=[]).push(entry);
  }
  if(/^(?:f\.?o\.?t\.?|f\.?o\.?s\.?|densidad)\b/.test(normalized)&&!/(permitid|normativ|maxim|proyect|declarad)/.test(normalized))issues.push('Indicador sin distinguir normativa y proyecto: '+line);
 }
 for(const [key,entries]of Object.entries(candidates)){
  const values=[...new Set(entries.map(e=>String(e.value)))];
  if(values.length===1)fields[key]=entries[0];else issues.push(labels[key]+': se leyeron valores distintos ('+values.join(' / ')+'). Revisalos en la foto.');
 }
 if(fields.coveredArea&&fields.totalArea&&fields.coveredArea.value>fields.totalArea.value)issues.push('La superficie cubierta leída supera la total; revisá los valores y sus conceptos.');
 return {fields,candidates,issues:[...new Set(issues)],queriedAt:now,origin,verified:false,rawText:input};
}
module.exports={extractSignText,labels};
