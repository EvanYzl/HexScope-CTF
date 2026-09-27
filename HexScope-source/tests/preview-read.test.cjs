'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {readPreview,installPreviewIPC,MAX_READ}=require('../desktop/preview-read.cjs');
const {page,until}=require('./preview-helper.cjs');
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/preview',name));
async function local(t,bytes=Buffer.from('flag{native_preview} 中文')){
 const directory=await fsp.mkdtemp(path.join(process.env.HEXSCOPE_TEST_TMP||os.tmpdir(),'preview-read-'));
 t.after(()=>fsp.rm(directory,{recursive:true,force:true}));const filename=path.join(directory,'带 空格的文件.txt');await fsp.writeFile(filename,bytes);
 const stat=await fsp.stat(filename,{bigint:true});return {directory,bytes,args:{path:filename,size:bytes.length,lastModified:Number(stat.mtimeNs/1000000n),offset:0,length:bytes.length}};
}
function setup(t,api){const p=page(undefined,api);t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});return p;}
function inaccessible(name,size,lastModified=0){return {name,size,lastModified,slice(){return {async arrayBuffer(){throw new DOMException('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.','NotReadableError');}};}};}

test('native preview reads real Unicode paths and byte ranges without modifying the source',async t=>{
 const {bytes,args}=await local(t),before=await fsp.stat(args.path,{bigint:true});
 assert.deepEqual(await readPreview(args),bytes);assert.deepEqual(await readPreview({...args,offset:5,length:7}),bytes.subarray(5,12));
 assert.equal((await readPreview({...args,offset:args.size,length:0})).length,0);
 assert.deepEqual(await fsp.readFile(args.path),bytes);assert.equal((await fsp.stat(args.path,{bigint:true})).mtimeNs,before.mtimeNs);
 const empty=await local(t,Buffer.alloc(0));assert.equal((await readPreview(empty.args)).length,0);
});
test('native preview validates ranges before opening a file',async t=>{
 const {args}=await local(t);for(const changes of [{path:'relative.txt'},{path:'C:\\bad\0.txt'},{length:MAX_READ+1},{length:args.size+1},{offset:-1},{length:1.5},{size:NaN},{lastModified:undefined}])
  await assert.rejects(readPreview({...args,...changes},{io:{open(){throw Error('validation must precede IO');}}}),e=>e.code==='INVALID');
});
test('changed, missing and denied sources return actionable errors and never stale bytes',async t=>{
 const {args}=await local(t);await assert.rejects(readPreview({...args,size:args.size+1}),e=>e.code==='CHANGED');
 await assert.rejects(readPreview({...args,lastModified:args.lastModified-5000}),e=>e.code==='CHANGED');
 await assert.rejects(readPreview(args,{io:{async open(){throw Object.assign(Error('private path'),{code:'EACCES'});}}}),e=>e.code==='DENIED'&&!e.message.includes('private'));
 await fsp.unlink(args.path);await assert.rejects(readPreview(args),e=>e.code==='MISSING'&&/移动|磁盘/.test(e.message));
});
test('mutation during reading and cancellation discard bytes and close the OS handle',async t=>{
 for(const cancel of [false,true]){
  const {args}=await local(t,Buffer.alloc(2*1024*1024+5,87)),controller=new AbortController();let closed=false,reads=0;
  const io={stat:fsp.stat,async open(...a){const handle=await fsp.open(...a);return {stat:o=>handle.stat(o),async read(...r){const result=await handle.read(...r);reads++;if(cancel)controller.abort();else await fsp.utimes(args.path,new Date(),new Date(args.lastModified+5000));return result;},async close(){await handle.close();closed=true;}};}};
  await assert.rejects(readPreview(args,{io,signal:controller.signal}),e=>e.code===(cancel?'CANCELLED':'CHANGED'));
  assert.equal(closed,true);if(cancel)assert.equal(reads,1);
 }
});
test('preview IPC accepts only the application main frame and can cancel active reads',async t=>{
 const {directory,args}=await local(t,Buffer.alloc(3*1024*1024)),handlers=new Map();let close;
 const mainFrame={url:pathToFileURL(path.join(directory,'HexScope.html')).href},win={webContents:{mainFrame},on(name,fn){if(name==='closed')close=fn;}};
 installPreviewIPC({ipcMain:{removeHandler:k=>handlers.delete(k),handle:(k,fn)=>handlers.set(k,fn)}},win,directory);
 const run=handlers.get('hexscope:preview-read'),event={sender:win.webContents,senderFrame:mainFrame};
 for(const wrong of [{sender:{},senderFrame:mainFrame},{sender:win.webContents,senderFrame:{url:mainFrame.url}}])assert.equal((await run(wrong,'read',{...args,requestId:1})).code,'INVALID');
 const original=mainFrame.url;mainFrame.url='https://untrusted.invalid/';assert.equal((await run(event,'read',{...args,requestId:1})).code,'INVALID');mainFrame.url=original;
 assert.equal((await run(event,'write',{...args,requestId:1})).code,'INVALID');assert.equal((await run(event,'read',null)).code,'INVALID');
 const pending=run(event,'read',{...args,requestId:2});await run(event,'cancel',{requestId:2});assert.equal((await pending).code,'CANCELLED');
 const result=await run(event,'read',{...args,requestId:3});assert.equal(result.ok,true);assert.deepEqual(result.data,await fsp.readFile(args.path));
 const ending=run(event,'read',{...args,requestId:4});close();assert.equal((await ending).code,'CANCELLED');assert.equal(handlers.size,0);
});
test('preload derives native paths from actual File objects and keeps generated files off IPC',async()=>{
 const api={},calls=[],real=new File(['abc'],'chosen.txt',{lastModified:123}),generated=new File(['a'],'memory.txt');
 const electron={contextBridge:{exposeInMainWorld:(name,value)=>api[name]=value},webUtils:{getPathForFile(file){if(!(file instanceof File))throw Error('not a File');return file===real?'C:\\chosen.txt':'';}},ipcRenderer:{async invoke(...a){calls.push(a);return {ok:true,data:new Uint8Array([97,98,99])};}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}});
 assert.equal(await api.hexscopeFiles.readPreview(generated,{offset:0,length:1,requestId:1}),null);assert.equal(calls.length,0);
 const result=await api.hexscopeFiles.readPreview(real,{offset:0,length:3,requestId:2,path:'C:\\unselected.txt'});assert.deepEqual(result,new Uint8Array([97,98,99]));
 assert.equal(calls[0][0],'hexscope:preview-read');assert.equal(calls[0][2].path,'C:\\chosen.txt');assert.equal(calls[0][2].lastModified,123);assert.equal(calls[0][2].size,3);
 await assert.rejects(api.hexscopeFiles.readPreview({path:'C:\\arbitrary.txt'},{offset:0,length:3,requestId:3}),/not a File/);assert.equal(calls.length,1);
 await api.hexscopeFiles.cancelPreview(2);assert.equal(calls[1][1],'cancel');assert.equal(typeof api.hexscopeDisk.analyzeBatch,'function');
});

