'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {Forensics,parsePartitions}=require('./forensics.cjs');
const {WindowsMount}=require('./windows-mount.cjs'),{convertVhd,validateSize}=require('./vhd.cjs');
const OPERATIONS=new Set(['status','open','openDropped','list','details','analyze','analyzeBatch','planAnalysis','exportFiles','close','cancel','hashCapabilities','selectHashFile','selectHashDropped','hashImage','hashFile','hashEntry']);
for(const name of ['convertVhd','selectVhd','mountVhd','unmountVhd','mountStatus','openMounted','driveLetters'])OPERATIONS.add(name);
function trusted(event,win,html){return event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url===pathToFileURL(html).href;}
function installDiskIPC({ipcMain,dialog,shell},win,root){
  const service=new Forensics(path.join(root,'engines','tsk','bin'));
  const mounts=new WindowsMount(root);
  ipcMain.removeHandler('hexscope:disk');let lastProgress=0;
  const notify=value=>{const now=Date.now(),complete=value.complete||(Number.isFinite(value.total)&&value.done===value.total);if(now-lastProgress<200&&!complete)return;lastProgress=now;if(!win.webContents.isDestroyed())win.webContents.send('hexscope:disk-progress',value);};
  ipcMain.handle('hexscope:disk',async(event,operation,args={})=>{
    try{
      if(!trusted(event,win,path.join(root,'HexScope.html'))||!OPERATIONS.has(operation))throw Error('拒绝无效的镜像请求');
      if(!args||typeof args!=='object'||Array.isArray(args))throw Error('无效参数');
      if(operation==='cancel'){if(mounts.systemBusy)throw Error('Windows 正在处理挂载或卸载，请先完成或取消管理员授权。');service.cancel();return {ok:true,data:true};}
      const data=await service.task(async()=>{
        switch(operation){
          case 'driveLetters':return Array.from({length:23},(_,i)=>String.fromCharCode(68+i)).map(letter=>({letter,occupied:fs.existsSync(letter+':\\')}));
          case 'convertVhd':{
            mounts.assertSelectable();
            const image=service.image(args.imageId);validateSize(image.mediaBytes,image.sectorSize);
            const pick=await dialog.showOpenDialog(win,{title:'选择 VHD 转换位置（需要接近源盘容量的可用空间）',properties:['openDirectory','createDirectory']});
            if(pick.canceled||!pick.filePaths.length)return null;
            const result=await convertVhd(service,image.id,pick.filePaths[0],notify);const selected=await mounts.select(result.filename,image.partitions,image.name);return {...selected,conversion:result.manifest};
          }
          case 'selectVhd':{
            mounts.assertSelectable();
            const pick=await dialog.showOpenDialog(win,{title:'选择固定 VHD（也可重新选择已挂载的转换结果）',properties:['openFile'],filters:[{name:'固定 VHD',extensions:['vhd']}]});
            if(pick.canceled||!pick.filePaths.length)return null;
            let partitions=[];try{partitions=parsePartitions((await service.run('mmls',['-i','vhd',pick.filePaths[0]])).data.toString('utf8')).partitions;}catch{service.check();}
            return mounts.select(pick.filePaths[0],partitions);
          }
          case 'mountVhd':{
            const item=mounts.image(args.vhdId);if(!item.partitions.some(p=>p.offset*p.sectorSize===args.offsetBytes))throw Error('请选择 VHD 中已识别的分区；裸分区镜像请在软件内浏览。');
            return mounts.execute('mount',args);
          }
          case 'unmountVhd':return mounts.execute('unmount',args);
          case 'mountStatus':return mounts.execute('status',args);
          case 'openMounted':{
            const info=await mounts.execute('status',args);if(!info.attached||!info.readOnly)throw Error('此 VHD 尚未确认只读挂载。');
            const partition=info.partitions.find(p=>p.letter===args.letter&&/^[D-Z]$/.test(p.letter));if(!partition)throw Error('没有确认的盘符，请刷新挂载状态。');
            const error=await shell.openPath(partition.letter+':\\');if(error)throw Error(error);return true;
          }
          case 'hashCapabilities':return service.hashCapabilities();
          case 'selectHashFile':{
            const pick=await dialog.showOpenDialog(win,{title:'选择需要计算完整哈希的单个文件',properties:['openFile']});
            if(pick.canceled||!pick.filePaths.length)return null;return service.selectHashFile(pick.filePaths[0]);
          }
          case 'selectHashDropped':return service.selectHashFile(args.path);
          case 'hashFile':return service.hashFile(args,notify);
          case 'hashImage':return service.hashImage(args,notify);
          case 'hashEntry':return service.hashEntry(args,notify);
          case 'status':return service.status();
          case 'open':{
            const pick=await dialog.showOpenDialog(win,{title:'打开取证镜像（分卷请选择首卷）',properties:['openFile'],filters:[{name:'取证与磁盘镜像',extensions:['E01','Ex01','dd','raw','img','001','vhd','vhdx','vmdk','aff']},{name:'全部文件',extensions:['*']}]});
            if(pick.canceled||!pick.filePaths.length)return null;return service.open(pick.filePaths[0]);
          }
          case 'openDropped':return service.open(args.path);
          case 'list':return service.list(args);
          case 'details':return service.details(args);
          case 'analyze':return service.analyze(args);
          case 'analyzeBatch':return service.analyzeBatch(args);
          case 'planAnalysis':return service.planAnalysis(args);
          case 'exportFiles':{
            service.image(args.imageId);
            const pick=await dialog.showOpenDialog(win,{title:'选择导出位置（创建独立子文件夹）',properties:['openDirectory','createDirectory']});
            if(pick.canceled||!pick.filePaths.length)return null;return service.exportFiles(args,pick.filePaths[0],notify);
          }
          case 'close':service.current=null;service.entryMap.clear();return true;
        }
      });
      return {ok:true,data};
    }catch(error){return {ok:false,error:String(error.message||error).slice(0,7000)};}
  });
  win.on('closed',()=>{service.dispose();ipcMain.removeHandler('hexscope:disk');});
  return service;
}
module.exports={installDiskIPC,trusted};
