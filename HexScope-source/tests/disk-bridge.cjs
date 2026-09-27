'use strict';
// Production main/preload handlers with a simulated Electron transport.
// Paths are limited to selected test files; no real desktop IPC is exercised.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {installDiskIPC}=require('../desktop/disk-ipc.cjs'),{installPreviewIPC}=require('../desktop/preview-read.cjs');
function bridge(t,nativePaths){
 const root=path.resolve(__dirname,'../desktop'),handlers=new Map(),listeners=[];
 const frame={url:pathToFileURL(path.join(root,'HexScope.html')).href},win={webContents:{mainFrame:frame,isDestroyed:()=>false,send(){}},on(name,fn){if(name==='closed')listeners.push(fn);}};
 const ipcMain={removeHandler:name=>handlers.delete(name),handle:(name,fn)=>handlers.set(name,fn)},event={sender:win.webContents,senderFrame:frame};
 const backend=installDiskIPC({ipcMain,dialog:{showOpenDialog:async()=>({filePaths:[path.join(__dirname,'fixtures/disk/split.E01')]})}},win,root);
 installPreviewIPC({ipcMain},win,root,backend.previewSnapshots);
 const exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(root,'preload.cjs'),'utf8'),{require:name=>{
  assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>exposed[key]=value},webUtils:{getPathForFile(file){if(nativePaths)return nativePaths.get(file)||'';throw Error('E01 snapshots must not ask the OS path of a generated File');}},
   ipcRenderer:{async invoke(channel,operation,args){calls.push({channel,operation,args});const result=await handlers.get(channel)(event,operation,args);return structuredClone(result);},on(){},removeListener(){}}};
 }});
 t.after(()=>{for(const fn of listeners)fn();});
 return {backend,calls,api:exposed.hexscopeDisk,files:exposed.hexscopeFiles};
}
module.exports={bridge};
