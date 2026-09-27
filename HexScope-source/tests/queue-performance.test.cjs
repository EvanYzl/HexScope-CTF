'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {app,eventually}=require('./dom-helper.cjs'),{createPort,until}=require('./preview-helper.cjs');
const C=require('../src/core.js');
function nativeWorkers(t,stats){
  const workers=new Set();t.after(()=>{for(const worker of workers)worker.terminate();});
  return blobs=>class{
    constructor(url){stats.created++;workers.add(this);this.ready=blobs.get(url).text().then(source=>{
      if(this.dead)return;this.port=createPort(source);this.port.native.on('message',data=>{if(!this.dead){stats.active--;this.onmessage?.({data});}});this.port.native.on('error',e=>this.onerror?.({message:e.message}));
    });}
    postMessage(data){stats.active++;stats.peak=Math.max(stats.peak,stats.active);this.ready.then(()=>{if(!this.dead)this.port.postMessage(data);});}
    terminate(){this.dead=true;this.port?.terminate();workers.delete(this);}
  };
}
test('2507 files are analyzed by four reused real worker threads and all pages, filters and report remain accessible',async t=>{
  const stats={created:0,active:0,peak:0},ui=app(t,null,{cores:4,workerFactory:nativeWorkers(t,stats)}),{$,w,d}=ui;
  const bytes=new Uint8Array([72,101,120,83,99,111,112,101]),files=Array.from({length:2507},(_,i)=>new File([bytes],'batch-'+String(i).padStart(4,'0')+'.txt'));
  assert.equal(w.HexApp.addFiles(files),2507);await until(()=>!w.HexApp.state.running,30000);
  assert.equal(w.HexApp.state.items.length,2507);assert(w.HexApp.state.items.every(item=>item.status==='done'));
  assert.equal(stats.created,4);assert.equal(stats.peak,4);const hash=createHash('sha256').update(bytes).digest('hex');assert(w.HexApp.state.items.every(item=>item.result.sha256===hash));
  assert.equal($('statTotal').textContent,'2507');assert.equal(d.querySelectorAll('.file-row').length,200);assert.equal($('queuePages').textContent,'/ 13');
  $('queuePage').value='13';$('queuePage').dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('.file-row').length,107);assert.match($('fileList').textContent,/batch-2506/);
  $('searchInput').value='batch-2201';$('searchInput').dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('.file-row').length,1);d.querySelector('.file-row').click();assert.equal(w.HexApp.selected().file.name,'batch-2201.txt');
  $('reportBtn').click();const report=JSON.parse(await ui.downloads.at(-1).blob.text());assert.equal(report.files.length,2507);
  $('clearBtn').click();assert.equal(w.HexApp.state.items.length,0);assert.equal($('queuePaging').hidden,true);
});
test('folder traversal imports every entry beyond 1000 while preserving nested paths',async t=>{
  const ui=app(t),{$,w,d}=ui;const leaves=Array.from({length:1205},(_,i)=>({isFile:true,file:done=>done(new File(['x'],'drop-'+i+'.txt'))}));
  const dir={name:'folder',isDirectory:true,createReader(){let offset=0;return {readEntries(done){const batch=leaves.slice(offset,offset+100);offset+=100;done(batch);}};}};
  const event=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[],items:[{webkitGetAsEntry:()=>dir}]}});d.dispatchEvent(event);
  await until(()=>w.HexApp.state.items.length===1205&&!w.HexApp.state.running,15000);assert.equal($('statTotal').textContent,'1205');assert(w.HexApp.state.items.every(item=>item.path.startsWith('folder/')));
});
test('scan backpressure waits without dropping files; cancelling and restarting rejects stale replies',async t=>{
  const pending=[];const ui=app(t,null,{cores:4,workerFactory:()=>class{postMessage(payload){pending.push({worker:this,payload,reply:this.onmessage});}terminate(){this.dead=true;}}}),{w,$}=ui,H=w.HexApp;
  H.performanceSettings.scanMemory=40*1024*1024;
  const files=Array.from({length:4},(_,i)=>{const f=new File(['x'],'large-'+i);Object.defineProperty(f,'size',{value:8*1024*1024});return f;});
  H.addFiles(files);await eventually(()=>pending.length===1);assert.equal(H.state.scanJobs.size,1);assert.equal(H.state.items.filter(x=>x.status==='queued').length,3);
  const old=pending[0];$('clearBtn').click();H.addFiles([new File(['new'],'new.txt')]);await eventually(()=>pending.length===2);
  old.reply({data:{ok:true,result:C.analyze(new Uint8Array([1]),'old')}});assert.equal(H.state.items.length,1);assert.equal(H.state.items[0].result,null);
  pending[1].reply({data:{ok:true,result:C.analyze(new Uint8Array([1]),'new.txt')}});await eventually(()=>!H.state.running);assert.equal(H.state.items[0].file.name,'new.txt');
  $('scanThreads').value='1';$('scanThreads').dispatchEvent(new w.Event('change'));assert.equal(H.performanceSettings.scanThreads,1);$('scanFullSpeed').click();assert.equal(H.performanceSettings.scanThreads,4);
});
test('changing concurrency during a run drains active workers and applies full speed to queued files',async t=>{
  const pending=[];const ui=app(t,null,{cores:4,workerFactory:()=>class{postMessage(payload){pending.push({reply:this.onmessage,payload});}terminate(){}}}),{w,$}=ui,H=w.HexApp;
  const finish=i=>pending[i].reply({data:{ok:true,result:C.analyze(new Uint8Array([120]),pending[i].payload.file.name)}});
  H.addFiles(Array.from({length:9},(_,i)=>new File(['x'],'item-'+i)));await eventually(()=>pending.length===4);
  $('scanThreads').value='1';$('scanThreads').dispatchEvent(new w.Event('change'));
  for(let i=0;i<3;i++)finish(i);await new Promise(r=>setImmediate(r));assert.equal(pending.length,4);assert.equal(H.state.scanJobs.size,1);
  finish(3);await eventually(()=>pending.length===5);assert.equal(H.state.scanJobs.size,1);
  $('scanFullSpeed').click();await eventually(()=>pending.length===8);assert.equal(H.state.scanJobs.size,4);
  H.addFiles([new File(['x'],'appended')]);for(let i=4;i<8;i++)finish(i);await eventually(()=>pending.length===10);
  finish(8);finish(9);await eventually(()=>!H.state.running);assert.equal(H.state.items.length,10);assert(H.state.items.every(x=>x.status==='done'));
});
