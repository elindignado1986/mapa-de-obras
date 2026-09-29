import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const store=require('../server/works/store.cjs');
const handler=require('../api/works.js');
const keys=['','kv_','KV_'].flatMap(prefix=>['KV_REST_API_URL','KV_REST_API_TOKEN','KV_REST_API_READ_ONLY_TOKEN'].map(key=>prefix+key));

test('Marketplace prefixed credentials enable the public registry and reach Redis',async()=>{
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]])),originalFetch=global.fetch;
  for(const key of keys)delete process.env[key];
  const res=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  try{
    for(const prefix of ['kv_','KV_']){
      process.env[prefix+'KV_REST_API_URL']='https://redis.example.invalid';
      process.env[prefix+'KV_REST_API_TOKEN']='synthetic-write';
      process.env[prefix+'KV_REST_API_READ_ONLY_TOKEN']='synthetic-read';
      let calls=0;
      global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://redis.example.invalid');assert.equal(options.headers.Authorization,'Bearer synthetic-write');return {ok:true,json:async()=>({result:[]})};};
      const config=res();await handler({method:'GET',url:'/api/works?action=config',headers:{}},config);assert.equal(config.body.registry,true);
      const list=res();await handler({method:'GET',url:'/api/works?action=list',headers:{}},list);assert.equal(list.statusCode,200);assert.equal(list.body.enabled,true);assert.deepEqual(list.body.works,[]);assert.equal(calls,1);
      for(const key of keys)delete process.env[key];
    }
    process.env.KV_REST_API_URL='https://first.example.invalid';
    process.env.kv_KV_REST_API_TOKEN='different-database-token';
    process.env.KV_REST_API_READ_ONLY_TOKEN='read-only';
    assert.equal(store.configured(),false,'Never mix incomplete pairs or use a read-only token');
    process.env.kv_KV_REST_API_URL='https://second.example.invalid';
    process.env.KV_REST_API_TOKEN='canonical-token';
    global.fetch=async(url,options)=>{assert.equal(url,'https://first.example.invalid');assert.equal(options.headers.Authorization,'Bearer canonical-token');return {ok:true,json:async()=>({result:'PONG'})};};
    assert.equal(await store.redis(['PING']),'PONG','Canonical pair takes precedence');
  }finally{global.fetch=originalFetch;for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
