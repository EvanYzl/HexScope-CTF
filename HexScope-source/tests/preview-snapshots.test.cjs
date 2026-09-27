'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {PreviewSnapshots}=require('../desktop/preview-snapshots.cjs'),{installDiskIPC}=require('../desktop/disk-ipc.cjs'),{installPreviewIPC}=require('../desktop/preview-read.cjs');
const {page,until}=require('./preview-helper.cjs'),{readBuiltHTML,script}=require('./built-artifact.cjs');
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/preview',name)),sha=value=>createHash('sha256').update(value).digest('hex');
const stopError=()=>{throw new DOMException('The requested file could not be read','NotReadableError');};
function store(t){const value=new PreviewSnapshots();t.after(()=>value.dispose());return value;}
function bridge(t){
 const root=path.resolve(__dirname,'../desktop'),handlers=new Map(),listeners=[];
 const frame={url:pathToFileURL(path.join(root,'HexScope.html')).href},win={webContents:{mainFrame:frame,isDestroyed:()=>false,send(){}},on(name,fn){if(name==='closed')listeners.push(fn);}};
 const ipcMain={removeHandler:name=>handlers.delete(name),handle:(name,fn)=>handlers.set(name,fn)},event={sender:win.webContents,senderFrame:frame};
 const backend=installDiskIPC({ipcMain,dialog:{showOpenDialog:async()=>({filePaths:[path.join(__dirname,'fixtures/disk/split.E01')]})}},win,root);
 installPreviewIPC({ipcMain},win,root,backend.previewSnapshots);
 const exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(root,'preload.cjs'),'utf8'),{require:name=>{
  assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>exposed[key]=value},webUtils:{getPathForFile(){throw Error('E01 previews must not ask the OS path of a generated File');}},
   ipcRenderer:{async invoke(channel,operation,args){calls.push({channel,operation,args});const result=await handlers.get(channel)(event,operation,args);return structuredClone(result);},on(){},removeListener(){}}};
 }});
 t.after(()=>{for(const fn of listeners)fn();});
 return {backend,calls,api:exposed.hexscopeDisk,files:exposed.hexscopeFiles};
}
function setup(t,api,files){const p=page(api,files);t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});return p;}

