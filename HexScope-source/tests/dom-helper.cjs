// In-memory DOM / event unit tests. No browser is launched, and no URL is fetched.
// These tests do not validate browser rendering, native file pickers or CSP support.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const C=require('../src/core.js');
const html=require('./built-artifact.cjs').readBuiltHTML();
const fixture=name=>new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures',name)));
async function eventually(predicate,message='state transition') {
  const until=Date.now()+4000;
  while(Date.now()<until) {if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Timed out: '+message);
}
function app(t,diskApi,options={}) {
  const downloads=[],errors=[],blobs=new Map();let index=0;
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.hexscopeDisk=diskApi;
    Object.defineProperty(w.navigator,'hardwareConcurrency',{value:options.cores||4});
    w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.Blob=Blob;w.File=File;
    Object.defineProperty(w,'crypto',{value:options.random||webcrypto});
    w.URL.createObjectURL=blob=>{const id='blob:test-'+index++;blobs.set(id,blob);return id;};
    w.URL.revokeObjectURL=id=>blobs.delete(id);
    w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)});};
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    // Record drawing inputs only. This does not render canvas or test PNG encoding.
    w.ImageData=class {constructor(data,width,height){assert.equal(data.length,width*height*4);this.data=data;this.width=width;this.height=height;}};
    w.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){canvas._unitStroked=true;},putImageData(image){canvas._unitPixels=image.data;}};};
    w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([fixture('normal.png')],{type:'image/png'}));};
    // Runs the actual worker code in a separate VM context with mock messaging.
    w.Worker=options.workerFactory?options.workerFactory(blobs,w):class {
      constructor(url){this.source=blobs.get(url);this.dead=false;}
      async postMessage(data) {
        try {
          if(!this.context){
            const src=await this.source.text();if(this.dead)return;
            const context={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,Blob,File,DecompressionStream,crypto:webcrypto};
            context.self={postMessage:value=>{if(!this.dead)this.onmessage?.({data:value});}};
            context.globalThis=context.self;vm.runInNewContext(src,context);this.context=context;
          }
          if(!this.dead)await this.context.self.onmessage({data});
        }catch(error){if(!this.dead)this.onerror?.({message:error.message});}
      }
      terminate(){this.dead=true;}
    };
    options.beforeParse?.(w,blobs);
  }});

 if(!options.locked)require('./unlock.cjs')(dom.window);
  const w=dom.window,d=w.document,$=id=>d.getElementById(id);
  t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();assert.deepEqual(errors,[],'no DOM script errors');});
  const input=files=>{Object.defineProperty($('fileInput'),'files',{value:files,configurable:true});$('fileInput').dispatchEvent(new w.Event('change'));};
  const row=name=>Array.from(d.querySelectorAll('.file-row')).find(x=>x.textContent.includes(name));
  return {w,d,$,downloads,input,row};
}

module.exports={app,eventually};
