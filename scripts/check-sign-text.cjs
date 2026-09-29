const {chromium}=require('@playwright/test');
const sharp=require('sharp'),assert=require('node:assert/strict'),fs=require('node:fs');
const {extractSignText}=require('../server/works/sign-text.cjs');
(async()=>{
 fs.mkdirSync('.checks',{recursive:true});
 // Synthetic typography exercises real local OCR, not the user's unavailable image file.
 const fixture=Buffer.from('<svg width="1600" height="700"><rect width="1600" height="700" fill="white"/><g font-family="Arial" font-size="52" fill="black"><text x="380" y="80">Municipalidad de Tres de Febrero</text><text x="380" y="220">DIRECCION: PRUEBA 123</text><text x="380" y="320">ALTURA: 27 METROS</text><text x="380" y="420">DESTINO: VIVIENDA MULTIFAMILIAR</text><text x="380" y="520">EXPEDIENTE: 12345</text></g></svg>');
 const png=await sharp(fixture).png().toBuffer();let job,creates=0;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({viewport:{width:1100,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://cdn.cafecito.app/**',r=>r.abort());
  await context.route('**/api/works?**',async route=>{const action=new URL(route.request().url()).searchParams.get('action');let body;try{body=route.request().postDataJSON();}catch{}const send=json=>route.fulfill({json});
   if(action==='config')return send({registry:true,photos:true});if(action==='list')return send({enabled:true,works:[],nextOffset:null});
   if(action==='create'){creates++;job={id:body.id,input:body,revision:0,status:'pending',extracted:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};return send(job);}
   if(action==='process'){assert.equal(body.textOnly,true);job.input.ocrText=body.ocrText;job.signExtraction=extractSignText(body.ocrText);job.status='review-required';job.revision++;return send(job);}
   if(action==='job')return send({...job,publicationIssues:['Datos sin verificar.'],issues:[]});
   return route.fulfill({status:400,json:{error:'Unexpected request '+action}});
  });
  await context.route('**/api/works-photo?**',route=>{job.revision++;job.photo={pathname:'private/mock.jpg'};return route.fulfill({json:{photo:true,revision:job.revision}});});
  await page.goto(process.env.TEST_ORIGIN||'http://localhost:4174');await page.locator('#addWork').click();
  await page.locator('#workFile').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('invalid')});await page.waitForFunction(()=>document.getElementById('uploadStatus').textContent.includes('No se pudo leer'));
  assert.equal(creates,0);assert(await page.locator('#sendWork').isDisabled());
  await page.locator('#workFile').setInputFiles({name:'cartel-sin-qr.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));
  assert.equal(await page.locator('#workUpload button').count(),2);
  await page.locator('#sendWork').dblclick();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'),{},{timeout:120000});
  fs.writeFileSync('.checks/synthetic-ocr.txt',job?.input?.ocrText||'');
  assert.equal(creates,1);assert(await page.locator('#workContribution').isVisible());assert.equal(await page.locator('#signAddress').inputValue(),'PRUEBA 123');assert.equal(await page.locator('#signHeight').inputValue(),'27');assert.equal(await page.locator('#signMunicipality').inputValue(),'tres-de-febrero');assert(await page.locator('#verifiedWorkflow').isHidden());
  await page.screenshot({path:'.checks/sign-ocr-review.png',fullPage:true});
  await page.reload();await page.locator('#resumeWork').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));assert.equal(await page.locator('#signHeight').inputValue(),'27');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.checks/sign-ocr-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  fs.writeFileSync('.checks/sign-ocr-results.json',JSON.stringify({passed:true,ocr:'Real local Spanish OCR on synthetic sign without QR',storage:'Mock API',checks:['invalid photo','one processing button','automatic OCR fallback','basic fields','double click','private save','reload recovery','no publication','mobile layout'],errors},null,2));console.log('PASS: OCR real sobre cartel sintético, flujo simple, guardado privado y recuperación. API simulada.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