test('snapshots own exact bytes, use opaque tokens and survive the original buffer being reused',async t=>{
 const s=store(t),bytes=new Uint8Array([1,2,3,4]),reference=bytes.slice(),record=await s.save({bytes,name:'../../outside.bin'});bytes.fill(0);
 assert.deepEqual(Buffer.from(await s.read({snapshotId:record.id,offset:0,length:4})),Buffer.from(reference));assert.equal(record.sha256,sha(reference));assert.equal(record.size,4);assert(!('path' in record));
 await assert.rejects(s.read({snapshotId:'../outside',offset:0,length:1}),/重新推送/);
 await assert.rejects(s.read({snapshotId:record.id,offset:0,length:5}),/无效/);
 const directory=s.directory;s.release([record.id]);assert(!fs.existsSync(directory));await assert.rejects(s.read({snapshotId:record.id,offset:0,length:4}),/释放/);
});
test('snapshot release cannot remove unregistered files and changed cache bytes are rejected',async t=>{
 const s=store(t),record=await s.save({bytes:new Uint8Array([5,6])}),filename=s.filename(record.id),outside=path.join(s.parent,'snapshot-outside-'+record.id);
 fs.writeFileSync(outside,'keep');t.after(()=>fs.unlinkSync(outside));s.release([outside,'../'+record.id]);assert.equal(fs.readFileSync(outside,'utf8'),'keep');
 await fsp.writeFile(filename,new Uint8Array([7,8]));await assert.rejects(s.read({snapshotId:record.id,offset:0,length:2}),/变化|校验/);
});
test('empty files and more than 1000 snapshot handles are retained until released',async t=>{
 const s=store(t);const records=await Promise.all(Array.from({length:1003},(_,i)=>s.save({bytes:new Uint8Array(i%2),name:'same.txt'})));
 assert.equal(s.records.size,1003);assert.equal(new Set(records.map(x=>x.id)).size,1003);assert.equal((await s.read({snapshotId:records[0].id,offset:0,length:0})).length,0);
 const directory=s.directory;s.dispose();assert.equal(s.records.size,0);assert(!fs.existsSync(directory));await assert.rejects(s.save({bytes:new Uint8Array()}),/关闭/);
});
test('real E01 push uses snapshots even when generated File reads fail, including after closing the image',async t=>{
 const b=bridge(t),p=setup(t,b.api,b.files);p.$('diskMode').click();await until(()=>!p.$('diskOpen').disabled);p.$('diskOpen').click();await until(()=>p.$('diskRows').textContent.includes('HELLO.TXT')&&!p.$('diskOpen').disabled);
 const row=[...p.$('diskRows').querySelectorAll('tr')].find(x=>x.textContent.includes('HELLO.TXT'));row.querySelector('input').click();p.$('diskAnalyze').click();await until(()=>p.w.HexApp.state.items.length===1&&!p.$('diskOpen').disabled);
 const item=p.w.HexApp.state.items[0],original=await item.file.arrayBuffer();assert(item.file._hexSnapshot);assert.equal(item.file._hexSnapshot.sha256,sha(Buffer.from(original)));
 Object.defineProperties(item.file,{slice:{value:()=>({arrayBuffer:stopError})},arrayBuffer:{value:stopError}});
 p.w.HexApp.showTab('preview');await until(()=>p.$('previewStatus').textContent.includes('文本已载入'));assert.equal(p.$('previewStage').textContent,Buffer.from(original).toString());assert.match(p.$('previewSource').textContent,/镜像提取快照/);
 await b.api.close();assert.equal(b.backend.current,null);p.$('previewReload').click();await until(()=>p.$('previewStatus').textContent.includes('文本已载入'));assert.equal(p.$('previewStage').textContent,Buffer.from(original).toString());
 assert(b.calls.some(x=>x.operation==='snapshot'));assert(!b.calls.some(x=>x.operation==='read'));
 const directory=b.backend.previewSnapshots.directory;p.$('clearBtn').click();await until(()=>b.backend.previewSnapshots.records.size===0);assert(!fs.existsSync(directory));assert.equal(p.w.HexPreview.state.id,null);
});
test('image extraction snapshot drives the image Blob with the original E01 bytes',async t=>{
 const b=bridge(t),p=setup(t,b.api,b.files),image=await b.api.open(),list=await b.api.list({imageId:image.id,offset:2048,sectorSize:512});
 const entry=list.entries.find(x=>x.name==='中文 线索.png'),result=(await b.api.analyzeBatch({entryIds:[entry.id],threads:1})).results[0];assert(result.ok);
 const file=new File([result.bytes],result.name);Object.defineProperties(file,{_hexSnapshot:{value:result.snapshot},slice:{value:()=>({arrayBuffer:stopError})}});
 await p.w.HexPreview.load({id:'E01 image',file});const img=p.$('previewStage').querySelector('img');assert(img);
 assert.equal(sha(Buffer.from(await p.blobs.get(img.src).arrayBuffer())),sha(result.bytes));Object.defineProperties(img,{naturalWidth:{value:2},naturalHeight:{value:2}});img.onload();assert.doesNotMatch(p.$('previewStatus').textContent,/无法预览/);
});
for(const [name,pattern]of [['sample.docx',/DOCX 正文/],['sample.xlsx',/工作表/],['sample.pdf',/PDF 第 1 \/ 2 页/]])
 test('snapshot preview opens '+name+' without using its generated File reference',async t=>{
  const b=bridge(t),p=setup(t,undefined,b.files),bytes=fixture(name),snapshot=await b.backend.previewSnapshots.save({bytes,name});
  const file=new File([],name);Object.defineProperties(file,{_hexSnapshot:{value:snapshot},slice:{value:()=>({arrayBuffer:stopError})},arrayBuffer:{value:stopError}});
  await p.w.HexPreview.load({id:name,file});assert.match(p.$('previewStatus').textContent,pattern);assert(b.calls.some(x=>x.operation==='snapshot'));
 });
test('released or unavailable snapshots produce a specific error instead of rereading a broken File',async t=>{
 const b=bridge(t),p=setup(t,undefined,b.files),snapshot=await b.backend.previewSnapshots.save({bytes:new Uint8Array([65]),name:'a.txt'});
 b.backend.previewSnapshots.release([snapshot.id]);const file=new File(['a'],'a.txt');Object.defineProperties(file,{_hexSnapshot:{value:snapshot},slice:{value:()=>{throw Error('must not read stale File');}}});
 await p.w.HexPreview.load({id:1,file});assert.match(p.$('previewStatus').textContent,/副本已释放/);assert.doesNotMatch(p.$('previewStatus').textContent,/原文件引用|must not/);
});
test('snapshot IPC remains independent of an active image task and validates caller/IDs',async t=>{
 const b=bridge(t),snapshot=await b.backend.previewSnapshots.save({bytes:new Uint8Array([7,8,9])});let finish;
 const busy=b.backend.task(()=>new Promise(resolve=>finish=resolve));const data=await b.files.readSnapshot({snapshotId:snapshot.id,offset:0,length:3,requestId:45});assert.deepEqual(data,new Uint8Array([7,8,9]));assert(b.backend.busy);finish();await busy;
 await assert.rejects(b.files.readSnapshot({snapshotId:'../../private',offset:0,length:3,requestId:46}),/副本/);
 const out=await b.files.releaseSnapshots([snapshot.id]);assert(out.ok);assert.equal(b.backend.previewSnapshots.records.size,0);
});
