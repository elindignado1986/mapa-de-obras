const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||'.'),port=Number(process.env.PORT||4173);
http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/works')){
  res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));return res;};
  const route=new URL(req.url,'http://localhost').pathname;
  if(!['/api/works','/api/works-photo'].includes(route))return res.status(404).json({error:'Ruta no encontrada.'});
  if(route==='/api/works'&&req.method==='POST'){try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000)return res.status(413).json({error:'Aporte demasiado grande.'});chunks.push(chunk);}req.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return res.status(400).json({error:'JSON inválido.'});}}
  return require('../api/'+(route.endsWith('works-photo')?'works-photo':'works')+'.js')(req,res);
 }
if(req.url==='/api/community'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled:false}));return;}let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end();return}if(name==='/'||name==='/embed/')name='/index.html';const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||name.includes('/.')){res.writeHead(403).end();return}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end('No encontrado');return}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data)});}).listen(port,'127.0.0.1',()=>console.log(`http://localhost:${port}`));
