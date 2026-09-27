'use strict';
const fs=require('node:fs'),path=require('node:path');
function previewAssets(read){
 const assets={};
 for(const [key,file]of Object.entries({PREVIEW_CORE:'core.js',PREVIEW_PDF:'pdf.js',PREVIEW_UI:'ui.js',PREVIEW_CSS:'style.css',PREVIEW_HTML:'panel.html'}))assets[key]=read('preview/'+file);
 assets.PREVIEW_WORKER=['src/core.js','vendor/fflate.js','preview/vendor/mammoth.js','preview/vendor/sheetjs.js','preview/core.js','preview/worker.js'].map(file=>read(file)).join('\n;\n');
 assets.PREVIEW_PDF_LIBRARY=read('preview/vendor/pdfjs/pdf.bundle.js');
 assets.PREVIEW_PDF_WORKER=read('preview/vendor/pdfjs/pdf.worker.bundle.js');
 const map={};
 for(const folder of ['cmaps','standard_fonts','wasm'])for(const file of fs.readdirSync(path.join(__dirname,'vendor/pdfjs',folder)).sort()){
  if(/LICENSE|\.js$/.test(file))continue;
  map[folder+'/'+file]=read('preview/vendor/pdfjs/'+folder+'/'+file,'base64');
 }
 assets.PREVIEW_PDF_JSON=JSON.stringify(map);
 return assets;
}
module.exports={previewAssets};
