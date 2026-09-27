'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
function installVisionCapture({ipcMain,desktopCapturer,screen,globalShortcut,BrowserWindow},win,root){
 const channel='hexscope:vision-capture',url=pathToFileURL(path.join(root,'HexScope.html')).href,registered=new Set(),pins=new Set();let capturing=false;
 function unregister(){for(const key of registered)globalShortcut.unregister(key);registered.clear();}
 ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,op,args={})=>{
  try{
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame?.url!==url)throw Error('拒绝非主界面的截图请求。');
   if(op==='shortcuts'){
    unregister();if(args.enabled){for(const [key,ocr]of [['F7',false],['F8',true]]){
     if(globalShortcut.register(key,()=>{if(!win.webContents.isDestroyed())win.webContents.send(channel+'-shortcut',{ocr});}))registered.add(key);
     else{unregister();throw Error(key+' 已被其他程序占用。');}
    }}return {ok:true,data:{enabled:registered.size===2}};
   }
   if(op==='capture'){
    if(capturing)throw Error('截图正在进行。');capturing=true;const visible=win.isVisible();
    try{
     const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),scale=display.scaleFactor||1;
     const width=Math.max(1,Math.round(display.size.width*scale)),height=Math.max(1,Math.round(display.size.height*scale));
     if(width*height>32000000)throw Error('屏幕像素超过截图处理上限。');
     if(visible)win.hide();await new Promise(resolve=>setTimeout(resolve,250));
     const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width,height},fetchWindowIcons:false});
     const source=sources.find(s=>String(s.display_id)===String(display.id))||sources[0];
     if(!source||source.thumbnail.isEmpty())throw Error('系统未返回可用的屏幕图像。');
     return {ok:true,data:source.thumbnail.toPNG()};
    }finally{capturing=false;if(visible&&!win.isDestroyed())win.show();}
   }
   if(op==='pin'){
    if(!(args.bytes instanceof Uint8Array)||args.bytes.length>32*1024*1024||pins.size>=4)throw Error('贴图数量最多 4 个，单图上限 32 MiB。');
    const b=Buffer.from(args.bytes);if(b.length<24||b.toString('hex',0,8)!=='89504e470d0a1a0a'||b.readUInt32BE(16)*b.readUInt32BE(20)>32000000)throw Error('需要有效的 PNG 图片。');
    const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const pin=new BrowserWindow({width:Math.min(800,area.width),height:Math.min(650,area.height),alwaysOnTop:true,title:'HexScope · 图片贴图',
     autoHideMenuBar:true,icon:path.join(root,'assets/hexscope.ico'),webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    pins.add(pin);pin.on('closed',()=>pins.delete(pin));pin.webContents.setWindowOpenHandler(()=>({action:'deny'}));pin.webContents.on('will-navigate',e=>e.preventDefault());
    await pin.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>HexScope · 图片贴图</title><style>body{margin:0;background:#eff3ed;display:grid;place-items:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain}</style><img alt="图片贴图" src="data:image/png;base64,'+b.toString('base64')+'">'));
    return {ok:true,data:{pinned:true}};
   }
   throw Error('未知的截图操作。');
  }catch(e){return {ok:false,error:e.message};}
 });
 win.on('closed',()=>{unregister();for(const pin of pins)if(!pin.isDestroyed())pin.close();ipcMain.removeHandler(channel);});
}
module.exports={installVisionCapture};
