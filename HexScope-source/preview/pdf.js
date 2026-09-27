(function(root){
'use strict';
let assetMap=null;
class OfflineBinaryDataFactory{
 async fetch({kind,filename}){
  const folder={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'}[kind];
  if(!folder||!filename||filename.includes('/')||filename.includes('\\'))throw Error('PDF 内置资源名称无效');
  assetMap??=JSON.parse(document.getElementById('previewPdfAssets').textContent);
  const encoded=assetMap[folder+'/'+filename];if(!encoded)throw Error('未内置此 PDF 资源：'+filename);
  return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 }
}
function library(){
 if(!root.HexPdf){const tag=document.createElement('script');tag.textContent=document.getElementById('previewPdfLibrary').textContent;document.head.append(tag);tag.remove();}
 if(!root.HexPdf)throw Error('PDF 组件无法启动，请使用 Windows 便携版或新版浏览器。');
 return root.HexPdf;
}
function open(bytes,{onPassword=()=>{},...options}={}){
 const pdf=library(),url=URL.createObjectURL(new Blob([document.getElementById('previewPdfWorker').textContent],{type:'text/javascript'}));
 let port,worker,task;
 try{
  port=new Worker(url);worker=new pdf.PDFWorker({port});
  task=pdf.getDocument({data:bytes,worker,BinaryDataFactory:OfflineBinaryDataFactory,useWorkerFetch:false,useSystemFonts:false,
   cMapPacked:true,cMapUrl:'https://offline.invalid/cmaps/',standardFontDataUrl:'https://offline.invalid/standard_fonts/',wasmUrl:'https://offline.invalid/wasm/',
   enableXfa:false,maxImageSize:16000000,canvasMaxAreaInBytes:64000000,disableAutoFetch:true,verbosity:0,...options});
  task.onPassword=onPassword;
 }catch(error){port?.terminate();worker?.destroy();URL.revokeObjectURL(url);throw error;}
 let dead=false;
 return {promise:task.promise,task,async destroy(){
  if(dead)return;dead=true;
  // Let PDF.js reject outstanding transport promises, then release the port.
  const stop=task.destroy().catch(()=>{});worker.destroy();port.terminate();URL.revokeObjectURL(url);await stop;
 }};
}
root.HexPreviewPDF={open,OfflineBinaryDataFactory};
})(window);
