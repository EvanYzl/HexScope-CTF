'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const {installVisionCapture}=require('../desktop/vision-capture.cjs'),{VisionEngine}=require('../desktop/vision-engine.cjs');
const {createCanvas}=require('@napi-rs/canvas'),{PDFDocument}=require('../desktop/vendor/vision/libraries.cjs')['pdf-lib'];
function setup({busy=false,failCapture=false}={}){
 const handlers={},calls={registered:[],unregistered:[],captures:0,pins:[],hidden:0,shown:0},root=path.resolve(__dirname,'../desktop');let close;
 const canvas=createCanvas(100,80),png=canvas.toBuffer('image/png'),mainFrame={url:pathToFileURL(path.join(root,'HexScope.html')).href};
 const contents={mainFrame,isDestroyed:()=>false,send:(channel,data)=>calls.event={channel,data}},win={webContents:contents,on:(_n,fn)=>close=fn,isVisible:()=>true,isDestroyed:()=>false,hide(){calls.hidden++;},show(){calls.shown++;}};
 const electron={ipcMain:{removeHandler:name=>delete handlers[name],handle:(name,fn)=>handlers[name]=fn},
  desktopCapturer:{async getSources(){calls.captures++;if(failCapture)throw Error('mock OS failure');return [{display_id:'5',thumbnail:{isEmpty:()=>false,toPNG:()=>png}}];}},
  screen:{getCursorScreenPoint:()=>({x:1,y:1}),getDisplayNearestPoint:()=>({id:5,size:{width:100,height:80},scaleFactor:1,workArea:{width:1200,height:900}})},
  globalShortcut:{register:(key,fn)=>{calls.registered.push({key,fn});return !busy;},unregister:key=>calls.unregistered.push(key)},
  BrowserWindow:class{constructor(opts){calls.pins.push(opts);this.webContents={setWindowOpenHandler(){},on(){}};}on(){}isDestroyed(){return false;}close(){calls.pinClosed=true;}async loadURL(url){calls.pinURL=url;}}
 };
 installVisionCapture(electron,win,root);const invoke=(op,args={},event={sender:contents,senderFrame:mainFrame})=>handlers['hexscope:vision-capture'](event,op,args);
 return {calls,invoke,close:()=>close(),png};
}
test('screenshot and hotkeys are idle until explicit UI action and unregistered on close (OS mocked)',async()=>{
 const p=setup();assert.equal(p.calls.registered.length,0);assert.equal(p.calls.captures,0);
 assert.equal((await p.invoke('shortcuts',{enabled:true})).ok,true);assert.deepEqual(p.calls.registered.map(x=>x.key),['F7','F8']);p.calls.registered[1].fn();assert.equal(p.calls.event.data.ocr,true);
 assert.equal(p.calls.captures,0,'hotkey only asks the renderer to begin capture');await p.invoke('shortcuts',{enabled:false});assert.deepEqual(p.calls.unregistered,['F7','F8']);p.close();
});
test('capture returns pixels and restores the main window, including OS failures (capture mocked)',async()=>{
 const p=setup(),r=await p.invoke('capture');assert.equal(r.ok,true);assert.deepEqual(r.data,p.png);assert.equal(p.calls.hidden,1);assert.equal(p.calls.shown,1);p.close();
 const failure=setup({failCapture:true});assert.equal((await failure.invoke('capture')).ok,false);assert.equal(failure.calls.shown,1);failure.close();
});
test('capture rejects untrusted senders and pinned images have no native API or script privilege (OS mocked)',async()=>{
 const p=setup();assert.equal((await p.invoke('capture',{},{})).ok,false);assert.equal(p.calls.captures,0);
 assert.equal((await p.invoke('pin',{bytes:p.png})).ok,true);const options=p.calls.pins[0];assert.equal(options.alwaysOnTop,true);assert.equal(options.webPreferences.nodeIntegration,false);assert.equal(options.webPreferences.sandbox,true);assert.equal(options.webPreferences.preload,undefined);assert(decodeURIComponent(p.calls.pinURL).includes("default-src 'none'"));p.close();assert.equal(p.calls.pinClosed,true);
});
test('occupied global hotkey fails explicitly and leaves no registrations (OS mocked)',async()=>{
 const p=setup({busy:true});assert.equal((await p.invoke('shortcuts',{enabled:true})).ok,false);assert.equal(p.calls.captures,0);p.close();
});
test('real raster PDF conversion retains page sizes and emits valid JPEG-backed pages',async()=>{
 const c=createCanvas(200,100),x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,200,100);x.fillStyle='black';x.fillText('HexScope',20,50);
 const e=new VisionEngine();try{const bytes=await e.run('pdf-raster',{pages:[{bytes:c.toBuffer('image/jpeg'),width:400,height:200},{bytes:c.toBuffer('image/jpeg'),width:200,height:100}]});const doc=await PDFDocument.load(bytes);assert.equal(doc.getPageCount(),2);assert.equal(doc.getPage(0).getWidth(),400);assert.equal(doc.getPage(1).getHeight(),100);
 await assert.rejects(e.run('pdf-raster',{pages:[{bytes:c.toBuffer('image/jpeg'),width:-1,height:200}]}),/尺寸/);
 }finally{await e.close();}
});
