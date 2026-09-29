const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const QRCode=require('qrcode');
const sharp=require('sharp');
const {center}=require('../server/works/geometry.cjs');
const {extractNormalized}=require('../server/works/permit.cjs');
const {makeWork}=require('../server/works/publication.cjs');
const origin=process.env.TEST_ORIGIN||'http://localhost:4174';
const manifest=JSON.parse(fs.readFileSync('data/amba/municipality-manifest.json'));
const dataset=manifest['tres-de-febrero'];
const point=[-58.590636,-34.592113],cell=`${Math.floor(point[0]/dataset.cellSize)}_${Math.floor(point[1]/dataset.cellSize)}`;
const parcel=JSON.parse(fs.readFileSync(`data/amba/tres-de-febrero/${dataset.version}/${cell}.json`)).features.find(f=>f.geometry.coordinates[0]?.[0]?.length===5);
const feature={id:String(parcel.id),geometry:parcel.geometry},parcelPoint=center(parcel.geometry);
const urlA='https://municipio.example/permiso/123',urlB='https://municipio.example/permiso/456';
const source={schema:'mapa-permiso-v1',fields:{municipality:'tres-de-febrero',locality:'Ciudad Jardín',address:'Cartel sintético 123',permit:'TEST-123',height:27,permitStatus:'Vigente'},parcelIds:[feature.id]};
const errors=[];let job=null,work=null,failPublish=false,createCalls=0;
async function mockAPI(context){
 await context.route('**/api/works?**',async route=>{
  const req=route.request(),url=new URL(req.url()),action=url.searchParams.get('action');let body;try{body=req.postDataJSON();}catch{}const send=(json,status=200)=>route.fulfill({status,json});
  if(action==='config')return send({registry:true,photos:true,ocr:'browser',municipalAdapters:[]});
  if(action==='list')return send({enabled:true,works:work?[work]:[],nextOffset:null});
  if(action==='create'){createCalls++;job={id:body.id,input:body,revision:0,status:'pending',stage:'Aporte pendiente',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),issues:[],extracted:{}};return send(job);}
  if(action==='process'){job.revision++;job.status='pending';job.stage='Aporte pendiente';job.issues=['El sitio municipal no está disponible.'];return send(job,202);}
  if(action==='job')return send({...job,publicationIssues:job.extracted.verified&&job.location?[]:['Faltan datos revisados o ubicación confirmada.']});
  if(action==='proposal')return send({proposal:{point:parcelPoint,parcelIds:[feature.id],source:'cadastral-identifiers'}});
  if(action==='locate'){assert.equal(body.location.parcels[0].id,feature.id);job.location={municipality:'tres-de-febrero',datasetVersion:dataset.version,parcels:[feature],parcel:feature,point:parcelPoint,confirmedAt:new Date().toISOString()};job.revision++;return send({...job,publicationIssues:[]});}
  if(action==='publish'){if(failPublish)return send({error:'No se confirmó el guardado.'},503);assert.equal(body.publicConsent,true);work=makeWork(job);job.status='published';job.publishedId=work.id;return send({result:'published',id:work.id});}
  if(action==='work')return send(work);
  return send({error:'Acción no simulada'},400);
 });
 await context.route('**/api/works-photo?**',route=>{job.revision++;return route.fulfill({json:{photo:true,revision:job.revision}});});
 await context.route('https://photon.komoot.io/**',route=>route.fulfill({json:{features:[{properties:{countrycode:'AR',county:'Partido de Tres de Febrero',street:'Cartel sintético',housenumber:'123'},geometry:{type:'Point',coordinates:parcelPoint}}]}}));
 await context.route('https://cdn.cafecito.app/**',route=>route.abort());
}
(async()=>{
 fs.mkdirSync('.checks',{recursive:true});
 const qrA=await QRCode.toBuffer(urlA,{width:400,margin:4}),qrB=await QRCode.toBuffer(urlB,{width:400,margin:4});
 const dual=await sharp({create:{width:1000,height:500,channels:3,background:'white'}}).composite([{input:qrA,left:30,top:40},{input:qrB,left:560,top:40}]).png().toBuffer();
 const blank=await sharp({create:{width:400,height:400,channels:3,background:'white'}}).png().toBuffer();
 fs.writeFileSync('.checks/qr-fixture.png',qrA);fs.writeFileSync('.checks/qr-multiple.png',dual);
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000}});await mockAPI(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>document.body.classList.contains('works-active'));
  assert(await page.locator('#worksHome').isVisible());assert(await page.locator('#explorer').isHidden());assert.equal(await page.locator('#worksMunicipality').inputValue(),'tres-de-febrero');assert.match(await page.locator('#worksList').innerText(),/Todavía no hay obras/);
  await page.screenshot({path:'.checks/works-desktop.png',fullPage:true});
  await page.locator('#urbanMode').click();assert(await page.locator('#explorer').isVisible());assert(await page.locator('#view3d').isDisabled());await page.locator('#worksMode').click();
  await page.locator('#addWork').click();const chooserPromise=page.waitForEvent('filechooser');await page.locator('#openWorkCamera').click();const chooser=await chooserPromise;assert.equal(await chooser.element().getAttribute('capture'),'environment');await chooser.setFiles([]);assert.match(await page.locator('#uploadStatus').innerText(),/Subir archivo/);
  await page.locator('#workFile').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await page.waitForFunction(()=>document.getElementById('uploadStatus').textContent.includes('No se pudo leer'));assert.equal(createCalls,0);
  await page.locator('#workFile').setInputFiles({name:'blank.png',mimeType:'image/png',buffer:blank});await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));await page.locator('#readWorkPhoto').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'),{},{timeout:90000});assert(await page.locator('#signReview').isVisible());assert(await page.locator('#textOnly').isChecked());assert(await page.locator('#qrURL').isVisible());await page.locator('#useOCR').uncheck();
  await page.locator('#workFile').setInputFiles({name:'multiple.png',mimeType:'image/png',buffer:dual});await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));await page.locator('#readWorkPhoto').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.locator('#qrChoices button').count(),2);await page.locator('#qrChoices button').first().click();assert([urlA,urlB].includes(await page.locator('#qrURL').inputValue()));
  await page.locator('#workFile').setInputFiles({name:'single.png',mimeType:'image/png',buffer:qrA});await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));await page.locator('#readWorkPhoto').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.locator('#qrURL').inputValue(),urlA);assert.equal(createCalls,0);
  await page.locator('#cancelWork').click();assert.equal(createCalls,0);await page.locator('#addWork').click();await page.locator('#sendWork').dblclick();await page.waitForSelector('#workContribution:not([hidden])');assert.equal(createCalls,1);assert.match(await page.locator('#jobIssues').innerText(),/no está disponible/);assert(await page.locator('#publishWork').isDisabled());
  await page.reload();await page.waitForSelector('#resumeWork:not([hidden])');await page.locator('#resumeWork').click();await page.waitForSelector('#workContribution:not([hidden])');assert.match(await page.locator('#jobIssues').innerText(),/no está disponible/);
  job.extracted={...extractNormalized(source,urlA),verified:true};job.issues=[];job.status='extracted';job.stage='Datos extraídos de fuente pública';
  await page.locator('#refreshJob').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));await page.locator('#locateWork').click();await page.waitForFunction(()=>Urban.selections.length===1);assert(await page.locator('#view3d').isEnabled());await page.locator('#view3d').click();assert.equal(await page.evaluate(()=>Legacy.state.flat),false);assert.equal(await page.locator('#affectedCount').innerText(),'0');
  await page.locator('#correctWorkLocation').click();assert(await page.locator('#address').isVisible());await page.locator('#confirmWorkLocation').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.match(await page.locator('#worksStatus').innerText(),/aproximada/);assert(await page.locator('#publishWork').isDisabled());
  await page.locator('#publicConsent').check();assert(await page.locator('#publishWork').isEnabled());failPublish=true;await page.locator('#publishWork').click();await page.waitForFunction(()=>document.getElementById('worksStatus').textContent.includes('No se confirmó'));assert.equal(work,null);
  failPublish=false;await page.locator('#publishWork').click();await page.waitForSelector('#workDetails:not([hidden])');assert.match(await page.locator('#worksStatus').innerText(),/Guardado confirmado/);const permanent=page.url();assert(permanent.includes('?obra='));await page.screenshot({path:'.checks/works-published-synthetic.png',fullPage:true});
  const other=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mockAPI(other);const phone=await other.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(permanent);await phone.waitForSelector('#workDetails:not([hidden])');assert.match(await phone.locator('#workDetails').innerText(),/Cartel sintético/);assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await phone.screenshot({path:'.checks/works-mobile-synthetic.png',fullPage:true});
  await phone.getByRole('button',{name:'Probar otra altura'}).click();assert(await phone.locator('#buildingHeight').isVisible());assert.equal(await phone.locator('#buildingHeight').inputValue(),'27');await phone.locator('#buildingHeight').fill('35');assert.equal(work.height,27);assert.equal(await phone.evaluate(()=>document.body.classList.contains('works-active')),false);
  await phone.locator('#saveProject').click();await phone.locator('#worksMode').click();await phone.locator('#urbanMode').click();assert.equal(await phone.locator('#buildingHeight').inputValue(),'35');await phone.locator('#savedProjects').click();assert.equal(await phone.locator('#projectList .saved-row').count(),1);await phone.locator('#projectsDialog [data-close]').click();
  assert.deepEqual(errors,[]);fs.writeFileSync('.checks/works-results.json',JSON.stringify({passed:true,scope:'Synthetic QR images; mock public API, no municipal or live Redis/Blob validation',checks:['explorer default','simulator navigation','camera chooser fallback','invalid image','unreadable QR','multiple QR','single QR','cancel before send','double click','pending unreachable permit','reload recovery','ground 3D confirmation','manual correction','publication failure','public consent','second browser permanent URL','mobile overflow','independent hypothetical height'],errors},null,2));
  console.log('PASS: Explorador, fotos/QR, pendientes, ubicación 3D, consentimiento, errores, enlace y móvil. API simulada; ningún proveedor municipal real validado.');await context.close();await other.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
