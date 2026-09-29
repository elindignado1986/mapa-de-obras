import {BrowserQRCodeReader} from '@zxing/browser';

export async function preparePhoto(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Elegí una imagen JPG, PNG o WebP.');
  if(file.size>12*1024*1024)throw Error('La foto supera 12 MB. Elegí una imagen más pequeña.');
  let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('No se pudo leer la imagen. Probá con otra foto.');}
  try{
    if(bitmap.width*bitmap.height>24000000)throw Error('La imagen supera 24 megapíxeles. Reducí su resolución.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob||blob.size>3*1024*1024)throw Error('La imagen procesada supera 3 MB. Reducí su tamaño.');
    return {canvas,blob,url:URL.createObjectURL(blob)};
  }finally{bitmap.close();}
}

export async function readQR(canvas){
  const results=new Set();
  if('BarcodeDetector' in window){try{const detector=new BarcodeDetector({formats:['qr_code']});for(const item of await detector.detect(canvas))results.add(item.rawValue);}catch{/* Portable fallback below. */}}
  const reader=new BrowserQRCodeReader();
  // Several finders in one image can confuse a single-QR decoder. Overlapping
  // crops isolate codes without assuming a particular municipal sign layout.
  const regions=[[0,0,1,1],[0,0,.6,1],[.4,0,.6,1],[0,0,1,.6],[0,.4,1,.6],...[0,.4].flatMap(x=>[0,.4].map(y=>[x,y,.6,.6]))];
  for(const [x,y,w,h]of regions){
    const copy=document.createElement('canvas');copy.width=Math.round(canvas.width*w);copy.height=Math.round(canvas.height*h);const ctx=copy.getContext('2d');ctx.drawImage(canvas,canvas.width*x,canvas.height*y,copy.width,copy.height,0,0,copy.width,copy.height);
    for(let i=0;i<4;i++){
      try{const result=reader.decodeFromCanvas(copy);results.add(result.getText());const points=result.getResultPoints();if(!points.length)break;const xs=points.map(p=>p.getX()),ys=points.map(p=>p.getY()),left=Math.min(...xs),top=Math.min(...ys),width=Math.max(...xs)-left,height=Math.max(...ys)-top,pad=Math.max(width,height)*.3;ctx.fillStyle='white';ctx.fillRect(left-pad,top-pad,width+2*pad,height+2*pad);}catch{break;}
    }
    if(results.size>=8)break;
  }
  return [...results];
}

export async function readText(canvas){
  const {createWorker}=await import('tesseract.js');
  const worker=await createWorker('spa',1,{workerPath:'/data/works-ocr/worker.min.js',corePath:'/data/works-ocr',langPath:'/data/works-ocr',workerBlobURL:false});
  const timeout=setTimeout(()=>worker.terminate(),60000);
  try{return (await worker.recognize(canvas)).data.text.slice(0,16000);}finally{clearTimeout(timeout);await worker.terminate();}
}
