'use strict';
// Only for developers rebuilding the vendored browser bundles. No runtime install.
const path=require('node:path'),fs=require('node:fs'),{createHash}=require('node:crypto');
const esbuild=require('esbuild'),base=path.resolve(__dirname,'../vendor/pdfjs');
const mammoth=esbuild.buildSync({entryPoints:[require.resolve('mammoth/lib/index.js')],outfile:path.resolve(__dirname,'../vendor/mammoth.js'),bundle:true,format:'iife',globalName:'mammoth',platform:'browser',target:'chrome146',minify:true,legalComments:'inline',metafile:true});
const licenses=path.resolve(__dirname,'../vendor/mammoth-licenses'),packages=new Map();fs.mkdirSync(licenses,{recursive:true});
for(const input of Object.keys(mammoth.metafile.inputs)){
 let directory=path.dirname(path.resolve(input));
 while(directory!==path.dirname(directory)){
  const metadata=path.join(directory,'package.json');
  if(fs.existsSync(metadata)){const pkg=JSON.parse(fs.readFileSync(metadata));if(pkg.name)packages.set(pkg.name,{directory,pkg});break;}
  directory=path.dirname(directory);
 }
}
const manifest=[];
// JSZip's published browser entry contains its own prebundled dependencies.
// Retain the licenses of the complete pinned Mammoth dependency closure as well.
function includeDependencies(name,from){
 const metadata=require.resolve(name+'/package.json',{paths:[from]}),directory=path.dirname(metadata),pkg=JSON.parse(fs.readFileSync(metadata));
 if(packages.has(pkg.name)&&packages.get(pkg.name).walked)return;
 packages.set(pkg.name,{directory,pkg,walked:true});
 for(const dependency of Object.keys(pkg.dependencies||{}))includeDependencies(dependency,directory);
}
includeDependencies('mammoth',__dirname);
for(const {directory,pkg}of [...packages.values()].sort((a,b)=>a.pkg.name.localeCompare(b.pkg.name))){
 const files=fs.readdirSync(directory).filter(x=>/^(licen[sc]e|copying|notice)/i.test(x)&&fs.statSync(path.join(directory,x)).isFile());
 if(!files.length)for(const file of fs.readdirSync(directory).filter(x=>/^readme/i.test(x))){if(/permission is hereby granted/i.test(fs.readFileSync(path.join(directory,file),'utf8')))files.push(file);}
 if(!files.length)throw Error('Missing third-party license: '+pkg.name);
 const folder=pkg.name.replace(/[^a-z0-9.-]/gi,'_');fs.mkdirSync(path.join(licenses,folder),{recursive:true});
 for(const file of files)fs.copyFileSync(path.join(directory,file),path.join(licenses,folder,file));
 manifest.push({name:pkg.name,version:pkg.version,license:pkg.license,files:files.map(file=>folder+'/'+file)});
}
fs.writeFileSync(path.join(licenses,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
for(const [file,name] of [['pdf','HexPdf'],['pdf.worker','HexPdfWorker']]){
 esbuild.buildSync({entryPoints:[path.join(base,'legacy/build',file+'.mjs')],outfile:path.join(base,file+'.bundle.js'),bundle:true,format:'iife',globalName:name,platform:'browser',target:'chrome146',minify:true,legalComments:'inline',define:{process:'undefined','import.meta.url':'"about:blank"'}});
}
const record={builder:'esbuild 0.25.5',pdfjs:'6.3.289',modifications:'Official legacy ESM files (including upstream core-js polyfills) bundled as local browser IIFEs; process is undefined; unused Node import.meta.url becomes about:blank.',files:{}};
record.mammothSHA256=createHash('sha256').update(fs.readFileSync(path.resolve(base,'../mammoth.js'))).digest('hex');
for(const file of ['pdf.bundle.js','pdf.worker.bundle.js'])record.files[file]=createHash('sha256').update(fs.readFileSync(path.join(base,file))).digest('hex');
fs.writeFileSync(path.join(base,'BUNDLE_INFO.json'),JSON.stringify(record,null,2)+'\n');
console.log(record);
