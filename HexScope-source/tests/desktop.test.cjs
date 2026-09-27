const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
async function boot(readOnly=false,workArea={x:0,y:0,width:1920,height:1040}){
  const calls={windows:[],paths:{},events:{},sessionEvents:{},webEvents:{}},local={protocol:{handle:()=>{}},
    setPermissionRequestHandler:h=>calls.requestPermission=h,setPermissionCheckHandler:h=>calls.checkPermission=h,
    webRequest:{onBeforeRequest:(filter,h)=>{calls.filter=filter;calls.network=h;}},on:(event,h)=>calls.sessionEvents[event]=h};
  class BrowserWindow{
    constructor(options){calls.windows.push(options);this.webContents={setWindowOpenHandler:h=>calls.newWindow=h,on:(name,h)=>calls.webEvents[name]=h};}
    once(event,fn){if(event==='ready-to-show')fn();}show(){calls.shown=true;}loadFile(file){calls.loaded=file;return Promise.resolve();}
    static getAllWindows(){return [1];}
  }
  const cursor={x:workArea.x+10,y:workArea.y+10};
  const electron={protocol:{registerSchemesAsPrivileged:()=>{}},BrowserWindow,screen:{getCursorScreenPoint:()=>cursor,getDisplayNearestPoint:point=>{assert.equal(point,cursor);return {workArea};}},app:{setName:name=>calls.name=name,getPath:key=>key==='exe'?path.join('X:','portable','HexScope-CTF.exe'):'TMP',setPath:(key,val)=>calls.paths[key]=val,whenReady:()=>Promise.resolve(),on:(name,fn)=>calls.events[name]=fn,quit:()=>calls.quit=true},Menu:{setApplicationMenu:menu=>calls.menu=menu},session:{fromPartition:name=>{calls.partition=name;return local;}},dialog:{showErrorBox:()=>{}}};
  vm.runInNewContext(code,{__dirname:'/packaged/resources/app',require:name=>name==='electron'?electron:name==='./extensions-protocol.cjs'?require('../desktop/extensions-protocol.cjs'):name==='./branding.json'?require('../desktop/branding.json'):name==='./disk-ipc.cjs'?{installDiskIPC:(_electron,_win,root)=>{calls.diskRoot=root;return {previewSnapshots:'shared store'};}}:name==='./vision-capture.cjs'?{installVisionCapture:()=>{calls.captureInstalled=true;}}:name==='./vision-ipc.cjs'?{installVisionIPC:()=>{calls.visionInstalled=true;}}:name==='./preview-read.cjs'?{installPreviewIPC:(_electron,_win,root,store)=>{calls.previewRoot=root;assert.equal(store,'shared store');}}:name==='node:fs'?{mkdirSync:p=>{if(readOnly&&!p.startsWith('TMP'))throw Error('read only');},accessSync:()=>{},mkdtempSync:prefix=>prefix+'test',constants:{W_OK:2}}:require(name)});
  await Promise.resolve();return calls;
}
test('desktop launcher loads bundled HTML in a sandbox with no Node exposed to files',async()=>{const c=await boot();assert.equal(c.name,'HexScope CTF');assert.equal(c.windows[0].title,'HexScope CTF 4.1 · 是羊羊羊呀');assert.equal(c.windows[0].icon,path.join('/packaged/resources/app','assets','hexscope.ico'));assert.equal(c.windows[0].webPreferences.nodeIntegration,false);assert.equal(c.windows[0].webPreferences.sandbox,true);assert.equal(c.windows[0].webPreferences.contextIsolation,true);assert.equal(c.windows[0].webPreferences.webSecurity,true);assert(c.loaded.endsWith('HexScope.html'));assert.equal(c.newWindow().action,'deny');});
test('portable profile stays beside executable and has read-only fallback',async()=>{const a=await boot(),b=await boot(true);assert(a.paths.userData.endsWith('portable-data'));assert(b.paths.userData.startsWith('TMP'));});
test('desktop denies network, permissions and navigation but provides download options',async()=>{const c=await boot();let result;c.network({},r=>result=r);assert.equal(result.cancel,true);assert.equal(c.checkPermission(),false);c.requestPermission(null,null,x=>result=x);assert.equal(result,false);let stopped=false;c.webEvents['will-navigate']({preventDefault:()=>stopped=true});assert.equal(stopped,true);c.sessionEvents['will-download'](null,{setSaveDialogOptions:o=>result=o});assert.equal(result.buttonLabel,'保存');});
test('initial window and minimum bounds fit the current display work area at laptop and high-DPI sizes',async()=>{
  for(const area of [{x:0,y:0,width:1366,height:728},{x:0,y:0,width:1280,height:680},{x:0,y:0,width:1024,height:560},{x:-1280,y:160,width:1280,height:960}]){
    const {windows}=await boot(false,area),w=windows[0];
    assert(w.x>=area.x&&w.y>=area.y);assert(w.x+w.width<=area.x+area.width);assert(w.y+w.height<=area.y+area.height);
    assert(w.minWidth<=w.width&&w.minHeight<=w.height);assert(w.minWidth<=area.width&&w.minHeight<=area.height);
    assert(w.width>=760&&w.height>=500);assert.equal(w.webPreferences.zoomFactor,undefined,'retain legible native UI scaling');
  }
});
