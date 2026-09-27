'use strict';
// Actual worker threads and native off-screen canvas; no browser window or network.
const {Worker:NodeWorker}=require('node:worker_threads'),{webcrypto}=require('node:crypto'),{JSDOM,VirtualConsole}=require('jsdom');
const {DOMMatrix,Path2D,ImageData,createCanvas}=require('@napi-rs/canvas');
const {readBuiltHTML,script}=require('./built-artifact.cjs');
const bootstrap=`const {parentPort,workerData,MessageChannel}=require('node:worker_threads'),vm=require('node:vm');
 const listeners=new Set(),r={TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,Blob,File,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,performance,atob,btoa,structuredClone,ReadableStream,WritableStream,TransformStream,AbortController,DOMException,URL,URLSearchParams,MessageChannel,DecompressionStream,CompressionStream};
 Object.assign(r,{Response,Request,Headers});r.self=r;r.globalThis=r;r.window=undefined;r.onmessage=null;r.importScripts=()=>{throw Error('External scripts prohibited in preview tests');};r.postMessage=(value,transfer)=>parentPort.postMessage(value,transfer);
 r.addEventListener=(name,fn,options)=>{if(name==='message'){listeners.add(fn);options?.signal?.addEventListener('abort',()=>listeners.delete(fn));}};r.removeEventListener=(name,fn)=>listeners.delete(fn);
 vm.createContext(r);vm.runInContext(workerData,r);parentPort.on('message',data=>{r.onmessage?.({data});for(const fn of listeners)fn({data});});`;
function createPort(source,onClose=()=>{}){
 const worker=new NodeWorker(bootstrap,{eval:true,workerData:source}),listeners=new Map();
 return {native:worker,addEventListener(name,fn,options){if(name!=='message')return;const run=data=>fn({data});listeners.set(fn,run);worker.on('message',run);options?.signal?.addEventListener('abort',()=>this.removeEventListener(name,fn));},removeEventListener(name,fn){const run=listeners.get(fn);if(run)worker.off('message',run);listeners.delete(fn);},postMessage(data,transfer){worker.postMessage(data,transfer);},terminate(){onClose();return worker.terminate();}};
}
function previewWorker(){
 const port=createPort(script(readBuiltHTML(),'previewWorkerSource'));let serial=0;
 return {port,close:()=>port.terminate(),run(data){const id=++serial;return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{done();reject(Error('Preview worker timeout'));port.terminate();},15000);
  function done(){clearTimeout(timer);port.native.off('message',message);port.native.off('error',error);}
  function message(value){if(value.id!==id)return;done();value.ok?resolve(value.result):reject(Error(value.error));}function error(e){done();reject(e);}
  port.native.on('message',message);port.native.once('error',error);port.postMessage({...data,id});
 });}};
}
function page(diskApi){
 const errors=[],blobs=new Map(),workers=new Set();let serial=0;const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(readBuiltHTML(),{runScripts:'dangerously',url:'https://offline.invalid/',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.hexscopeDisk=diskApi;
  Object.assign(w,{TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,Blob,File,DOMMatrix,Path2D,ImageData,ReadableStream,WritableStream,TransformStream,structuredClone,AbortController});
  Object.assign(w,{Response,Request,Headers});Object.defineProperty(w,'crypto',{value:webcrypto});w.matchMedia=()=>({matches:false});
  w.URL.createObjectURL=blob=>{const id='blob:preview-test/'+(++serial);blobs.set(id,blob);return id;};w.URL.revokeObjectURL=id=>blobs.delete(id);
  w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
  w.HTMLCanvasElement.prototype.getContext=function(){
   if(!this._native||this._native.width!==this.width||this._native.height!==this.height){this._native=createCanvas(Math.max(1,this.width),Math.max(1,this.height));const ctx=this._native.getContext('2d'),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>draw(image?._native||image,...args);}
   return this._native.getContext('2d');
  };
  w.Worker=class{
   constructor(url){this.dead=false;this.listeners=new Map();workers.add(this);this.ready=blobs.get(url).text().then(source=>{if(this.dead)return;this.port=createPort(source);this.port.native.on('message',data=>{if(this.dead)return;this.onmessage?.({data});for(const fn of this.listeners.keys())fn({data});});this.port.native.on('error',e=>{if(!this.dead)this.onerror?.({message:e.message});});});}
   postMessage(data,transfer){this.ready.then(()=>{if(!this.dead)this.port.postMessage(data,transfer);});}
   addEventListener(name,fn,options){if(name==='message'){this.listeners.set(fn,true);options?.signal?.addEventListener('abort',()=>this.listeners.delete(fn));}}
   removeEventListener(name,fn){this.listeners.delete(fn);}
   terminate(){this.dead=true;this.port?.terminate();workers.delete(this);}
  };
 }});
 require('./unlock.cjs')(dom.window);

 const w=dom.window,$=id=>w.document.getElementById(id);
 return {dom,w,$,errors,blobs,workers,async open(bytes,name){w.HexApp.state.auto=false;const file=new File([bytes],name);w.HexApp.addFiles([file]);const item=w.HexApp.state.items.at(-1);w.HexApp.state.selected=item.id;w.HexApp.showTab('preview');await until(()=>$('previewStop').disabled||!$('previewPasswordForm').hidden,15000);return item;},close(){w.HexPreview.cleanup();for(const worker of workers)worker.terminate();dom.window.close();}};
}
async function until(predicate,timeout=10000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw Error('Preview UI state timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
module.exports={previewWorker,page,until,createPort,bootstrap};
