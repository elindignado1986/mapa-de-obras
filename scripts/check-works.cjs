const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {center}=require('../server/works/geometry.cjs');
const {extractNormalized}=require('../server/works/permit.cjs');
const {makeWork}=require('../server/works/publication.cjs');
const {extractSignText}=require('../server/works/sign-text.cjs');
const {previewFields}=require('../server/works/preview.cjs');
const origin=process.env.TEST_ORIGIN||'http://localhost:4174';
const manifest=JSON.parse(fs.readFileSync('data/amba/municipality-manifest.json'));
const dataset=manifest['tres-de-febrero'];
const point=[-58.590636,-34.592113],cell=`${Math.floor(point[0]/dataset.cellSize)}_${Math.floor(point[1]/dataset.cellSize)}`;
const parcel=JSON.parse(fs.readFileSync(`data/amba/tres-de-febrero/${dataset.version}/${cell}.json`)).features.find(f=>f.geometry.coordinates[0]?.[0]?.length===5);
const feature={id:String(parcel.id),geometry:parcel.geometry},parcelPoint=center(parcel.geometry);
const urlA='https://municipio.example/permiso/123',urlB='https://municipio.example/permiso/456';
const source={schema:'mapa-permiso-v1',fields:{municipality:'tres-de-febrero',locality:'Ciudad Jardín',address:'Cartel sintético 123',permit:'TEST-123',height:27,permitStatus:'Vigente'},parcelIds:[feature.id]};
const errors=[];let job=null,work=null,failPublish=false,failPreview=false,createCalls=0;
async function mockAPI(context){
 await context.route('**/api/works?**',async route=>{
  const req=route.request(),url=new URL(req.url()),action=url.searchParams.get('action');let body;try{body=req.postDataJSON();}catch{}const send=(json,status=200)=>route.fulfill({status,json});
  if(action==='config')return send({registry:true,photos:true,ocr:'browser',municipalAdapters:[]});
  if(action==='list')return send({enabled:true,works:work?[work]:[],nextOffset:null});
  if(action==='create'){createCalls++;job={id:body.id,input:body,revision:0,status:'pending',stage:'Aporte pendiente',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),issues:[],extracted:{}};return send(job);}
  if(action==='process'){job.revision++;job.status='pending';job.stage='Aporte pendiente';job.issues=['El sitio municipal no está disponible.'];return send(job,202);}
  if(action==='job')return send({...job,publicationIssues:job.extracted.verified&&job.location?[]:['Faltan datos revisados o ubicación confirmada.']});
  if(action==='preview'){if(failPreview)return send({error:'Almacenamiento no disponible.'},503);job.previewFields=previewFields(body.fields);job.revision++;return send(job);}
  if(action==='proposal')return send({proposal:{point:parcelPoint,parcelIds:[feature.id],source:'cadastral-identifiers'}});
  if(action==='locate'){assert.equal(body.location.parcels[0].id,feature.id);job.location={municipality:'tres-de-febrero',datasetVersion:dataset.version,parcels:[feature],parcel:feature,point:parcelPoint,confirmedAt:new Date().toISOString()};job.revision++;return send({...job,publicationIssues:[]});}
  if(action==='publish'){if(failPublish)return send({error:'No se confirmó el guardado.'},503);assert.equal(body.publicConsent,true);work=makeWork(job);job.status='published';job.publishedId=work.id;return send({result:'published',id:work.id});}
  if(action==='work')return send(work);
  return send({error:'Acción no simulada'},400);
 });
 await context.route('**/api/works-photo?**',route=>{job.revision++;return route.fulfill({json:{photo:true,revision:job.revision}});});
 await context.route('https://photon.komoot.io/**',route=>route.fulfill({json:{features:[{properties:{countrycode:'AR',county:'Partido de Tres de Febrero',street:'Aviador Wernicke',housenumber:'2236'},geometry:{type:'Point',coordinates:parcelPoint}}]}}));
 await context.route('https://cdn.cafecito.app/**',route=>route.abort());
}
(async()=>{
 fs.mkdirSync('.checks',{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000}});await mockAPI(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>document.body.classList.contains('works-active'));
  assert(await page.locator('#worksHome').isVisible());assert(await page.locator('#explorer').isHidden());assert.equal(await page.locator('#worksMunicipality').inputValue(),'tres-de-febrero');assert.match(await page.locator('#worksList').innerText(),/Todavía no hay obras/);
  await page.screenshot({path:'.checks/works-desktop.png',fullPage:true});
  await page.locator('#urbanMode').click();assert(await page.locator('#explorer').isVisible());assert(await page.locator('#view3d').isDisabled());await page.locator('#worksMode').click();
  const key={id:'11111111-1111-4111-8111-111111111111',token:'a'.repeat(64)};
  const raw=fs.readFileSync('tests/fixtures/sign-noisy.txt','utf8');
  job={id:key.id,input:{ocrText:raw},signExtraction:extractSignText(raw),photo:{pathname:'mock/private'},revision:1,status:'review-required',extracted:{},issues:[],updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()};
  await page.evaluate(value=>localStorage.setItem('works:recovery:v1',JSON.stringify(value)),key);
  await page.reload();await page.locator('#resumeWork').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));
  assert.equal(await page.locator('#signAddress').inputValue(),'AVIADOR WERNICKE 2236');assert.equal(await page.locator('#signHeight').inputValue(),'');assert(await page.locator('#verifiedWorkflow').isHidden());assert(await page.locator('#signOriginal').isHidden());
  assert.equal(await page.locator('#basicWorkFields input').count(),3);
  await page.locator('#viewSignMap').click();assert.equal(await page.locator('#signHeight').evaluate(el=>el.validity.valueMissing),true);assert.equal(await page.evaluate(()=>document.body.classList.contains('works-volume')),false);
  await page.locator('#signHeight').fill('23.35');await page.locator('#viewSignMap').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));
  assert.equal(await page.evaluate(()=>Legacy.state.flat),false);assert.equal(await page.locator('#buildingHeight').inputValue(),'23.35');assert.equal(await page.evaluate(()=>document.body.classList.contains('works-volume')),true);assert.equal(job.previewFields.height,23.35);assert.equal(job.previewFields.verified,false);assert.equal(work,null);
  await page.screenshot({path:'.checks/sign-preview-3d.png',fullPage:true});
  await page.locator('#addWork').click();await page.locator('#cancelUpload').click();
  failPreview=true;await page.locator('#signHeight').fill('24.35');await page.locator('#viewSignMap').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));
  assert.equal(await page.locator('#buildingHeight').inputValue(),'24.35');assert.match(await page.locator('#signSaveStatus').innerText(),/solo en esta sesión/);assert.equal(job.previewFields.height,23.35);
  failPreview=false;await page.locator('#signHeight').fill('23.35');
  await page.locator('#correctSignLocation').click();assert.equal(await page.evaluate(()=>document.body.classList.contains('works-volume')),false);assert.equal(await page.evaluate(()=>Urban.selections.length),0);assert(await page.locator('#address').isVisible());
  await page.locator('#signAddress').fill('Aviador Wernicke 2237');await page.locator('#viewSignMap').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.evaluate(()=>document.body.classList.contains('works-volume')),false);assert(await page.locator('#previewChoices button').count()>0);
  await page.locator('#previewChoices button').first().click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.evaluate(()=>Urban.selections.length),0);
  await page.locator('#signAddress').fill('AVIADOR WERNICKE 2236');await page.locator('#viewSignMap').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.locator('#buildingHeight').inputValue(),'23.35');assert.equal(await page.evaluate(()=>document.body.classList.contains('works-volume')),true);
  await page.reload();await page.locator('#resumeWork').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.locator('#signHeight').inputValue(),'23.35');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.checks/sign-basics-mobile.png',fullPage:true});await page.setViewportSize({width:1400,height:1000});
  job.extracted={...extractNormalized(source,urlA),verified:true};job.issues=[];job.status='extracted';job.stage='Datos extraídos de fuente pública';
  await page.locator('#resumeWork').click();await page.locator('#verifiedWorkflow > summary').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));await page.locator('#locateWork').click();await page.waitForFunction(()=>Urban.selections.length===1);assert(await page.locator('#view3d').isEnabled());await page.locator('#view3d').click();assert.equal(await page.evaluate(()=>Legacy.state.flat),false);assert.equal(await page.locator('#affectedCount').innerText(),'0');
  await page.locator('#correctWorkLocation').click();assert(await page.locator('#address').isVisible());await page.locator('#confirmWorkLocation').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.match(await page.locator('#worksStatus').innerText(),/aproximada/);assert(await page.locator('#publishWork').isDisabled());
  await page.locator('#publicConsent').check();assert(await page.locator('#publishWork').isEnabled());failPublish=true;await page.locator('#publishWork').click();await page.waitForFunction(()=>document.getElementById('worksStatus').textContent.includes('No se confirmó'));assert.equal(work,null);
  failPublish=false;await page.locator('#publishWork').click();await page.waitForSelector('#workDetails:not([hidden])');assert.match(await page.locator('#worksStatus').innerText(),/Guardado confirmado/);const permanent=page.url();assert(permanent.includes('?obra='));await page.screenshot({path:'.checks/works-published-synthetic.png',fullPage:true});
  const other=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mockAPI(other);const phone=await other.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(permanent);await phone.waitForSelector('#workDetails:not([hidden])');assert.match(await phone.locator('#workDetails').innerText(),/Cartel sintético/);assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await phone.screenshot({path:'.checks/works-mobile-synthetic.png',fullPage:true});
  await phone.getByRole('button',{name:'Probar otra altura'}).click();assert(await phone.locator('#buildingHeight').isVisible());assert.equal(await phone.locator('#buildingHeight').inputValue(),'27');await phone.locator('#buildingHeight').fill('35');assert.equal(work.height,27);assert.equal(await phone.evaluate(()=>document.body.classList.contains('works-active')),false);
  await phone.locator('#saveProject').click();await phone.locator('#worksMode').click();await phone.locator('#urbanMode').click();assert.equal(await phone.locator('#buildingHeight').inputValue(),'35');await phone.locator('#savedProjects').click();assert.equal(await phone.locator('#projectList .saved-row').count(),1);await phone.locator('#projectsDialog [data-close]').click();
  assert.deepEqual(errors,[]);fs.writeFileSync('.checks/works-results.json',JSON.stringify({passed:true,scope:'User-provided noisy OCR text; mock public API and geocoder; real local cadastral geometry',checks:['explorer default','simulator navigation','real noisy text recovery','missing height required','private preview edits','direct 3D volume','ambiguous geocoding','manual correction','reload recovery','reviewed publication failure','public consent','second browser permanent URL','mobile overflow','independent hypothetical height'],errors},null,2));
  console.log('PASS: Campos básicos, vista previa 3D, correcciones, publicación revisada, enlace y móvil. API simulada; ningún proveedor municipal real validado.');await context.close();await other.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
