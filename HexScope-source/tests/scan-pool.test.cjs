'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ScanPool=require('../src/scan-pool.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function pool(){const workers=[];return {workers,pool:new ScanPool(()=>{const w={sent:[],postMessage(data){this.sent.push(data);},terminate(){this.dead=true;}};workers.push(w);return w;})};}
test('analysis pool reuses workers and isolates out-of-order results',async()=>{
  const p=pool(),a=p.pool.run({n:1}),b=p.pool.run({n:2});await tick();assert.equal(p.workers.length,2);
  p.workers[1].onmessage({data:{ok:true,result:'second'}});assert.equal((await b.promise).result,'second');
  const c=p.pool.run({n:3});await tick();assert.equal(p.workers.length,2);assert.equal(p.workers[1].sent.length,2);
  p.workers[0].onmessage({data:{ok:true,result:'first'}});p.workers[1].onmessage({data:{ok:true,result:'third'}});
  assert.deepEqual((await Promise.all([a.promise,c.promise])).map(x=>x.result),['first','third']);p.pool.close();assert(p.workers.every(w=>w.dead));
});
test('cancel and timeout retire workers, ignore late replies and allow a fresh worker',async()=>{
  const p=pool(),a=p.pool.run({});const cancelled=assert.rejects(a.promise,/停止/);await tick();const late=p.workers[0].onmessage;a.cancel();late({data:{ok:true,result:'stale'}});await cancelled;assert(p.workers[0].dead);
  const b=p.pool.run({},10);await assert.rejects(b.promise,/超时/);assert(p.workers[1].dead);
  const c=p.pool.run({});await tick();assert.equal(p.workers.length,3);p.workers[2].onmessage({data:{ok:true,result:'new'}});assert.equal((await c.promise).result,'new');p.pool.close();
});
test('pool shutdown settles every active task and constructor failures never leak',async()=>{
  const p=pool(),jobs=Array.from({length:6},()=>p.pool.run({})),settled=Promise.allSettled(jobs.map(x=>x.promise));await tick();p.pool.close();assert((await settled).every(x=>x.status==='rejected'));assert(p.workers.every(w=>w.dead));
  const broken=new ScanPool(()=>{throw Error('worker unavailable');});await assert.rejects(broken.run({}).promise,/unavailable/);assert.equal(broken.active.size,0);broken.close();
});
