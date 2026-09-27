'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url'),{fork}=require('node:child_process');
const OPERATIONS=new Set(['capabilities','ocr','barcode-read','barcode-create','docx','xlsx','pdf-merge','pdf-overlay','pdf-raster']);
class VisionService{
 constructor({spawn=fork,timeout=300000,root=__dirname}={}){this.spawn=spawn;this.timeout=timeout;this.root=root;this.active=new Map();}
 run(id,op,args,progress=()=>{}){
  if(!Number.isSafeInteger(id)||id<1||this.active.has(id)||!OPERATIONS.has(op))return Promise.reject(Error('图文任务参数无效。'));
  if(this.active.size>=2)return Promise.reject(Error('已有两个图文任务运行，请等待或停止任务。'));
  return new Promise((resolve,reject)=>{
   const child=this.spawn(path.join(this.root,'vision-worker.cjs'),[],{execPath:process.execPath,
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','pipe','ipc']});
   let finished=false,diagnostic='';
   const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);this.active.delete(id);child.kill();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>done(Error('图文任务超过 5 分钟，已停止；可以缩小识别区域后重试。')),this.timeout);
   this.active.set(id,{cancel:()=>done(Error('图文任务已停止。'))});
   child.stderr?.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-1000);});
   child.on('message',message=>{if(finished)return;if(message.type==='progress')progress(message.value);
    else if(message.type==='result')done(null,message.value);else if(message.type==='error')done(Error(message.error));});
   child.on('error',e=>done(e));child.on('exit',()=>{if(!finished)done(Error('图文引擎异常退出。'+diagnostic));});
   child.send({op,args},error=>{if(error)done(error);});
  });
 }
 cancel(id){this.active.get(id)?.cancel();}
 close(){for(const entry of [...this.active.values()])entry.cancel();}
}
function installVisionIPC({ipcMain},win,root){
 const channel='hexscope:vision',service=new VisionService({root}),url=pathToFileURL(path.join(root,'HexScope.html')).href;
 ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,op,{id,args}={})=>{
  try{
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame?.url!==url)throw Error('拒绝非主界面的图文请求。');
   if(op==='cancel'){service.cancel(id);return {ok:true,data:null};}
   const data=await service.run(id,op,args,value=>{if(!win.webContents.isDestroyed())win.webContents.send(channel+'-progress',{id,...value});});
   return {ok:true,data};
  }catch(error){return {ok:false,error:error.message};}
 });
 win.on('closed',()=>{service.close();ipcMain.removeHandler(channel);});return service;
}
module.exports={VisionService,installVisionIPC,OPERATIONS};
