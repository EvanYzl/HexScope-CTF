'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('hexscopeVision',{
  run:async(id,op,args)=>{const result=await ipcRenderer.invoke('hexscope:vision',op,{id,args});if(!result?.ok)throw Error(result?.error||'图文任务失败');return result.data;},
  cancel:id=>ipcRenderer.invoke('hexscope:vision','cancel',{id}),
  capture:async(op,args={})=>{const result=await ipcRenderer.invoke('hexscope:vision-capture',op,args);if(!result?.ok)throw Error(result?.error||'截图操作失败');return result.data;},
  onShortcut:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('hexscope:vision-capture-shortcut',listener);return ()=>ipcRenderer.removeListener('hexscope:vision-capture-shortcut',listener);},
  onProgress:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('hexscope:vision-progress',listener);return ()=>ipcRenderer.removeListener('hexscope:vision-progress',listener);}
});
let snapshotReleaseRequest=Number.MAX_SAFE_INTEGER;
contextBridge.exposeInMainWorld('hexscopeFiles',{
  readSnapshot:async({snapshotId,offset,length,requestId})=>{
    const result=await ipcRenderer.invoke('hexscope:preview-read','snapshot',{snapshotId,offset,length,requestId});
    if(!result?.ok)throw Error(result?.error||'镜像预览副本读取失败，请重新推送文件。');return result.data;
  },
  releaseSnapshots:ids=>ipcRenderer.invoke('hexscope:preview-read','releaseSnapshots',{ids,requestId:snapshotReleaseRequest--}),
  readPreview:async(file,{offset,length,requestId})=>{
    // Paths come only from a real File selected/dropped by the user, never from
    // renderer-supplied strings. E01 snapshots use their dedicated token API;
    // other generated files return null and are read from their in-memory bytes.
    const filename=webUtils.getPathForFile(file);if(!filename)return null;
    const result=await ipcRenderer.invoke('hexscope:preview-read','read',{
      path:filename,size:file.size,lastModified:file.lastModified,offset,length,requestId
    });
    if(!result?.ok)throw Error(result?.error||'本机文件读取失败，请重新选择文件。');return result.data;
  },
  cancelPreview:requestId=>ipcRenderer.invoke('hexscope:preview-read','cancel',{requestId})
});
async function invoke(operation,args={}){const result=await ipcRenderer.invoke('hexscope:disk',operation,args);if(!result?.ok)throw Error(result?.error||'镜像操作失败');return result.data;}
contextBridge.exposeInMainWorld('hexscopeDisk',{
  status:()=>invoke('status'),
  hashCapabilities:()=>invoke('hashCapabilities'),
  selectHashFile:()=>invoke('selectHashFile'),
  selectHashDropped:file=>invoke('selectHashDropped',{path:webUtils.getPathForFile(file)}),
  hashFile:args=>invoke('hashFile',args),
  hashImage:args=>invoke('hashImage',args),
  hashEntry:args=>invoke('hashEntry',args),
  convertVhd:args=>invoke('convertVhd',args),
  selectVhd:()=>invoke('selectVhd'),
  mountVhd:args=>invoke('mountVhd',args),
  unmountVhd:args=>invoke('unmountVhd',args),
  mountStatus:args=>invoke('mountStatus',args),
  openMounted:args=>invoke('openMounted',args),
  driveLetters:()=>invoke('driveLetters'),
  open:()=>invoke('open'),
  openDropped:file=>invoke('openDropped',{path:webUtils.getPathForFile(file)}),
  list:args=>invoke('list',args),
  details:args=>invoke('details',args),
  analyze:args=>invoke('analyze',args),
  analyzeBatch:args=>invoke('analyzeBatch',args),
  planAnalysis:args=>invoke('planAnalysis',args),
  exportFiles:args=>invoke('exportFiles',args),
  close:()=>invoke('close'),
  cancel:()=>invoke('cancel'),
  onProgress:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('hexscope:disk-progress',listener);return ()=>ipcRenderer.removeListener('hexscope:disk-progress',listener);}
});
