const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const shard=key=>createHash('sha256').update(key).digest('hex').slice(0,2);
const cadastralId=id=>id.replace(/-[a-f0-9]{16}$/,'');
function buildWorksIndex(root){
  const {center}=require('../server/works/geometry.cjs');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/amba/municipality-manifest.json'),'utf8'));
  for(const municipality of ['tres-de-febrero','hurlingham','castelar','san-isidro','ituzaingo']){
    const m=manifest[municipality];if(!m?.available)continue;
    const input=path.join(root,'data/amba',municipality,m.version),output=path.join(root,'data/works-index',municipality,m.version);
    if(!fs.existsSync(input)||fs.existsSync(path.join(output,'complete.json')))continue;
    const buckets=new Map(),seen=new Set();
    for(const filename of fs.readdirSync(input).filter(x=>/^[-\d]+_[-\d]+\.json$/.test(x))){
      for(const f of JSON.parse(fs.readFileSync(path.join(input,filename),'utf8')).features){const id=String(f.id);if(seen.has(id))continue;seen.add(id);const entry={id,point:center(f.geometry)};
        for(const key of new Set([id,cadastralId(id)])){const code=shard(key);if(!buckets.has(code))buckets.set(code,{});const bucket=buckets.get(code);(bucket[key]||=[]).push(entry);}
      }
    }
    fs.mkdirSync(output,{recursive:true});for(const [code,rows]of buckets)fs.writeFileSync(path.join(output,code+'.json'),JSON.stringify(rows));
    fs.writeFileSync(path.join(output,'complete.json'),JSON.stringify({datasetVersion:m.version,parcelCount:seen.size}));
  }
}
module.exports={buildWorksIndex,shard,cadastralId};
