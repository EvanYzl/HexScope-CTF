'use strict';
// npm ci --ignore-scripts, then node build.cjs. NODE_PATH can point at a build-only dependency tree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('esbuild'),root=path.resolve(__dirname,'../..'),out=path.join(root,'desktop/vendor/vision');
fs.mkdirSync(out,{recursive:true});
const packageRoot=name=>path.dirname(require.resolve(name+'/package.json'));
const licenseDir=path.join(out,'licenses');fs.mkdirSync(licenseDir,{recursive:true});
async function bundle(name,options){await esbuild.build({bundle:true,platform:'node',target:'node22',format:'cjs',legalComments:'eof',minify:false,
 outfile:path.join(out,name),...options});}
async function main(){
 const mods=['tesseract.js','zxing-wasm','bwip-js','pdf-lib','@pdf-lib/fontkit','docx'];
 await bundle('libraries.cjs',{stdin:{contents:mods.map((name,i)=>`exports[${JSON.stringify(name)}]=require(${JSON.stringify(require.resolve(name))});`).join('\n'),resolveDir:__dirname}});
 await bundle('ocr-worker.cjs',{entryPoints:[path.join(packageRoot('tesseract.js'),'src/worker-script/node/index.js')],plugins:[{
  name:'local-ocr-core',setup(build){build.onResolve({filter:/^tesseract\.js-core\//},args=>({path:'./core/'+args.path.split('/')[1]+'.js',external:true}));}
 }]});
 const core=packageRoot('tesseract.js-core');fs.mkdirSync(path.join(out,'core'),{recursive:true});
 for(const file of fs.readdirSync(core))if(/^tesseract-core.*\.(wasm|js)$/.test(file)&&!file.endsWith('.wasm.js'))fs.copyFileSync(path.join(core,file),path.join(out,'core',file));
 fs.copyFileSync(require.resolve('zxing-wasm/full/zxing_full.wasm'),path.join(out,'zxing_full.wasm'));
 fs.copyFileSync(path.join(root,'preview/vendor/sheetjs.js'),path.join(out,'sheetjs.cjs'));
 // Preserve licenses for every resolved package, including transitive dependencies.
 const dependencyRoot=path.dirname(packageRoot('tesseract.js')),queue=[dependencyRoot],notices=[];
 while(queue.length){for(const entry of fs.readdirSync(queue.pop(),{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
  const dir=path.join(entry.parentPath,entry.name);if(entry.name.startsWith('@')){queue.push(dir);continue;}
  const p=path.join(dir,'package.json');if(!fs.existsSync(p))continue;
  const meta=JSON.parse(fs.readFileSync(p));notices.push({name:meta.name,version:meta.version,license:meta.license,repository:meta.repository});
  for(const name of fs.readdirSync(dir))if(/^(LICENSE|COPYING|NOTICE)/i.test(name)&&fs.statSync(path.join(dir,name)).isFile())fs.copyFileSync(path.join(dir,name),path.join(licenseDir,meta.name.replace(/[/@]/g,'_')+'-'+name));
 }}
 fs.writeFileSync(path.join(out,'dependencies.json'),JSON.stringify(notices,null,2)+'\n');
 const files={};for(const name of ['libraries.cjs','ocr-worker.cjs','zxing_full.wasm'])files[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,name))).digest('hex');
 fs.writeFileSync(path.join(out,'BUILD_INFO.json'),JSON.stringify({builtFrom:'vision/vendor-build/package-lock.json',files},null,2)+'\n');
 console.log('Built local OCR, barcode, PDF and DOCX dependencies');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
