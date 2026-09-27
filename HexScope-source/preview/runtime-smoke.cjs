'use strict';
// Read-only computation smoke test using only the released HTML and runtime.
// It tests PDF parsing/text, not native GUI rendering or browser layout.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Worker}=require('node:worker_threads');
const bootstrap=`const {parentPort,workerData}=require('node:worker_threads'),vm=require('node:vm');const listeners=new Set();
 const r={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,Blob,File,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,performance,atob,btoa,structuredClone,ReadableStream,WritableStream,TransformStream,AbortController,DOMException,URL,URLSearchParams,Response,Request,Headers,DecompressionStream,CompressionStream};
 r.self=r;r.globalThis=r;r.onmessage=null;r.importScripts=()=>{throw Error('Network scripts prohibited');};r.postMessage=(v,t)=>parentPort.postMessage(v,t);r.addEventListener=(n,f,o)=>{if(n==='message'){listeners.add(f);o?.signal?.addEventListener('abort',()=>listeners.delete(f));}};r.removeEventListener=(n,f)=>listeners.delete(f);vm.createContext(r);vm.runInContext(workerData,r);parentPort.on('message',data=>{r.onmessage?.({data});for(const f of listeners)f({data});});`;
function script(html,id){const match=html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)</script>'));assert(match,id);return match[1];}
async function run(html,exampleDirectory){
 const worker=new Worker(bootstrap,{eval:true,workerData:script(html,'previewWorkerSource')});let serial=0;
 const request=data=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{done();reject(Error('Packaged preview worker timed out'));},20000);function done(){clearTimeout(timer);worker.off('message',receive);worker.off('error',error);}function receive(v){if(v.id!==id)return;done();v.ok?resolve(v.result):reject(Error(v.error));}function error(e){done();reject(e);}worker.on('message',receive);worker.once('error',error);worker.postMessage({...data,id});});
 const fixture=name=>new Uint8Array(fs.readFileSync(path.join(exampleDirectory,name)));
 try{
  const word=await request({action:'open',kind:'docx',name:'sample.docx',bytes:fixture('sample.docx')});assert.match(word.html,/flag\{docx_preview\}/);assert.match(word.html,/<table>/);assert.match(word.html,/data:image\/png/);
  const book=await request({action:'open',kind:'spreadsheet',name:'sample.xlsx',bytes:fixture('sample.xlsx')});assert.equal(book.rows[1].cells[1].text,'1,234.50');const hidden=await request({action:'sheet',sheet:1});assert.equal(hidden.rows[0].cells[0].text,'flag{hidden_sheet}');
 }finally{await worker.terminate();}
 const live=new Set(),urls=new Map();let next=0;
 class Port{
  constructor(url){this.dead=false;this.listeners=new Map();live.add(this);this.ready=urls.get(url).text().then(code=>{if(this.dead)return;this.worker=new Worker(bootstrap,{eval:true,workerData:code});this.worker.on('message',data=>{for(const fn of this.listeners.keys())fn({data});});this.worker.on('error',error=>this.onerror?.(error));});}
  addEventListener(n,f,o){if(n==='message'){this.listeners.set(f,true);o?.signal?.addEventListener('abort',()=>this.listeners.delete(f));}}
  removeEventListener(n,f){this.listeners.delete(f);}
  postMessage(v,t){this.ready.then(()=>{if(!this.dead)this.worker.postMessage(v,t);});}
  terminate(){this.dead=true;live.delete(this);return this.worker?.terminate();}
 }
 class LocalURL extends URL{}LocalURL.createObjectURL=blob=>{const id='blob:runtime/'+(++next);urls.set(id,blob);return id;};LocalURL.revokeObjectURL=id=>urls.delete(id);
 const context={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,Blob,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,queueMicrotask,performance,atob,btoa,structuredClone,ReadableStream,WritableStream,TransformStream,AbortController,DOMException,Response,Request,Headers,URL:LocalURL,Worker:Port,
  DOMMatrix:class{},document:{getElementById(id){return {textContent:script(html,id)};}}};
 context.window=context;context.self=context;context.globalThis=context;vm.createContext(context);vm.runInContext(script(html,'previewPdfLibrary')+'\n;'+script(html,'previewPdfCode'),context);
 let session;const timeout=setTimeout(()=>{for(const port of live)port.terminate();},20000);
 try{
  session=context.HexPreviewPDF.open(fixture('sample.pdf'));const pdf=await session.promise;assert.equal(pdf.numPages,2);const page=await pdf.getPage(1),text=await page.getTextContent();assert(text.items.some(x=>x.str.includes('flag{pdf_page_one}')));
  return {office:'actual packaged worker: DOCX text/table/image, XLSX formatted cell and hidden worksheet passed',pdf:'actual packaged PDF worker: two-page PDF and text extraction passed',assets:'CMaps, fonts and WASM embedded in tested HTML',network:'no fetching implemented in the verification harness',nativeRendering:'not tested by this smoke; native off-screen canvas tested by developer suite'};
 }finally{clearTimeout(timeout);session?.destroy().catch(()=>{});for(const port of live)await port.terminate();}
}
module.exports={run};
