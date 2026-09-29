// Messages describe what was observed, never assert that the printed QR is broken.
function qrNotice(job={}){
 const status=job.qrStatus;
 if(status==='unavailable'||job.stage==='Permiso inaccesible; texto del cartel disponible')return 'No pudimos consultar el permiso del QR. Continuamos con el texto visible del cartel.';
 if(status==='available')return 'Se pudo consultar el QR. Revisá los datos antes de continuar.';
 if(job.status==='processing')return 'QR leído. Estamos consultando el permiso; podés continuar con el texto del cartel.';
 if(job.status==='queued')return 'QR leído. La consulta del permiso está pendiente; podés continuar con el texto del cartel.';
 const codes=job.input?.detectedQR;
 if(!Array.isArray(codes))return job.input?.qrURL?'El aporte incluye un enlace QR, pero su disponibilidad no está confirmada. Podés continuar con el texto del cartel.':'';
 if(!codes.length)return 'No se pudo leer el QR de esta foto. Continuamos con el texto visible del cartel.';
 if(codes.length>1)return 'Se detectaron varios QR. Continuamos con el texto del cartel sin elegir un enlace automáticamente.';
 try{const url=new URL(codes[0]);if(url.protocol!=='https:'||url.username||url.password)throw Error();}
 catch{return 'El QR no contiene un enlace HTTPS utilizable para consultar el permiso. Continuamos con el texto del cartel.';}
 return 'QR leído. Todavía no se pudo confirmar el contenido del permiso; continuamos con el texto del cartel.';
}
module.exports={qrNotice};
