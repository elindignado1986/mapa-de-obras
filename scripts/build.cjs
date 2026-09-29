const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const esbuild=require('esbuild');

async function build(){
  const root=path.resolve(__dirname,'..');
  await esbuild.build({stdin:{contents:"export {connected,mergeParcels} from './src/parcel-selection.js'; export {center,validRing,footprintWithin} from './src/geometry.js';",resolveDir:root},bundle:true,platform:'node',format:'cjs',outfile:path.join(root,'server/works/geometry.cjs')});
  require('./build-works-index.cjs').buildWorksIndex(root);
  const ocrOutput=path.join(root,'data/works-ocr');
  fs.mkdirSync(ocrOutput,{recursive:true});
  fs.copyFileSync(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),path.join(ocrOutput,'worker.min.js'));
  for(const name of fs.readdirSync(path.join(root,'node_modules/tesseract.js-core')))if(/\.(wasm|js)$/.test(name))fs.copyFileSync(path.join(root,'node_modules/tesseract.js-core',name),path.join(ocrOutput,name));
  const spanish=path.join(root,'node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz');
  if(fs.existsSync(spanish))fs.copyFileSync(spanish,path.join(ocrOutput,'spa.traineddata.gz'));
  const manifestPath=path.join(root,'data/amba/municipality-manifest.json');
  if (process.env.VERCEL && fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (
    Object.values(manifest).some(
      m => m.available && m.redistribution !== 'approved'
    )
  ) {
    console.warn(
      'Advertencia: existen datasets ARBA cuya revisión de redistribución continúa pendiente.'
    );
  }
}
  const output=path.join(root,'publicar');
  const read=name=>fs.readFileSync(path.join(root,name),'utf8');
  const urban=await esbuild.build({entryPoints:[path.join(root,'src/main.js')],bundle:true,write:false,minify:true,format:'iife',target:'es2022',define:{__GOOGLE_MAPS_API_KEY__:JSON.stringify(process.env.GOOGLE_MAPS_API_KEY||'')}});
  fs.writeFileSync(path.join(root,'urban.bundle.js'),urban.outputFiles[0].contents);
  const hash=text=>crypto.createHash('sha256').update(text).digest('hex').slice(0,12);
  const scripts=['parcels.js','parcel-geometry.js','sound.js','sound-view.js','app.js'];
  let html=read('index.html');
  html=html.replace('<script src="urban.bundle.js"></script>','');
  const tags=[...html.matchAll(/<script\s+src="([^"]+)"\s*>\s*<\/script>/g)];
  if(JSON.stringify(tags.map(m=>m[1]))!==JSON.stringify(scripts))throw Error('Cambió la lista de scripts: revisar el orden antes de publicar.');
  const source=scripts.map(name=>read(name)).join('\n;\n')+'\n;\n'+Buffer.from(urban.outputFiles[0].contents).toString();
  const [js,css]=await Promise.all([
    esbuild.transform(source,{loader:'js',format:'iife',minify:true,sourcemap:false,target:'es2020',charset:'utf8',legalComments:'inline'}),
    esbuild.transform(read('style.css'),{loader:'css',minify:true,sourcemap:false,charset:'utf8',legalComments:'inline'})
  ]);
  const jsName=`app.${hash(js.code)}.min.js`,cssName=`style.${hash(css.code)}.min.css`;
  for(const tag of tags)html=html.replace(tag[0],'');
  html=html.replace('href="style.css"',`href="${cssName}"`).replace('</body>',`<script src="${jsName}"></script></body>`);
  const assets=['catastro-original2.png','mapa-original2.png','logo.png','cafecito-button.png'];
  const files=new Map([['index.html',Buffer.from(html)],[jsName,Buffer.from(js.code)],[cssName,Buffer.from(css.code)],['.nojekyll',Buffer.alloc(0)],...assets.map(name=>[name,fs.readFileSync(path.join(root,name))])]);
  // Only this fixed, non-symlink output folder may be cleaned. Never modify editable sources.
  if(!output.startsWith(root+path.sep)||path.basename(output)!=='publicar')throw Error('Carpeta de salida inválida.');
  if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('La carpeta publicar no puede ser un enlace.');
  fs.mkdirSync(output,{recursive:true});
  const allowed=name=>['index.html','.nojekyll',...assets].includes(name)||/^(app|style)\.[a-f0-9]{12}\.min\.(js|css)$/.test(name);
  for(const entry of fs.readdirSync(output,{withFileTypes:true}))if(entry.name!=='data'&&(!entry.isFile()||!allowed(entry.name)))throw Error('Archivo ajeno a la publicación: '+entry.name+'. Movelo fuera de publicar antes de reconstruir.');
  for(const [name,data]of files)fs.writeFileSync(path.join(output,name),data);
  for(const name of fs.readdirSync(output))if(name!=='data'&&!files.has(name))fs.unlinkSync(path.join(output,name));
  if(fs.existsSync(path.join(root,'data')))fs.cpSync(path.join(root,'data'),path.join(output,'data'),{recursive:true});
  if(fs.existsSync(manifestPath)){
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    for(const [id,m]of Object.entries(manifest))if(m.available&&!fs.existsSync(path.join(root,'data/amba',id,m.version))){m.available=false;m.status='en-preparacion';}
    fs.writeFileSync(path.join(output,'data/amba/municipality-manifest.json'),JSON.stringify(manifest,null,2));
  }
  const before=Buffer.byteLength(source)+Buffer.byteLength(read('style.css')),after=Buffer.byteLength(js.code)+Buffer.byteLength(css.code);
  console.log(`Versión lista: ${output}\nJavaScript + CSS: ${before.toLocaleString('es-AR')} → ${after.toLocaleString('es-AR')} bytes (${Math.round((1-after/before)*100)}% menos).\nSin mapas de código fuente. Publicar únicamente el contenido de esa carpeta.`);
}
build().catch(error=>{console.error(error.message);process.exitCode=1;});
