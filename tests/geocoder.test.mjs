import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({stdin:{contents:"export {addressParts,photonResults} from './src/geocoder.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.checks/geocoder-tests.mjs'});
const {addressParts,photonResults}=await import(pathToFileURL(process.cwd()+'/.checks/geocoder-tests.mjs'));
const feature=(properties,point=[-58.5909268,-34.5919811])=>({type:'Feature',properties:{countrycode:'AR',county:'Partido de Tres de Febrero',...properties},geometry:{type:'Point',coordinates:point}});
// Names/types/bounds reproduced from Photon response of 2026-09-29.
const streetA=feature({osm_key:'highway',osm_value:'tertiary',type:'street',name:'749 - Aviador Germán Wernicke',extent:[-58.5922083,-34.6012927,-58.5918624,-34.6019352]},[-58.5920353,-34.6016139]);
const streetB=feature({osm_key:'highway',osm_value:'tertiary',type:'street',name:'749 - Aviador Germán Wernicke',extent:[-58.5910476,-34.5907632,-58.5908009,-34.5931996]});
const bus=feature({osm_key:'highway',osm_value:'bus_stop',type:'house',name:'Wernicke y Argentinas',street:'749 - Aviador Germán Wernicke'},[-58.5913168,-34.5963062]);

test('Wernicke response offers only a street reference, not a different house number or bus stop',()=>{
 const wrongHouse=feature({street:'749 - Aviador Germán Wernicke',housenumber:'749'});
 const rows=photonResults([streetA,streetB,bus,wrongHouse],'Aviador Wernicke 2236','tres-de-febrero');
 assert.equal(rows.length,1);assert.equal(rows[0].exact,false);assert.equal(rows[0].kind,'street');
 assert.match(rows[0].label,/numeración sin localizar/);assert.doesNotMatch(rows[0].label,/749|Argentinas|2236/);
 assert.deepEqual(rows[0].bounds,[-58.5922083,-34.6019352,-58.5908009,-34.5907632]);
 assert.deepEqual(photonResults([bus,wrongHouse],'Wernicke 2236','tres-de-febrero'),[]);
});

test('an exact street and house number outrank references, ignoring the street code prefix',()=>{
 const exact=feature({street:'749 - Aviador Germán Wernicke',housenumber:'2236'});
 const rows=photonResults([streetA,bus,exact],'Aviador Wernicke 2236','tres-de-febrero');
 assert.equal(rows.length,1);assert.equal(rows[0].exact,true);assert.match(rows[0].label,/2236/);assert.doesNotMatch(rows[0].label,/749/);
 assert.equal(photonResults([feature({street:'Wernickes',housenumber:'2236'})],'Wernicke 2236','tres-de-febrero').length,0);
});

test('numbered street names retain their digits and do not become house numbers',()=>{
 assert.deepEqual(addressParts('25 de Mayo 123, Ciudad Jardín'),{street:'25 de Mayo',number:'123'});
 assert.deepEqual(addressParts('Calle 123 456'),{street:'Calle 123',number:'456'});
 const rows=photonResults([feature({street:'25 de Mayo',housenumber:'123'})],'25 de Mayo 123','tres-de-febrero');assert.equal(rows[0].exact,true);
 assert.equal(photonResults([feature({street:'25 de Mayo',housenumber:'25'})],'25 de Mayo 123','tres-de-febrero').length,0);
});

test('place searches remain references and reject invalid coordinates and unrelated municipalities',()=>{
 const park=feature({name:'Plaza de prueba'});
 assert.equal(photonResults([park],'Plaza de prueba','tres-de-febrero')[0].exact,false);
 assert.deepEqual(photonResults([feature({name:'Plaza'},[Infinity,0]),feature({county:'Otro partido',street:'Wernicke',housenumber:'2236'})],'Wernicke 2236','tres-de-febrero'),[]);
});
