const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Worker:NodeWorker}=require('node:worker_threads'),{webcrypto}=require('node:crypto'),{JSDOM,VirtualConsole}=require('jsdom');
const {readBuiltHTML}=require('../../tests/built-artifact.cjs');
function page(diskApi){
 const errors=[],downloads=[],blobs=new Map(),active=new Set();let next=0;
 const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(readBuiltHTML(),{runScripts:'dangerously',url:'https://offline.invalid/',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){
  w.hexscopeDisk=diskApi;
  Object.assign(w,{TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Blob,File});
  Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=blob=>{const id='blob:hexscope-test/'+(++next);blobs.set(id,blob);return id;};w.URL.revokeObjectURL=id=>blobs.delete(id);
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)});};
  w.Worker=class{
   constructor(url){this.dead=false;active.add(this);const blob=blobs.get(url);this.ready=blob.text().then(source=>{if(this.dead)return;const bootstrap=`const {parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');const context={TextEncoder,TextDecoder,Uint8Array,Uint32Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,Blob,File,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,DecompressionStream,CompressionStream};context.self=context;context.globalThis=context;context.postMessage=value=>parentPort.postMessage(value);vm.createContext(context);vm.runInContext(workerData,context);parentPort.on('message',data=>context.onmessage({data}));`;this.native=new NodeWorker(bootstrap,{eval:true,workerData:source});this.native.on('message',data=>{if(!this.dead)this.onmessage?.({data});});this.native.on('error',e=>{if(!this.dead)this.onerror?.({message:e.message});});});
   }
   postMessage(value){this.ready.then(()=>{if(!this.dead)this.native.postMessage(value);});}
   terminate(){this.dead=true;this.native?.terminate();active.delete(this);}
  };
 }});

 require('../../tests/unlock.cjs')(dom.window);
 return {dom,w:dom.window,$:id=>dom.window.document.getElementById(id),errors,downloads,active,close(){for(const worker of active)worker.terminate();dom.window.close();}};
}
async function until(fn,timeout=6000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw Error('UI state timeout');await new Promise(r=>setTimeout(r,10));}}
async function execute(p){p.$('cryptoRun').click();await until(()=>!p.$('cryptoRun').disabled);assert.doesNotMatch(p.$('cryptoStatus').textContent,/未完成|未开始|运行失败/);}
function choose(p,id){p.$('cryptoManualTab').click();p.$('cryptoTool').value=id;p.$('cryptoTool').dispatchEvent(new p.w.Event('change'));p.$('cryptoLoadExample').click();}

module.exports={page,until,execute,choose};
