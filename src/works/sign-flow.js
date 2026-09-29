import {CONFIG} from '../../config/app.js';
import {extractSignText} from '../../server/works/sign-text.cjs';
import {preparePhoto,readQR,readText} from './photo.js';

const $=id=>document.getElementById(id);
const node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};

// The preview is a private estimate. Reviewed publication remains a separate path.
export function initSignFlow({map,save,savePreview,onFresh,status,attempt}){
  let photo=null,job=null,parent=null,selectedAddress='',manual=false,savedPhoto=false;
  document.body.insertAdjacentHTML('beforeend',`<dialog id="workUpload" class="work-upload">
    <div class="dialog-head"><h2>Subir cartel de obra</h2><button id="cancelUpload" aria-label="Cerrar">×</button></div>
    <p>Elegí una foto del cartel completo. Vamos a leer la dirección, la altura y el tipo de obra.</p>
    <label class="sign-file" for="workFile">Subir imagen<input id="workFile" type="file" accept="image/jpeg,image/png,image/webp"></label>
    <img id="workPhotoPreview" alt="Cartel seleccionado" hidden>
    <p class="micro">JPG, PNG o WebP · hasta 12 MB.</p>
    <p id="uploadStatus" role="status" aria-live="polite"></p>
    <button id="sendWork" class="primary" disabled>Procesar</button>
  </dialog>`);
  $('basicWorkFields').innerHTML=`<h2>Revisá los datos del cartel</h2><p>Corregí lo que haga falta y mirá el volumen en 3D.</p>
    <form id="signBasics"><div class="sign-basics">
      <label>Dirección<input id="signAddress" name="address" autocomplete="street-address" maxlength="250" required placeholder="Calle y número"></label>
      <label>Municipio<select id="signMunicipality" required><option value="">Elegí el municipio</option></select></label>
      <label>Altura del proyecto (m)<input id="signHeight" name="height" type="number" inputmode="decimal" min="0.1" max="300" step="any" required placeholder="Completá la altura"><small id="signHeightHint"></small></label>
      <label>Tipo de vivienda / destino<input id="signDestination" name="destination" maxlength="250" placeholder="Si figura en el cartel"></label>
    </div><p id="signExtra" class="micro"></p><p id="signSaveStatus" class="micro" role="status"></p>
    <p id="previewStatus" role="status" aria-live="polite"></p><div id="previewChoices" class="parcel-actions"></div>
    <div class="parcel-actions"><button id="viewSignMap" class="primary" type="submit">Ver en mapa</button><button id="changeSignPhoto" type="button">Cambiar imagen</button><button id="correctSignLocation" type="button" hidden>Corregir ubicación</button></div></form>
    <details class="sign-reading"><summary>Ver lectura original</summary><pre id="signOriginal"></pre></details>`;
  for(const m of CONFIG.municipalities.filter(m=>CONFIG.ENABLED_MUNICIPALITIES.includes(m.id)))$('signMunicipality').append(new Option(m.name,m.id));
  const uploadStatus=value=>$('uploadStatus').textContent=value;
  const previewStatus=value=>{$('previewStatus').textContent=value;status(value);};
  function open(parentWork=null,fresh=true){
    parent=parentWork;
    if(fresh){if(photo)URL.revokeObjectURL(photo.url);photo=null;$('workPhotoPreview').hidden=true;$('sendWork').disabled=true;}
    uploadStatus('La foto se guarda como aporte privado.');$('workUpload').showModal();
  }
  $('cancelUpload').onclick=()=>{if(!document.body.classList.contains('works-busy'))$('workUpload').close();};
  $('workUpload').addEventListener('cancel',e=>{if(document.body.classList.contains('works-busy'))e.preventDefault();});
  $('workFile').onchange=()=>{const file=$('workFile').files[0];$('workFile').value='';if(file)attempt(async()=>{
    const next=await preparePhoto(file);if(photo)URL.revokeObjectURL(photo.url);photo=next;
    $('workPhotoPreview').src=photo.url;$('workPhotoPreview').hidden=false;$('sendWork').disabled=false;uploadStatus('Imagen lista.');
  })();};
  $('changeSignPhoto').onclick=()=>open(parent,true);
  $('sendWork').onclick=attempt(async()=>{
    if(!photo)throw Error('Elegí una foto del cartel.');
    onFresh();job=null;savedPhoto=false;
    $('sendWork').disabled=true;
    try{
      let raw='',codes=[];
      uploadStatus('Procesando imagen…');
      try{raw=await readText(photo.canvas,uploadStatus);}catch{uploadStatus('No se pudo completar la lectura. Podés completar los datos básicos.');}
      try{codes=await readQR(photo.canvas);}catch{/* Text preview does not depend on QR. */}
      job={signExtraction:extractSignText(raw),input:{ocrText:raw},extracted:{}};
      render(job);$('workUpload').close();$('basicWorkFields').scrollIntoView({behavior:'smooth',block:'start'});
      $('signSaveStatus').textContent='Guardando aporte privado…';
      try{job=await save({photo,raw,codes,parent});savedPhoto=true;$('signSaveStatus').textContent='Aporte privado guardado. Todavía no publicado.';}
      catch(e){$('signSaveStatus').textContent='Podés ver el volumen en esta sesión. No se completó el guardado: '+e.message;}
    }finally{$('sendWork').disabled=false;}
  });
  function render(next){
    job=next;savedPhoto=Boolean(next.photo);selectedAddress='';manual=false;
    const sign=next.signExtraction||extractSignText(next.input?.ocrText||''),official=next.extracted?.fields||{},fields={...sign.fields,...official},draft=next.previewFields||{};
    $('workContribution').hidden=false;$('workDetails').hidden=true;
    $('verifiedWorkflow').hidden=!next.extracted?.verified;
    $('signAddress').value=draft.address??fields.address?.value??'';
    $('signMunicipality').value=draft.municipality??fields.municipality?.value??'';
    $('signHeight').value=draft.height??fields.height?.value??fields.projectHeight?.value??'';
    $('signDestination').value=draft.destination??fields.destination?.value??fields.type?.value??'';
    $('signHeightHint').textContent=fields.projectHeight&&!fields.height&&!draft.height?'Hmax proyectado leído de la tabla: confirmá que esté expresado en metros.':$('signHeight').value?'Revisá la altura leída en la foto.':'No se pudo leer la altura. Completala en metros para armar el volumen.';
    $('signExtra').textContent=[fields.type?.value,fields.expediente?.value?'Expediente: '+fields.expediente.value:''].filter(Boolean).join(' · ');
    $('signOriginal').textContent=sign.rawText||'No se reconoció texto.';
    $('previewChoices').replaceChildren();$('correctSignLocation').hidden=true;$('previewStatus').textContent='';
    $('signSaveStatus').textContent=next.id?(savedPhoto?'Aporte privado guardado. Todavía no publicado.':'Datos privados guardados. Falta guardar la imagen.'):'';
  }
  function basics(){return {address:$('signAddress').value.trim(),municipality:$('signMunicipality').value,height:Number($('signHeight').value),destination:$('signDestination').value.trim()};}
  $('signHeight').oninput=()=>{$('signHeightHint').textContent=$('signHeight').value?'Altura indicada por vos para esta vista previa.':'Completá la altura en metros para armar el volumen.';};
  const fingerprint=value=>value.municipality+'|'+value.address;
  const mapIntoView=()=>$('map').scrollIntoView({behavior:'smooth',block:'center'});
  function volume(value){
    map.preview(value.height);selectedAddress=fingerprint(value);manual=false;
    $('previewChoices').replaceChildren();$('correctSignLocation').hidden=false;
    previewStatus('Vista previa en 3D · '+value.height+' m. Volumen aproximado sobre la parcela; revisá la ubicación.');mapIntoView();
  }
  async function pick(result,value){
    await map.locate(result.point);
    if(map.location().parcels.length){volume(value);return;}
    manual=true;selectedAddress=fingerprint(value);map.confirm(true);
    previewStatus('La dirección no coincide con una parcela disponible. Tocá la parcela correcta y pulsá Ver en mapa.');mapIntoView();
  }
  $('signBasics').onsubmit=e=>{e.preventDefault();attempt(async()=>{
    if(!$('signBasics').reportValidity())return;
    const value=basics();if(!value.address)throw Error('Completá la dirección.');
    // Preserve edits privately; a storage outage must not prevent local viewing.
    try{const saved=await savePreview(value);if(saved){job=saved;if(savedPhoto)$('signSaveStatus').textContent='Aporte privado guardado. Todavía no publicado.';}}
    catch(e){$('signSaveStatus').textContent='Correcciones solo en esta sesión: '+e.message;}
    map.mode('explorer');$('workDetails').hidden=true;
    if(selectedAddress===fingerprint(value)&&map.location().municipality===value.municipality&&map.location().parcels.length){volume(value);return;}
    if(map.location().municipality!==value.municipality)await map.municipality(value.municipality);
    $('worksMunicipality').value=value.municipality;map.confirm(true);
    if(manual&&selectedAddress===fingerprint(value)){previewStatus('Tocá la parcela correcta y volvé a pulsar Ver en mapa.');mapIntoView();return;}
    map.clearProposal();
    previewStatus('Buscando la dirección…');$('previewChoices').replaceChildren();
    let results=[];
    try{results=await map.search(value.address,value.municipality);}catch(e){previewStatus(e.message+' Podés seleccionar la parcela en el mapa.');}
    const exact=results.filter(r=>r.exact);
    if(exact.length===1){await pick(exact[0],value);return;}
    manual=true;selectedAddress=fingerprint(value);$('correctSignLocation').hidden=false;
    previewStatus(results.length?'Elegí la ubicación. Las coincidencias aproximadas necesitan que selecciones la parcela.':'No se encontró esa dirección. Corregila o tocá la parcela en el mapa y pulsá Ver en mapa.');
    for(const result of exact.length?exact:results){const button=node('button',result.label);button.type='button';button.onclick=attempt(async()=>{
      if(result.exact)return pick(result,value);
      await map.locate(result.point);map.clearProposal();map.confirm(true);mapIntoView();
      previewStatus('Ubicación aproximada: tocá la parcela correcta y pulsá Ver en mapa.');
    });$('previewChoices').append(button);}
    if(!results.length)mapIntoView();
  })().catch(()=>{});};
  $('correctSignLocation').onclick=()=>{
    manual=true;selectedAddress=fingerprint(basics());map.confirm(true);map.clearProposal();
    previewStatus('Tocá la parcela correcta y pulsá Ver en mapa para reconstruir el volumen.');mapIntoView();
  };
  return {open,render};
}
