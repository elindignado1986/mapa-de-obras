import {CONFIG} from '../../config/app.js';
import {initSignFlow} from './sign-flow.js';
const $=id=>document.getElementById(id);
const fields={municipality:'Municipio',locality:'Localidad',address:'Dirección',permit:'Permiso',expediente:'Expediente',type:'Tipo de obra',destination:'Destino',permitStatus:'Estado según la fuente',height:'Altura (m)',floors:'Pisos',landArea:'Superficie de terreno (m²)',coveredArea:'Superficie cubierta (m²)',totalArea:'Superficie total (m²)',projectFOT:'FOT del proyecto (m²/m²)',allowedFOT:'FOT normativo (m²/m²)',projectFOS:'FOS del proyecto (m²/m²)',allowedFOS:'FOS normativo (m²/m²)',projectDensity:'Densidad del proyecto (hab/ha)',allowedDensity:'Densidad normativa (hab/ha)',architect:'Arquitecto',designer:'Proyectista',director:'Director de obra',company:'Constructora',otherResponsible:'Otros responsables',permitDate:'Fecha del permiso',startDate:'Fecha de inicio',endDate:'Fecha de finalización'};
const municipalName=id=>CONFIG.municipalities.find(m=>m.id===id)?.name||id;
const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
function publicLink(url,label){try{const u=new URL(url);if(u.protocol!=='https:')return text('span','Enlace no disponible');const a=text('a',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return text('span','No disponible');}}
async function api(action,{id,token,body,offset}={}){
  const response=await fetch('/api/works?'+new URLSearchParams({action,...(id?{id}:{}),...(offset!=null?{offset}:{})}),{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let result;try{result=await response.json();}catch{throw Error('El servidor del registro no está disponible.');}
  if(!response.ok)throw Error(result.error||'No se confirmó el guardado.');return result;
}
function recovery(){try{return JSON.parse(localStorage.getItem('works:recovery:v1')||'null');}catch{return null;}}
function recoveries(){try{const list=JSON.parse(localStorage.getItem('works:recoveries:v1')||'[]'),last=recovery();if(last&&!list.some(x=>x.id===last.id))list.push(last);return list;}catch{return [];}}
function remember(value){const list=recoveries();if(!list.some(x=>x.id===value.id))list.push(value);localStorage.setItem('works:recoveries:v1',JSON.stringify(list));localStorage.setItem('works:recovery:v1',JSON.stringify(value));}
function newRecovery(){const bytes=crypto.getRandomValues(new Uint8Array(32));return {id:crypto.randomUUID(),token:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')};}

export async function initWorks(map){
  let rows=[],job=null,key=recovery(),config={},busy=false,photoStored=false,loadVersion=0;
  const showStatus=message=>$('worksStatus').textContent=message;
  const attempt=fn=>async()=>{if(busy)return;busy=true;document.body.classList.add('works-busy');try{await fn();}catch(e){showStatus(e.message);if($('workUpload').open)$('uploadStatus').textContent=e.message;else if($('previewStatus'))$('previewStatus').textContent=e.message;}finally{busy=false;document.body.classList.remove('works-busy');}};
  document.querySelector('.urban-nav').insertAdjacentHTML('afterbegin','<button id="worksMode" class="primary">Explorador de Obras</button>');
  $('urbanMode').textContent='Simulador de Obras';
  $('urbanMode').onclick=()=>{map.mode('simulator');history.replaceState(null,'','/#simulador');$('worksMode').classList.remove('active');};
  $('worksMode').onclick=()=>{map.mode('explorer');history.replaceState(null,'','/');$('worksMode').classList.add('active');};
  document.querySelector('.workspace').insertAdjacentHTML('afterbegin',`<section id="worksHome" class="works-home"><div class="works-heading"><div><span class="eyebrow">INFORMACIÓN PÚBLICA · APORTE COMUNITARIO</span><h2>Explorador de Obras</h2><p>Conocé las obras de tu barrio y explorá sus sombras.</p></div><button id="addWork" class="primary">Subir imagen</button></div><p class="works-explanation">Subí el cartel, revisá los datos y mirá el volumen de la obra en 3D.</p><div class="works-filters"><label>Municipio / localidad<select id="worksMunicipality"></select></label><label>Localidad<input id="worksLocality" type="search" placeholder="Todas las localidades"></label><label>Estado según el permiso<select id="worksState"><option value="">Todos los estados</option></select></label><button id="refreshWorks">Actualizar obras</button><button id="resumeWork" hidden>Retomar aporte pendiente</button></div><p id="worksStatus" role="status" aria-live="polite"></p><div id="worksList" class="works-list"></div><button id="moreWorks" hidden>Cargar más obras</button></section><section id="workContribution" class="work-card" hidden><div id="basicWorkFields"></div><details id="verifiedWorkflow" hidden><summary>Publicar obra revisada</summary><span class="eyebrow">APORTE · TODAVÍA NO PUBLICADO</span><h2 id="jobHeading">Aporte pendiente</h2><p id="jobStatus" role="status"></p><div id="jobIssues"></div><div class="parcel-actions"><button id="refreshJob">Actualizar estado</button><button id="replacePhoto">Reemplazar foto / enlace</button><button id="locateWork">Confirmar ubicación</button><button id="openDuplicate" hidden>Ver obra existente</button></div><div id="locationQuestion" hidden><h3>¿Esta es la parcela de la obra?</h3><p id="interpretedAddress"></p><p>Revisá el resaltado en el mapa. La búsqueda de una dirección es solo una propuesta. Podés ver el terreno en planta o 3D y elegir varias parcelas contiguas.</p><p id="locationCount" role="status"></p><button id="confirmWorkLocation" class="primary" disabled>Sí, es correcta</button><button id="correctWorkLocation">Corregir ubicación</button></div><div id="jobFields"></div><div id="publishPanel"><p>Confirmar la parcela no verifica todos los datos del permiso.</p><label class="consent"><input id="publicConsent" type="checkbox"> Entiendo que la ficha, ubicación y foto revisada quedarán visibles públicamente.</label><button id="publishWork" class="primary" disabled>Publicar obra</button><p id="publicationIssues"></p></div></details></section><section id="workDetails" class="work-card" hidden></section>`);
  for(const m of CONFIG.municipalities.filter(m=>CONFIG.ENABLED_MUNICIPALITIES.includes(m.id))){const option=text('option',m.name);option.value=m.id;$('worksMunicipality').append(option);}
  $('worksMunicipality').value=map.location().municipality;
  const drafts=document.createElement('select');drafts.id='workDrafts';drafts.setAttribute('aria-label','Aportes guardados en el servidor');$('resumeWork').before(drafts);
  function listDrafts(){drafts.replaceChildren(new Option('Mis aportes guardados',''));for(const item of recoveries())drafts.append(new Option('Aporte '+item.id.slice(0,8),item.id));drafts.hidden=!(drafts.options.length>1);}
  drafts.onchange=attempt(async()=>{if(!drafts.value)return;key=recoveries().find(x=>x.id===drafts.value);await refreshJob();});listDrafts();
  function renderFields(container,data){
    container.replaceChildren();const list=document.createElement('dl');list.className='work-facts';
    for(const [key,label]of Object.entries(fields)){const field=data?.[key];if(!field)continue;list.append(text('dt',label));const dd=text('dd',field?String(key==='municipality'?municipalName(field.value):field.value):'No disponible');if(field){const provenance=text('small',field.origin==='public-source'?'Extraído de fuente pública':'Dato aportado / sin verificar');dd.append(provenance);if(field.source)dd.append(publicLink(field.source,'Fuente'));if(field.queriedAt)dd.append(text('small','Consulta: '+new Date(field.queriedAt).toLocaleString('es-AR')));}list.append(dd);}container.append(list);
  }
  async function openWork(id){
    try{const work=await api('work',{id});map.mode('explorer');await map.show(work);$('worksMunicipality').value=work.location.municipality;history.replaceState(null,'','/?obra='+encodeURIComponent(id));$('workContribution').hidden=true;map.confirm(false);
      const card=$('workDetails');card.hidden=false;card.replaceChildren(text('span','OBRA PUBLICADA','eyebrow'),text('h2',work.fields.address?.value||'Obra registrada'),text('p',work.volume.reason,'volume-note'));
      const actions=document.createElement('div');actions.className='parcel-actions';
      const copy=text('button','Probar otra altura');copy.onclick=attempt(async()=>{await map.show(work,true);history.replaceState(null,'','/#simulador');});
      const share=text('button','Copiar enlace permanente');share.onclick=attempt(async()=>{await navigator.clipboard.writeText(new URL('/?obra='+id,location.origin).href);showStatus('Enlace permanente copiado.');});
      const add=text('button','Aportar información o foto');add.onclick=()=>openUpload(id,true);actions.append(copy,share,add);card.append(actions);
      if(work.photo){const img=document.createElement('img');img.src='/api/works?action=photo&id='+id;img.alt='Cartel de obra revisado';img.className='work-public-photo';card.append(img);}
      const facts=document.createElement('details');facts.append(text('summary','Ver ficha y fuentes'));const detail=document.createElement('div');renderFields(detail,work.fields);facts.append(detail);card.append(facts,publicLink(work.source,'Permiso original'));
      for(const url of work.documents||[])card.append(publicLink(url,'Documento público asociado'));
      card.append(text('p','Parcelas ARBA: '+work.location.parcels.map(p=>p.id).join(', ')),text('p','Ubicación confirmada por un aportante · '+new Date(work.location.confirmedAt).toLocaleDateString('es-AR')),text('p','Incorporación: '+new Date(work.createdAt).toLocaleDateString('es-AR')+' · Actualización: '+new Date(work.updatedAt).toLocaleDateString('es-AR')));
      showStatus('Obra publicada. Cambiá la fecha y el horario para explorar sus sombras.');
    }catch(e){showStatus(e.message);}
  }
  function filterRows(){
    const municipality=$('worksMunicipality').value,locality=$('worksLocality').value.toLocaleLowerCase().trim(),state=$('worksState').value;
    const visible=rows.filter(w=>w.location.municipality===municipality&&(!locality||String(w.fields.locality?.value||'').toLocaleLowerCase().includes(locality))&&(!state||w.fields.permitStatus?.value===state));
    const list=$('worksList');list.replaceChildren();
    for(const work of visible){const btn=document.createElement('button');btn.className='work-list-item';btn.append(text('strong',work.fields.address?.value||'Obra registrada'),text('span',(work.fields.locality?.value||municipalName(work.location.municipality))+' · '+(work.fields.permitStatus?.value||'Estado no disponible')));btn.onclick=()=>openWork(work.id);list.append(btn);}
    if(!visible.length&&config.registry)list.append(text('p',rows.length?'No hay obras que coincidan con estos filtros.':'Todavía no hay obras publicadas. Podés aportar el primer cartel.','works-empty'));
    map.setMarkers(visible.map(w=>({id:w.id,point:w.location.point,municipality:w.location.municipality})),openWork);
  }
  let nextOffset=null;
  async function refresh(more=false){const version=++loadVersion;const result=await api('list',{offset:more?nextOffset:0});if(version!==loadVersion)return;rows=more?[...rows,...result.works]:result.works;config.registry=result.enabled;nextOffset=result.nextOffset;$('moreWorks').hidden=nextOffset==null;showStatus(result.enabled?'Las obras registradas se distinguen de las simulaciones hipotéticas.':result.message);const selected=$('worksState').value;$('worksState').replaceChildren(new Option('Todos los estados',''));for(const state of new Set(rows.map(w=>w.fields.permitStatus?.value).filter(Boolean)))$('worksState').append(new Option(state,state));$('worksState').value=selected;filterRows();}
  $('refreshWorks').onclick=attempt(()=>refresh());$('moreWorks').onclick=attempt(()=>refresh(true));
  $('worksMunicipality').onchange=attempt(async()=>{map.confirm(false);$('locationQuestion').hidden=true;await map.municipality($('worksMunicipality').value);filterRows();});
  $('worksLocality').oninput=filterRows;$('worksState').onchange=filterRows;
  const flow=initSignFlow({map,attempt,status:showStatus,
    onFresh(){job=null;key=null;photoStored=false;},
    async save({photo,raw,codes,parent}){
      if(!config.registry)throw Error('El registro no está disponible.');
      if(!key){key=newRecovery();remember(key);}
      if(!job)job=await api('create',{...key,body:{id:key.id,ocrText:raw,parentWork:parent,textOnly:true}});
      listDrafts();$('resumeWork').hidden=false;
      if(!photoStored){
        if(!config.photos)throw Error('El almacenamiento de fotos no está configurado.');
        const r=await fetch('/api/works-photo?'+new URLSearchParams({id:key.id,revision:job.revision}),{method:'POST',headers:{Authorization:'Bearer '+key.token,'Content-Type':'image/jpeg'},body:photo.blob});
        const data=await r.json();if(!r.ok)throw Error(data.error||'No se guardó la foto.');job.revision=data.revision;photoStored=true;
      }
      const urls=codes.filter(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}});
      const body={revision:job.revision,ocrText:raw,textOnly:urls.length!==1,qrURL:urls.length===1?urls[0]:'',detectedQR:codes};
      try{job=await api('process',{...key,body});}catch(error){
        if(body.textOnly)throw error;
        // A bad QR never discards the readable sign. Reload revision after an
        // uncertain response so the retry cannot overwrite concurrent work.
        job=await api('job',key);job=await api('process',{...key,body:{...body,revision:job.revision,textOnly:true}});
      }
      return job;
    },
    async savePreview(fields){
      if(!job||!key)return null;
      job=await api('preview',{...key,body:{revision:job.revision,fields}});return job;
    }
  });
  function openUpload(parent=null,fresh=false){if(!busy)flow.open(parent,fresh);}
  $('addWork').onclick=()=>openUpload(null,true);$('replacePhoto').onclick=()=>openUpload(null,true);
  async function refreshJob(){if(!key)return;job=await api('job',key);renderJob();}
  function renderJob(){
    flow.render(job);$('verifiedWorkflow').hidden=!job.extracted?.verified;
    $('workContribution').hidden=false;$('workDetails').hidden=true;$('resumeWork').hidden=false;$('jobHeading').textContent=job.stage;$('jobStatus').textContent='Aporte '+job.id+' · guardado en el servidor · '+new Date(job.updatedAt).toLocaleString('es-AR');
    $('jobIssues').replaceChildren(...(job.issues||[]).map(x=>text('p',x)));
    if(job.candidateIds?.length){$('jobIssues').append(text('p','Otras obras coinciden por parcela o dirección. Es un indicio, no una identificación definitiva.'));for(const id of job.candidateIds){const btn=text('button','Revisar posible coincidencia');btn.onclick=()=>openWork(id);$('jobIssues').append(btn);}}
    const issues=job.publicationIssues||[];$('publicationIssues').textContent=issues.join(' ');$('publishWork').disabled=issues.length>0||!$('publicConsent').checked||job.status==='published';
    renderFields($('jobFields'),job.extracted?.fields);
    $('openDuplicate').hidden=!job.duplicateId;$('openDuplicate').onclick=()=>openWork(job.duplicateId);
    if(job.status==='published'){showStatus('Este aporte ya fue publicado.');$('openDuplicate').hidden=false;$('openDuplicate').onclick=()=>openWork(job.publishedId);}
    if(['queued','processing'].includes(job.status))$('jobIssues').append(text('p','Podés cerrar esta página y retomar el aporte. Si permanece en espera, el servicio de procesamiento todavía no está ejecutándose.'));
  }
  $('resumeWork').hidden=!key;$('resumeWork').onclick=attempt(refreshJob);$('refreshJob').onclick=attempt(refreshJob);
  $('publicConsent').onchange=()=>{$('publishWork').disabled=!job||Boolean(job.publicationIssues?.length)||!$('publicConsent').checked||job.status==='published';};
  const updateLocation=()=>{const n=map.location().parcels.length;$('locationCount').textContent=n?n+' parcela(s) seleccionada(s). Revisá el resaltado.':'Acercá el mapa y seleccioná la parcela de la obra.';$('confirmWorkLocation').disabled=!n;};
  window.addEventListener('workselectionchange',updateLocation);
  $('locateWork').onclick=attempt(async()=>{
    map.mode('explorer');map.confirm(true);$('locationQuestion').hidden=false;
    const f={...job.signExtraction?.fields,...job.extracted?.fields},municipality=f.municipality?.value||$('worksMunicipality').value;
    if(CONFIG.ENABLED_MUNICIPALITIES.includes(municipality)){await map.municipality(municipality);$('worksMunicipality').value=municipality;map.confirm(true);}
    const address=f.address?.value;$('interpretedAddress').textContent='Dirección interpretada: '+(address||'No disponible. Buscá y elegí la ubicación manualmente.');
    let cadastral=null;if(job.extracted?.parcelIds?.length){try{cadastral=(await api('proposal',key)).proposal;}catch{showStatus('No se pudo ubicar el identificador catastral. Revisá la selección manualmente.');}}
    if(job.location){await map.locate(job.location.point,job.location.parcels.map(p=>p.id));}
    else if(cadastral){await map.locate(cadastral.point,cadastral.parcelIds);showStatus('Parcela propuesta por identificador catastral. Contrastá el mapa con la dirección interpretada.');}
    else if(address){showStatus('Ubicando parcela…');try{const results=await map.search(address,municipality);if(results.length)await map.locate(results[0].point,job.extracted?.parcelIds||[]);else showStatus('Sin coincidencias. Corregí la ubicación en el mapa.');}catch(e){showStatus(e.message);}}
    updateLocation();$('map').scrollIntoView({behavior:'smooth',block:'center'});
  });
  $('correctWorkLocation').onclick=()=>{map.confirm(true);$('address').focus();showStatus('Buscá otra dirección o seleccioná las parcelas correctas.');};
  $('confirmWorkLocation').onclick=attempt(async()=>{job=await api('locate',{...key,body:{revision:job.revision,location:map.location()}});map.confirm(false);$('locationQuestion').hidden=true;renderJob();if(job.extracted?.fields?.height?.value){await map.show({location:job.location,height:job.extracted.fields.height.value});showStatus('Vista previa aproximada: parcela completa con altura del permiso. No representa la huella exacta. Todavía no publicada.');}});
  $('publishWork').onclick=attempt(async()=>{const result=await api('publish',{...key,body:{revision:job.revision,publicConsent:$('publicConsent').checked}});await refresh();await openWork(result.id);showStatus(result.result==='duplicate'?'La obra ya existe. Podés aportar información o una foto nueva.':'Guardado confirmado: la obra ya es pública.');});
  if(!location.hash.startsWith('#v1=')&&location.hash!=='#simulador'&&!location.pathname.startsWith('/embed'))map.mode('explorer');
  try{config=await api('config');await refresh();}catch(e){showStatus(e.message);}
  const workId=new URL(location.href).searchParams.get('obra');if(workId)await openWork(workId);
  // Poll only when an owned contribution is visible, and never while another mutation runs.
  setInterval(()=>{if(!busy&&job&&['queued','processing'].includes(job.status)&&!document.hidden){const requestedId=key?.id;api('job',key).then(next=>{if(busy||key?.id!==requestedId)return;job=next;flow.updateStatus(job);$('verifiedWorkflow').hidden=!job.extracted?.verified;}).catch(e=>showStatus(e.message));}},7000);
}