for(const [name,expected]of [['sample.docx',/flag\{/],['sample.xlsx',/工作表/],['sample.pdf',/PDF 第 1 \/ 2 页/],['native.txt',/flag\{native_preview\}/]])
 test('actual built preview opens '+name+' through native IO with an unreadable browser File',async t=>{
  const bytes=name==='native.txt'?Buffer.from('flag{native_preview} 中文'):fixture(name),{args}=await local(t,bytes);let reads=0;
  const p=setup(t,{async readPreview(_file,range){reads++;return readPreview({...args,...range});},async cancelPreview(){}});
  const file=inaccessible(name,bytes.length,args.lastModified);await p.w.HexPreview.load({id:name,file});
  assert.doesNotMatch(p.$('previewStatus').textContent,/无法预览/);assert.match(p.$('previewStatus').textContent+' '+p.$('previewStage').textContent,expected);assert.equal(reads,1,'small files use a single stable snapshot');
  if(name==='native.txt'){const picker=p.$('previewTools').querySelector('select');picker.value='utf-8';picker.dispatchEvent(new p.w.Event('change'));await until(()=>p.$('previewStage').textContent.includes('中文'));assert.equal(reads,1);}
 });
test('native image bytes back the decoder Blob independently of the original File',async t=>{
 const bytes=Buffer.concat([fixture('pixel.png'),Buffer.alloc(100000,17)]),{args}=await local(t,bytes),ranges=[];
 const p=setup(t,{readPreview:(_file,range)=>{ranges.push(range.length);return readPreview({...args,...range});},async cancelPreview(){}});
 await p.w.HexPreview.load({id:'image',file:inaccessible('image.png',bytes.length,args.lastModified)});
 const img=p.$('previewStage').querySelector('img');assert(img);const blob=p.blobs.get(img.src);assert.equal(blob.type,'image/png');
 assert.deepEqual(ranges,[65536,bytes.length]);
 await fsp.unlink(args.path);assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 Object.defineProperties(img,{naturalWidth:{value:2},naturalHeight:{value:2}});img.onload();assert.match(p.$('previewStatus').textContent,/2 × 2/);
 const src=img.src;p.w.HexPreview.cleanup();assert(!p.blobs.has(src));
});
test('in-memory files retain browser reads and unreadable references explain how to recover',async t=>{
 let calls=0;const p=setup(t,{async readPreview(){calls++;return null;},async cancelPreview(){}});
 await p.w.HexPreview.load({id:'memory',file:new File(['flag{memory_file}'],'from-image.txt')});assert.equal(p.$('previewStage').textContent,'flag{memory_file}');assert.equal(calls,1);
 await p.w.HexPreview.load({id:'unreadable',file:inaccessible('broken.txt',42)});assert.match(p.$('previewStatus').textContent,/重新选择|重新.*拖入/);assert.doesNotMatch(p.$('previewStatus').textContent,/requested file|permission problems/);assert.equal(p.$('previewStop').disabled,true);
});
test('switching or stopping cancels pending native reads and ignores their late results',async t=>{
 const cancelled=[],pending=[];const p=setup(t,{readPreview(file,range){if(file.name==='current.txt')return Promise.resolve(null);return new Promise(resolve=>pending.push({id:range.requestId,resolve}));},async cancelPreview(id){cancelled.push(id);}});
 const old=p.w.HexPreview.load({id:'old',file:inaccessible('old.txt',3)});await until(()=>pending.length===1);
 await p.open(Buffer.from('current bytes'),'current.txt');assert(cancelled.includes(pending[0].id));pending[0].resolve(new Uint8Array([111,108,100]));await old;assert.equal(p.$('previewStage').textContent,'current bytes');
 const stop=p.w.HexPreview.load({id:'stop',file:inaccessible('stop.txt',3)});await until(()=>pending.length===2);p.$('previewStop').click();assert(cancelled.includes(pending[1].id));pending[1].resolve(new Uint8Array([111,108,100]));await stop;assert.match(p.$('previewStatus').textContent,/已停止/);assert.equal(p.$('previewStage').childElementCount,0);
});
test('native read failures never fall through to stale browser bytes',async t=>{
 const p=setup(t,{async readPreview(){throw Error('文件在导入后发生了变化，请重新选择或拖入该文件后预览。');},async cancelPreview(){}});
 await p.open(Buffer.from('stale bytes'),'changed.txt');assert.match(p.$('previewStatus').textContent,/发生了变化/);assert.equal(p.$('previewStage').childElementCount,0);
});
