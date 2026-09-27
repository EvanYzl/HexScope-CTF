'use strict';
const {app,BrowserWindow,Menu,session,dialog,ipcMain,shell,screen}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const branding=require('./branding.json');
const {installDiskIPC}=require('./disk-ipc.cjs');
const {installPreviewIPC}=require('./preview-read.cjs');

app.setName('HexScope CTF');
if(typeof app.setAppUserModelId==='function')app.setAppUserModelId('org.hexscope.ctf');
// Keep the profile alongside the portable executable, without installation or
// registry changes. A read-only drive uses a temporary profile instead.
const portableRoot=path.dirname(app.getPath('exe'));
let profile=path.join(portableRoot,'portable-data');
try {fs.mkdirSync(profile,{recursive:true});fs.accessSync(profile,fs.constants.W_OK);}
catch {profile=fs.mkdtempSync(path.join(app.getPath('temp'),'HexScope-CTF-'));}
app.setPath('userData',profile);
const sessionProfile=path.join(profile,'session');
fs.mkdirSync(sessionProfile,{recursive:true});
app.setPath('sessionData',sessionProfile);

function createWindow(){
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width=Math.min(1440,Math.max(1,Math.floor(area.width)-32));
  const height=Math.min(920,Math.max(1,Math.floor(area.height)-32));
  const win=new BrowserWindow({width,height,minWidth:Math.min(760,width),minHeight:Math.min(540,height),
    x:Math.floor(area.x+(area.width-width)/2),y:Math.floor(area.y+(area.height-height)/2),
    title:branding.productName+' '+branding.displayVersion+' · '+branding.author,backgroundColor:'#f4f5f2',show:false,
    icon:path.join(__dirname,'assets','hexscope.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,
      webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,
      partition:'hexscope-offline-session',spellcheck:false}});
  const disk=installDiskIPC({ipcMain,dialog,shell},win,__dirname);
  installPreviewIPC({ipcMain},win,__dirname,disk.previewSnapshots);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('render-process-gone',(_event,details)=>{
    if(details.reason!=='clean-exit')dialog.showErrorBox('HexScope 页面已停止','渲染进程异常结束。请重新启动程序并减少一次处理的文件数量。原始文件未被修改。');
  });
  win.once('ready-to-show',()=>win.show());
  win.loadFile(path.join(__dirname,'HexScope.html')).catch(error=>{
    dialog.showErrorBox('无法载入 HexScope',error.message);app.quit();
  });
}

app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);
  const local=session.fromPartition('hexscope-offline-session');
  local.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  local.setPermissionCheckHandler(()=>false);
  local.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*','ftp://*/*']},(_details,callback)=>callback({cancel:true}));
  local.on('will-download',(_event,item)=>{
    item.setSaveDialogOptions({title:'保存 HexScope 导出文件',buttonLabel:'保存'});
  });
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
