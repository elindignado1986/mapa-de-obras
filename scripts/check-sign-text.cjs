const {chromium}=require('@playwright/test');
const sharp=require('sharp');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {extractSignText}=require('../server/works/sign-text.cjs');
(async()=>{
 const fixture=Buffer.from('<svg width="1600" height="700"><rect width="1600" height="700" fill="white"/><g font-family="Arial" font-size="64" fill="black"><text x="50" y="100">PERMISO DE OBRA: 12345</text><text x="50" y="220">DIRECCION: PRUEBA 123</text><text x="50" y="340">ALTURA: 27 METROS</text><text x="50" y="460">PISOS: 8</text><text x="50" y="580">SUPERFICIE TOTAL: 450 M2</text></g></svg>');
 const png=await sharp(fixture).png().toBuffer();let job;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({viewport:{width:1100,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://cdn.cafecito.app/**',r=>r.abort());
  await context.route('**/api/works?**',async route=>{const action=new URL(route.request().url()).searchParams.get('action');let body;try{body=route.request().postDataJSON();}catch{}const send=json=>route.fulfill({json});
   if(action==='config')return send({registry:true,photos:true});if(action==='list')return send({enabled:true,works:[],nextOffset:null});
   if(action==='create'){job={id:body.id,input:body,revision:0,status:'pending',extracted:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};return send(job);}
   if(action==='process'){assert.equal(body.textOnly,true);job.input.ocrText=body.ocrText;job.input.ocrEdited=body.ocrEdited;job.signExtraction=extractSignText(body.ocrText,undefined,body.ocrEdited);job.status='review-required';job.stage='Texto del cartel leído; requiere revisión';job.revision++;return send(job);}
   if(action==='job')return send({...job,publicationIssues:['Datos sin verificar.'],issues:[]});return route.fulfill({status:400,json:{error:'Unexpected request'}});
  });
  await context.route('**/api/works-photo?**',route=>{job.revision++;return route.fulfill({json:{photo:true,revision:job.revision}});});
  await page.goto(process.env.TEST_ORIGIN||'http://localhost:4174');await page.locator('#addWork').click();
  await page.locator('#workFile').setInputFiles({name:'cartel-sin-qr.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>!document.body.classList.contains('works-busy'));
  await page.locator('#readWorkPhoto').click();await page.waitForFunction(()=>!document.body.classList.contains('works-busy'),{},{timeout:90000});
  assert(await page.locator('#textOnly').isChecked());assert(await page.locator('#signReview').isVisible());assert.match(await page.locator('#signCandidates').innerText(),/Altura \(m\): 27/);assert.match(await page.locator('#signCandidates').innerText(),/PRUEBA 123/);
  await page.locator('#signRawText').fill('Permiso: 12345\nDirección: Prueba 123\nAltura: 28 m\nPisos: 8');await page.locator('#extractSignFields').click();assert.match(await page.locator('#signCandidates').innerText(),/corregido por el aportante/);
  await page.screenshot({path:'.checks/sign-ocr-review.png',fullPage:true});await page.locator('#sendWork').click();await page.waitForSelector('#workContribution:not([hidden])');assert.equal(job.signExtraction.fields.height.value,28);assert.equal(job.signExtraction.fields.height.origin,'user-transcribed');assert.equal(job.signExtraction.verified,false);assert(await page.locator('#publishWork').isDisabled());
  await page.reload();await page.locator('#resumeWork').click();await page.waitForSelector('#workContribution:not([hidden])');assert.match(await page.locator('#jobFields').innerText(),/Altura \(m\): 28/);
  await page.setViewportSize({width:390,height:844});await page.locator('#replacePhoto').click();assert.match(await page.locator('#signRawText').inputValue(),/Altura: 28/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.checks/sign-ocr-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  fs.writeFileSync('.checks/sign-ocr-results.json',JSON.stringify({passed:true,ocr:'Real local Spanish OCR on synthetic sign without QR',storage:'Mock API',checks:['automatic fallback','field extraction','editable text','provenance','pending save without worker','reload recovery','no publication','mobile layout'],errors},null,2));console.log('PASS: OCR real sin QR, campos, corrección, guardado pendiente y recarga. API simulada.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
