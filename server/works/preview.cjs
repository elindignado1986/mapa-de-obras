const municipalities=require('../../config/ambaMunicipalities.json');
function previewFields(input){
 const bad=()=>{throw Object.assign(Error('Revisá la dirección, el municipio y la altura del proyecto.'),{status:400});};
 if(!input||typeof input!=='object'||Array.isArray(input))return bad();
 if(typeof input.address!=='string'||!input.address.trim()||input.address.length>250||!municipalities.some(m=>m.id===input.municipality))return bad();
 if(typeof input.height!=='number'||!Number.isFinite(input.height)||input.height<.1||input.height>300)return bad();
 if(typeof input.destination!=='string'||input.destination.length>250)return bad();
 return {address:input.address.trim(),municipality:input.municipality,height:input.height,destination:input.destination.trim(),origin:'user-preview',verified:false};
}
module.exports={previewFields};
