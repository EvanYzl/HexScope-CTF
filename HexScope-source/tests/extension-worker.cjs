'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractWorker}=require('../extensions/extract-worker.cjs');
const vendor=path.resolve(__dirname,'../extensions/vendor/cyberchef');
let source;const config=require('../extensions/OperationConfig.json');
function defaults(op,catalog=config){return catalog[op].args.map(a=>{
 if(a.type==='editableOption')return a.value[0].value;
 if(a.type==='option'||a.type==='argSelector')return typeof a.value[0]==='object'?a.value[0].name:a.value[0];
 if(a.type==='toggleString')return {option:a.toggleValues?.[0]||'UTF8',string:a.value};return a.value;
});}
function chef({directory}={}){
 const assets=directory?path.join(directory,'vendor/cyberchef'):vendor,catalog=directory?JSON.parse(fs.readFileSync(path.join(directory,'OperationConfig.json'),'utf8')):config;
 const actualSource=directory?extractWorker(fs.readFileSync(path.join(assets,'assets/main.js'),'utf8')):(source??=extractWorker(fs.readFileSync(path.join(vendor,'assets/main.js'),'utf8')));
 let listener,serial=0;const pending=new Map(),timers=new Set(),events=[];
 const scope={console,TextEncoder,TextDecoder,URL,Blob,File,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Uint8ClampedArray,DataView,BigInt,atob,btoa,WebAssembly,crypto:require('node:crypto').webcrypto,performance,
  setTimeout:(fn,ms,...args)=>{const t=setTimeout(fn,ms,...args);timers.add(t);return t;},clearTimeout,
  location:{href:'https://offline.test/assets/worker.js',origin:'https://offline.test'},navigator:{userAgent:'HexScope unit test',hardwareConcurrency:2},
  fetch:()=>Promise.reject(Error('Network disabled in offline test')),addEventListener:(name,fn)=>{if(name==='message')listener=fn;},
  postMessage:m=>{events.push(m.action);if(!['bakeComplete','bakeError'].includes(m.action))return;const p=pending.get(m.data.id);if(!p)return;pending.delete(m.data.id);clearTimeout(p.timer);m.action==='bakeError'||m.data.error?p.reject(Error(String(m.data.result||m.data.error))):p.resolve(m.data);}};
 scope.self=scope;scope.globalThis=scope;
 scope.importScripts=(...urls)=>{for(const url of urls){const file=path.basename(new URL(url,'https://offline.test/').pathname);if(!/^[A-Za-z0-9.-]+\.js$/.test(file))throw Error('Invalid module');vm.runInContext(fs.readFileSync(path.join(assets,'modules',file),'utf8'),scope,{filename:file,timeout:30000});}};
 vm.createContext(scope);vm.runInContext(actualSource,scope,{filename:'packaged-ChefWorker.js',timeout:30000});listener({data:{action:'docURL',data:'https://offline.test/index.html'}});
 return {scope,events,close(){for(const timer of timers)clearTimeout(timer);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test closed'));}pending.clear();},
  run(input,steps){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Recipe timeout'));},20000);pending.set(id,{resolve,reject,timer});listener({data:{action:'bake',data:{input,recipeConfig:steps.map(s=>typeof s==='string'?{op:s,args:defaults(s,catalog)}:s),options:{returnType:'string'},id}}});});}};
}
module.exports={chef,defaults};
