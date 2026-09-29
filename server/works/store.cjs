const crypto = require('node:crypto');
const PREFIX = 'works:v1:';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function credentials() {
  // The Marketplace adds the custom prefix to the existing KV_* names.
  // Keep each URL/token pair together; never substitute a read-only token.
  for (const prefix of ['', 'kv_', 'KV_']) {
    const url=process.env[prefix+'KV_REST_API_URL'];
    const token=process.env[prefix+'KV_REST_API_TOKEN'];
    if(url&&token)return {url,token};
  }
  return null;
}
function configured() { return Boolean(credentials()); }
async function redis(command) {
  const connection=credentials();
  if (!connection) throw Object.assign(Error('El registro público necesita KV_REST_API_URL y KV_REST_API_TOKEN en el servidor (también se acepta el prefijo kv_ o KV_).'), {status:503});
  const response = await fetch(connection.url, {method:'POST', headers:{Authorization:`Bearer ${connection.token}`, 'Content-Type':'application/json'}, body:JSON.stringify(command), signal:AbortSignal.timeout(7000)});
  if (!response.ok) throw Error('No se pudo acceder al registro. Intentá nuevamente.');
  const data = await response.json();
  if (data.error) throw Error('No se pudo guardar o consultar el registro.');
  return data.result;
}
async function get(kind, id) { const value = await redis(['GET', PREFIX+kind+':'+id]); return value ? JSON.parse(value) : null; }
async function saveJob(job, expectedRevision) {
  const script = `local old=redis.call('GET',KEYS[1]); if not old or cjson.decode(old).revision~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); redis.call('RPUSH',KEYS[2],old); return 1`;
  job.revision = expectedRevision + 1;
  job.updatedAt = new Date().toISOString();
  const result = await redis(['EVAL',script,2,PREFIX+'job:'+job.id,PREFIX+'history:'+job.id,expectedRevision,JSON.stringify(job)]);
  if (!result) throw Object.assign(Error('El aporte cambió. Actualizá su estado antes de continuar.'),{status:409});
  return job;
}
async function createJob(id, token, input) {
  const now = new Date().toISOString();
  const job = {schemaVersion:1,id,ownerHash:hash(token),revision:0,status:'pending',stage:'Aporte pendiente',createdAt:now,updatedAt:now,input,extracted:{},issues:[],location:null};
  const script = `local old=redis.call('GET',KEYS[1]); if old then return old end; redis.call('SET',KEYS[1],ARGV[1]); return ARGV[1]`;
  const result = JSON.parse(await redis(['EVAL',script,1,PREFIX+'job:'+id,JSON.stringify(job)]));
  if (result.ownerHash !== hash(token)) throw Object.assign(Error('Identificador de aporte ocupado.'),{status:409});
  return result;
}
async function owned(req,id) {
  const job = await get('job',id), token = (req.headers.authorization||'').replace(/^Bearer /,'');
  if (!job || !token || job.ownerHash!==hash(token)) throw Object.assign(Error('No se encontró el aporte o falta su clave de recuperación.'),{status:404});
  return job;
}
function privateView(job) { const {ownerHash,...view}=job; return view; }
async function enqueue(id) { await redis(['ZADD',PREFIX+'queue',Date.now(),id]); }
async function rateLimit(req) {
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0];
  const key=PREFIX+'rate:'+hash(ip+':'+Math.floor(Date.now()/60000));
  const n=await redis(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",1,key]);
  if(n>30) throw Object.assign(Error('Demasiados pedidos. Esperá un minuto.'),{status:429});
}
module.exports={PREFIX,hash,configured,redis,get,saveJob,createJob,owned,privateView,enqueue,rateLimit};
