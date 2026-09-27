'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{createHash}=require('node:crypto');
const {Forensics}=require('../desktop/forensics.cjs'),{app,eventually}=require('./dom-helper.cjs'),{until}=require('./preview-helper.cjs');
const {installDiskIPC}=require('../desktop/disk-ipc.cjs'),{pathToFileURL}=require('node:url');
const fixture=path.resolve(__dirname,'fixtures/disk'),expected=JSON.parse(fs.readFileSync(path.join(fixture,'expected.json'),'utf8'));
function native(t){const f=new Forensics(path.resolve(__dirname,'../desktop/engines/tsk/bin'));t.after(()=>f.dispose());return f;}
async function entries(f){const image=await f.task(()=>f.open(path.join(fixture,'split.E01'))),list=await f.task(()=>f.list({imageId:image.id,offset:2048,sectorSize:512}));return list.entries.filter(x=>['HELLO.TXT','中文 线索.png','_EMOVED.TXT','odd|name.txt'].includes(x.name)).slice(0,f.analysisLimits().threads);}
test('planning accepts over 1000 files and over 256 MiB total without queue truncation',async t=>{
  const f=native(t);f.current={id:'image'};const ids=[];
  for(let i=0;i<2105;i++){const id='entry-'+i;ids.push(id);f.entryMap.set(id,{id,imageId:'image',path:'/file-'+i,inode:String(i),offset:0,mode:'r/rrw-r--r--',size:1024*1024});}
  const result=await f.task(()=>f.planAnalysis({imageId:'image',entryIds:ids,capacity:1}));assert.equal(result.entries.length,2105);assert.equal(result.skipped.length,0);assert.equal(result.bytes,2105*1024*1024);
});
test('real E01 readers overlap and preserve every file hash and response identity',async t=>{
  const f=native(t),rows=await entries(f),run=f.run.bind(f);let peak=0;
  f.run=(...args)=>{const task=run(...args);peak=Math.max(peak,f.children.size);return task;};
  const output=await f.task(()=>f.analyzeBatch({entryIds:rows.map(x=>x.id),threads:rows.length}));assert.equal(peak,rows.length);assert.equal(f.children.size,0);assert.equal(f.busy,false);
  assert.equal(output.results.length,rows.length);for(let i=0;i<rows.length;i++){const r=output.results[i];assert(r.ok);assert.equal(r.entryId,rows[i].id);const name=r.name==='odd|name.txt'?'HELLO.TXT':r.name==='中文 线索.png'?'PICTURES/HIDDEN.PNG':r.name;assert.equal(createHash('sha256').update(r.bytes).digest('hex'),expected[name].sha256);}
});
test('batch cancellation kills all native readers and holds the service lock until they exit',async t=>{
  const f=native(t),rows=await entries(f),run=f.run.bind(f);let started=0,killed=0;
  f.run=(...args)=>{const task=run(...args);if(++started===rows.length){assert.equal(f.children.size,rows.length);for(const child of f.children){const kill=child.kill.bind(child);child.kill=()=>{killed++;return kill();};}f.cancel();}return task;};
  const task=f.task(()=>f.analyzeBatch({entryIds:rows.map(x=>x.id),threads:rows.length}));await assert.rejects(()=>f.task(()=>f.status()),/仍在运行/);
  const output=await task;assert(output.cancelled);assert.equal(killed,rows.length);assert(output.results.every(x=>!x.ok));assert.equal(f.children.size,0);assert.equal(f.child,null);assert.equal(f.busy,false);
  assert((await f.task(()=>f.status())).version);
});
test('one invalid file does not discard successful parallel results; invalid batches spawn no readers',async t=>{
  const f=native(t),rows=await entries(f),good=rows[0];f.entryMap.set('invalid',{...good,id:'invalid',inode:'999999999',path:'/invalid'});
  if(f.analysisLimits().threads>=2){const out=await f.task(()=>f.analyzeBatch({entryIds:[good.id,'invalid'],threads:2}));assert.equal(out.results[0].ok,true);assert.equal(out.results[1].ok,false);}
  for(const args of [{entryIds:[good.id],threads:0},{entryIds:[good.id],threads:f.analysisLimits().threads+1},{entryIds:['stale'],threads:1}])await assert.rejects(()=>f.task(()=>f.analyzeBatch(args)));
  f.entryMap.set('large',{...good,id:'large',size:128*1024*1024});
  if(f.analysisLimits().threads>=3)await assert.rejects(()=>f.task(()=>f.analyzeBatch({entryIds:['large','large','large'],threads:3})),/分批/);
  assert.equal(f.children.size,0);
});
test('trusted IPC exposes parallel reads while rejecting foreign frames for the new operation',async t=>{
  const root=path.resolve(__dirname,'../desktop'),mainFrame={url:pathToFileURL(path.join(root,'HexScope.html')).href},handlers={};
  const win={webContents:{mainFrame,isDestroyed:()=>false,send(){}},on(){}},service=installDiskIPC({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers[name]=fn},dialog:{showOpenDialog:async()=>({filePaths:[path.join(fixture,'split.E01')]})}},win,root);t.after(()=>service.dispose());
  const call=(name,args)=>handlers['hexscope:disk']({sender:win.webContents,senderFrame:mainFrame},name,args);
  const image=await call('open');assert(image.ok);const list=await call('list',{imageId:image.data.id,offset:2048,sectorSize:512});assert(list.ok);
  const row=list.data.entries.find(x=>x.name==='HELLO.TXT'),result=await call('analyzeBatch',{entryIds:[row.id],threads:1});assert(result.ok);assert(result.data.results[0].ok);assert.equal(createHash('sha256').update(result.data.results[0].bytes).digest('hex'),expected['HELLO.TXT'].sha256);
  const rejected=await handlers['hexscope:disk']({sender:{},senderFrame:mainFrame},'analyzeBatch',{entryIds:[row.id],threads:1});assert.equal(rejected.ok,false);
});
function bridge(rows,{threads=4,batchBytes=256*1024*1024,onBatch}={}){
  let cancelled=false;const calls=[];return {calls,status:async()=>({version:'fixture',libewf:'fixture',analysisLimits:{threads,batchBytes}}),open:async()=>({id:'image',name:'fixture.E01',containerBytes:100,partitions:[{offset:0,sectorSize:512,description:'fixture'}]}),
    list:async()=>({entries:rows}),planAnalysis:async()=>({entries:rows,skipped:[],note:'test plan',limits:{threads,batchBytes}}),analyzeBatch:async args=>{calls.push(args);if(onBatch)await onBatch(args,calls.length);return {cancelled,results:args.entryIds.map(id=>cancelled?{entryId:id,ok:false,error:'已停止'}:{entryId:id,ok:true,bytes:new Uint8Array([120]),name:id+'.txt',path:'fixture/'+id+'.txt'})};},cancel:async()=>{cancelled=true;},onProgress(){}};
}
function rows(count,size=1){return Array.from({length:count},(_,i)=>({id:'file-'+i,name:'file-'+i+'.txt',path:'/file-'+i+'.txt',size,inode:String(i),directory:false,deleted:false}));}
async function open(ui){ui.$('diskMode').click();await eventually(()=>!ui.$('diskOpen').disabled);ui.$('diskOpen').click();await eventually(()=>!ui.$('diskPushFiltered').disabled);}
test('bulk UI push imports all 1209 files in parallel batches and reports complete accounting',async t=>{
  const api=bridge(rows(1209)),ui=app(t,api),{$,w}=ui;await open(ui);$('diskPushFiltered').click();await until(()=>!$('diskTransferBox').hidden,20000);await until(()=>!w.HexApp.state.running,20000);
  const report=JSON.parse($('diskTransferInfo').textContent);assert.equal(report.added,1209);assert.equal(report.planned,1209);assert.equal(report.skipped.length+report.notProcessed.length,0);assert.equal(w.HexApp.state.items.length,1209);
  assert.equal(api.calls[0].entryIds.length,4);assert.equal(api.calls.flatMap(x=>x.entryIds).length,1209);assert.equal(new Set(w.HexApp.state.items.map(x=>x.path)).size,1209);assert.equal($('statTotal').textContent,'1209');
});
test('large transfer plans are split by active bytes rather than silently skipping later files',async t=>{
  const api=bridge(rows(7,128*1024*1024),{threads:4}),ui=app(t,api);await open(ui);ui.$('diskPushFiltered').click();await until(()=>!ui.$('diskTransferBox').hidden);
  assert.deepEqual(api.calls.map(x=>x.entryIds.length),[2,2,2,1]);assert.equal(JSON.parse(ui.$('diskTransferInfo').textContent).added,7);await until(()=>!ui.w.HexApp.state.running);
});
test('UI cancellation preserves completed batches and explicitly accounts for active and unstarted entries',async t=>{
  let release;const wait=new Promise(resolve=>release=resolve),api=bridge(rows(13),{onBatch:async(_args,n)=>{if(n===2)await wait;}}),ui=app(t,api);await open(ui);ui.$('diskPushFiltered').click();await until(()=>api.calls.length===2);ui.$('diskCancel').click();release();await until(()=>!ui.$('diskTransferBox').hidden);
  const report=JSON.parse(ui.$('diskTransferInfo').textContent);assert.equal(report.added,4);assert.equal(report.skipped.length,4);assert.equal(report.notProcessed.length,5);assert(report.cancelled);assert.equal(api.calls.length,2);assert.equal(ui.w.HexApp.state.items.length,4);await until(()=>!ui.w.HexApp.state.running);
});
