'use strict';
// Uses the built 4.1 DOM, real canvas encoding and actual child-process OCR.
// No browser, OS picker, native window or screenshot is exercised here.
const test=require('node:test'),assert=require('node:assert/strict'),{createCanvas,Image}=require('@napi-rs/canvas');
const {app}=require('./dom-helper.cjs'),{VisionService}=require('../desktop/vision-ipc.cjs');
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,15));}assert.fail('Timed out waiting for actual vision UI operation');}
function setup(t,options={}){
 const service=new VisionService(),calls=[],canvasMap=new WeakMap();t.after(()=>service.close());
 const ui=app(t,null,{beforeParse(w,blobs){
  let progress=()=>{};w.hexscopeVision={run:(id,op,args)=>{calls.push({id,op});return service.run(id,op,args,value=>progress({id,...value}));},cancel:id=>service.cancel(id),onProgress:fn=>{progress=fn;return ()=>{};}};
  function native(c){let v=canvasMap.get(c);if(!v){v=createCanvas(c.width||1,c.height||1);canvasMap.set(c,v);}if(v.width!==c.width)v.width=c.width;if(v.height!==c.height)v.height=c.height;return v;}
  w.HTMLCanvasElement.prototype.getContext=function(){const x=native(this).getContext('2d');return new Proxy(x,{get(target,key){if(key==='drawImage')return (img,...args)=>target.drawImage(img instanceof w.HTMLCanvasElement?native(img):img._image||img,...args);const value=target[key];return typeof value==='function'?value.bind(target):value;},set(target,key,value){target[key]=value;return true;}});};
  w.HTMLCanvasElement.prototype.toBlob=function(callback,type='image/png',quality){callback(new Blob([native(this).toBuffer(type)],{type}));};
  w.Image=class{constructor(){this._image=new Image();}set src(url){(async()=>{try{this._image.src=Buffer.from(await blobs.get(url).arrayBuffer());await this._image.decode();this.naturalWidth=this._image.width;this.naturalHeight=this._image.height;this.onload?.();}catch(e){this.onerror?.(e);}})();}};
  options.configure?.(w);
 }});return {...ui,service,calls,native:canvasMap};
}
function sample(){const c=createCanvas(1000,200),x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='50px Arial';x.fillText('HEXSCOPE OFFLINE 123456',35,95);return c.toBuffer('image/png');}

test('actual built OCR UI reads an E01 snapshot with an unreadable File reference and exports DOCX',async t=>{
 const bytes=sample();let reads=0;const ui=setup(t,{configure(w){w.hexscopeFiles={readSnapshot:async({snapshotId,offset,length})=>{assert.equal(snapshotId,'case-token');reads++;return bytes.subarray(offset,offset+length);}};}});
 ui.$('visionMode').click();await until(()=>ui.w.HexVision.state.capabilities);
 const file=new File([],'镜像图片.png');file._hexSnapshot={id:'case-token',size:bytes.length};file.slice=()=>{throw new Error('unreadable File must never be touched');};
 ui.w.HexVision.add([file]);await until(()=>ui.w.HexVision.state.loaded&&!ui.w.HexVision.state.busy);assert.equal(reads,1);
 for(const c of ui.$('visionLanguages').querySelectorAll('input'))c.checked=c.value==='eng';ui.$('visionOCR').click();await until(()=>!ui.w.HexVision.state.busy);assert.match(ui.$('visionOutput').value,/HEXSCOPE OFFLINE 123456/);
 ui.$('visionExportFormat').value='docx';ui.$('visionExport').click();await until(()=>ui.downloads.length===1);const data=new Uint8Array(await ui.downloads[0].blob.arrayBuffer()),F=require('../vendor/fflate.js');assert(F.unzipSync(data)['word/document.xml']);assert(ui.calls.some(x=>x.op==='ocr'));
});
test('actual built barcode UI roundtrips generated PNG and routes text into the existing codec workspace',async t=>{
 const ui=setup(t);ui.$('visionMode').click();await until(()=>ui.w.HexVision.state.capabilities);ui.$('visionBarcodeText').value='flag{vision_roundtrip}';ui.$('visionGenerate').click();await until(()=>!ui.w.HexVision.state.busy&&ui.w.HexVision.state.loaded);
 ui.$('visionDecode').click();await until(()=>!ui.w.HexVision.state.busy);assert.match(ui.$('visionOutput').value,/flag\{vision_roundtrip\}/);ui.$('visionCodec').click();assert.match(ui.$('codecInput').value,/flag\{vision_roundtrip\}/);assert.equal(ui.$('codecWorkspace').hidden,false);
 ui.$('visionMode').click();ui.$('visionToAnalysis').click();await until(()=>ui.w.HexApp.state.items.length===1);assert.equal(ui.w.HexApp.state.items[0].file.name,'图文结果.png');
});
test('vision workspace initializes offline without a native API and exposes no dead OCR success state',async t=>{
 const ui=app(t);ui.$('visionMode').click();assert.equal(ui.$('visionWorkspace').hidden,false);assert.match(ui.$('visionStatus').textContent,/Windows 便携版/);ui.$('visionOCR').click();await until(()=>!ui.w.HexVision.state.busy);assert.match(ui.$('visionStatus').textContent,/失败/);assert.equal(ui.w.HexApp.state.items.length,0);
});
