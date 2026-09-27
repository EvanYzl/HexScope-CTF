'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const MAX_READ=128*1024*1024,CHUNK=1024*1024;
const messages={
  CHANGED:'文件在导入后发生了变化，请重新选择或拖入该文件后预览。',
  MISSING:'找不到原文件，请确认文件未被移动、删除，所在磁盘仍已连接或挂载。',
  DENIED:'系统暂时无法读取该文件，请确认当前账户可读取文件，且文件未被其他程序独占。',
  CANCELLED:'预览已停止。',BUSY:'上一次读取尚未结束，请稍后重新载入。',
  INVALID:'无效的预览读取请求。',READ_FAILED:'无法完整读取文件，请重新选择文件后重试。'
};
function failure(code){return Object.assign(Error(messages[code]||messages.READ_FAILED),{code});}
function check(signal){if(signal?.aborted)throw failure('CANCELLED');}
function same(a,b){return ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);}
function matches(stat,args){return stat.isFile()&&stat.size===BigInt(args.size)&&Number(stat.mtimeNs/1000000n)===args.lastModified;}
function validate(args){
  if(!args||typeof args!=='object'||typeof args.path!=='string'||!path.isAbsolute(args.path)||args.path.includes('\0')||
    !Number.isSafeInteger(args.size)||args.size<0||!Number.isSafeInteger(args.lastModified)||
    !Number.isSafeInteger(args.offset)||args.offset<0||!Number.isSafeInteger(args.length)||args.length<0||
    args.length>MAX_READ||args.offset>args.size||args.length>args.size-args.offset)throw failure('INVALID');
}
// Only reads through an OS handle. Check both the open handle and its pathname
// after reading so an edited, removed or replaced evidence file is not displayed.
async function readPreview(args,{signal,io=fs}={}){
  validate(args);let handle;
  try{
    check(signal);handle=await io.open(args.path,'r');check(signal);
    const before=await handle.stat({bigint:true});if(!matches(before,args))throw failure('CHANGED');
    const bytes=Buffer.alloc(args.length);let position=0;
    while(position<bytes.length){
      check(signal);const {bytesRead}=await handle.read(bytes,position,Math.min(CHUNK,bytes.length-position),args.offset+position);
      if(!bytesRead)throw failure('CHANGED');position+=bytesRead;
    }
    check(signal);const after=await handle.stat({bigint:true}),named=await io.stat(args.path,{bigint:true});
    check(signal);if(!same(before,after)||!same(before,named))throw failure('CHANGED');return bytes;
  }catch(error){
    if(messages[error.code])throw error;
    if(['ENOENT','ENOTDIR','ENODEV'].includes(error.code))throw failure('MISSING');
    if(['EACCES','EPERM','EBUSY'].includes(error.code))throw failure('DENIED');
    throw failure('READ_FAILED');
  }finally{await handle?.close();}
}
function installPreviewIPC({ipcMain},win,root){
  const channel='hexscope:preview-read',active=new Map(),html=pathToFileURL(path.join(root,'HexScope.html')).href;
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel,async(event,operation,args)=>{
    let controller;
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame?.url!==html||
        !args||!Number.isSafeInteger(args.requestId)||args.requestId<1)throw failure('INVALID');
      if(operation==='cancel'){active.get(args.requestId)?.abort();return {ok:true,data:null};}
      if(operation!=='read'||active.has(args.requestId))throw failure('INVALID');
      if(active.size>=2)throw failure('BUSY');
      controller=new AbortController();active.set(args.requestId,controller);
      return {ok:true,data:await readPreview(args,{signal:controller.signal})};
    }catch(error){return {ok:false,code:messages[error.code]?error.code:'READ_FAILED',error:messages[error.code]||messages.READ_FAILED};}
    finally{if(controller)active.delete(args.requestId);}
  });
  win.on('closed',()=>{for(const controller of active.values())controller.abort();ipcMain.removeHandler(channel);});
}
module.exports={readPreview,installPreviewIPC,MAX_READ};
