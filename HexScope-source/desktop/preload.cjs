'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
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
