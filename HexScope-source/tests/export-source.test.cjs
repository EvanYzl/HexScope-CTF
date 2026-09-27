'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{bridge}=require('./disk-bridge.cjs'),{page,until}=require('./preview-helper.cjs');
const C=require('../src/core.js'),fixture=name=>new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures',name))),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function breakFile(file){Object.defineProperties(file,{slice:{value(){throw new DOMException('The requested file could not be read','NotReadableError');}},arrayBuffer:{value(){throw new DOMException('The requested file could not be read','NotReadableError');}}});return file;}
function setup(t,b,files=b.files){
  const p=page(b.api,files),downloads=[];p.w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:p.blobs.get(this.href)});};
  t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});return {...p,downloads};
}
async function add(p,b,bytes,name){
  const snapshot=await b.backend.previewSnapshots.save({bytes,name}),file=breakFile(new File([bytes],name));Object.defineProperty(file,'_hexSnapshot',{value:snapshot});
  p.w.HexApp.addFiles([file]);await until(()=>!p.w.HexApp.state.running);const item=p.w.HexApp.state.items.at(-1);assert.equal(item.status,'done',item.error);return item;
}
async function zipDownload(p,index=0){await until(()=>p.downloads.length>index);const bytes=new Uint8Array(await p.downloads[index].blob.arrayBuffer()),zip=C.parseZip(bytes,0);assert(zip.verified);const entries=new Map();for(const entry of zip.entries)entries.set(entry.name,await C.inflateEntry(bytes.subarray(entry.dataStart,entry.dataEnd),entry));return entries;}
async function expectDownload(p,action,expected){const index=p.downloads.length;action();await until(()=>p.downloads.length>index);assert.equal(sha(new Uint8Array(await p.downloads[index].blob.arrayBuffer())),sha(expected));return p.downloads[index];}

test('real E01 push, pooled scan and batch export survive unreadable Files and closing the image',async t=>{
  const b=bridge(t),p=setup(t,b),H=p.w.HexApp,addFiles=H.addFiles;
  H.addFiles=files=>addFiles(files.map(breakFile));
  p.$('diskMode').click();await until(()=>!p.$('diskOpen').disabled);p.$('diskOpen').click();await until(()=>p.$('diskRows').textContent.includes('中文 线索.png')&&!p.$('diskOpen').disabled);
  [...p.$('diskRows').querySelectorAll('tr')].find(row=>row.textContent.includes('中文 线索.png')).querySelector('input').click();p.$('diskAnalyze').click();
  await until(()=>H.state.items.length===1&&!H.state.running&&!p.$('diskOpen').disabled);
  const item=H.state.items[0];assert.equal(item.status,'done',item.error);const snapshot=item.file._hexSnapshot,source=await b.files.readSnapshot({snapshotId:snapshot.id,offset:0,length:snapshot.size,requestId:70000});
  assert.equal(item.result.sha256,sha(source));assert(item.chosen.size>0);await b.api.close();assert.equal(b.backend.current,null);
  p.$('exportBtn').click();const entries=await zipDownload(p),manifest=JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));assert.equal(manifest.items.length,item.chosen.size);
  for(const row of manifest.items){const finding=item.result.findings.find(f=>f.start===row.start);assert.equal(sha(entries.get(row.output)),sha(C.carve(source,finding)));assert.equal(row.sourceSHA256,sha(source));}
  assert.match(p.$('toast').textContent,/已发起下载/);assert(!p.$('exportBtn').disabled);assert(!b.calls.some(x=>x.operation==='read'));
});

test('batch export preserves four sources, duplicate names, rebased ZIP bytes and source hashes',async t=>{
  const b=bridge(t),p=setup(t,b),bytes=[C.cat([fixture('normal.png'),fixture('deflated.zip')]),fixture('absolute.png')];
  for(let i=0;i<4;i++)await add(p,b,bytes[i%2],'duplicate.png');
  p.$('exportBtn').click();const entries=await zipDownload(p),manifest=JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));assert.equal(manifest.items.length,4);assert.equal(entries.size,5);
  manifest.items.forEach((row,i)=>{const item=p.w.HexApp.state.items[i],finding=item.result.findings.find(f=>f.start===row.start),data=entries.get(row.output);assert.equal(sha(data),sha(C.carve(bytes[i%2],finding)));assert.equal(row.sourceSHA256,sha(bytes[i%2]));assert(C.parseZip(data,0).verified);});
});

test('single candidate, raw tail, manual ranges, hex and ZIP members all read extraction snapshots',async t=>{
  const b=bridge(t),p=setup(t,b),png=fixture('normal.png'),zip=fixture('deflated.zip'),tail=new TextEncoder().encode('extra-tail'),source=C.cat([png,zip,tail]);await add(p,b,source,'source.png');
  p.w.HexApp.showTab('extract');await expectDownload(p,()=>p.w.document.querySelector('[data-carve]').click(),zip);
  await expectDownload(p,()=>p.$('rawTailBtn').click(),C.cat([zip,tail]));
  p.w.HexApp.showTab('hex');p.$('rangeStart').value='3';p.$('rangeEnd').value='37';await expectDownload(p,()=>p.$('rangeBtn').click(),source.slice(3,37));
  p.$('tailBtn').click();await until(()=>p.$('hexRange').textContent.includes(C.hex(source.length)));assert.doesNotMatch(p.$('hexView').textContent,/读取失败/);assert.match(p.$('hexView').textContent,/extra-tail/);
  p.w.HexApp.showTab('extract');const at=p.downloads.length;p.w.document.querySelector('[data-unzip]').click();const entries=await zipDownload(p,at);assert.equal(new TextDecoder().decode(entries.get('hello.txt')),'Hello, hidden world!\n'.repeat(100));assert(entries.has('_extraction_manifest.json'));
});

test('individual absolute-offset ZIP export uses the snapshot and produces a valid rebased archive',async t=>{
  const b=bridge(t),p=setup(t,b),source=fixture('absolute.png'),item=await add(p,b,source,'absolute.png'),finding=item.result.findings[0];assert(finding.absoluteOffsets);
  p.w.HexApp.showTab('extract');await expectDownload(p,()=>p.w.document.querySelector('[data-carve]').click(),C.carve(source,finding));
});

test('correct-extension copy and metadata blocks retain snapshot bytes; EXIF, strings and stego share worker IO',async t=>{
  const b=bridge(t),p=setup(t,b),source=fixture('gps.jpg'),item=await add(p,b,source,'wrong.png');
  const copy=await expectDownload(p,()=>p.$('correctBtn').click(),source);assert.equal(copy.name,'wrong.jpg');
  p.w.HexApp.showTab('exif');await until(()=>p.$('gpsSummary').textContent.includes('37.5000000'));const at=p.downloads.length;p.$('metadataBlocks').click();const entries=await zipDownload(p,at);
  for(const region of item.result.regions.filter(r=>r.kind==='metadata'))assert.equal(sha(entries.get(C.safeName(region.label+'_'+region.start.toString(16)+'.bin'))),sha(source.subarray(region.start,region.end)));
  p.w.HexApp.showTab('strings');p.$('stringScan').click();await until(()=>!p.$('stringScan').disabled);assert.doesNotMatch(p.$('stringStatus').textContent,/失败/);
  const png=fixture('normal.png'),second=await add(p,b,png,'pixels.png');p.w.HexApp.state.selected=second.id;p.w.HexApp.renderDetail();p.w.HexApp.showTab('lab');p.$('pngAudit').click();await until(()=>p.$('pngResults').textContent.includes('IHDR'));assert.doesNotMatch(p.$('labStatus').textContent,/失败/);
});

test('desktop local-file export uses the validated native reader when browser File reads fail',async t=>{
  const directory=fs.mkdtempSync(path.join(process.env.HEXSCOPE_TEST_TMP||os.tmpdir(),'export-native-'));t.after(()=>{for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);});
  const bytes=C.cat([fixture('normal.png'),fixture('deflated.zip')]),filename=path.join(directory,'case.png');fs.writeFileSync(filename,bytes);const modified=Number(fs.statSync(filename,{bigint:true}).mtimeNs/1000000n),file=breakFile(new File([bytes],'case.png',{lastModified:modified})),paths=new WeakMap([[file,filename]]);
  const b=bridge(t,paths),p=setup(t,b);p.w.HexApp.addFiles([file]);await until(()=>!p.w.HexApp.state.running);assert.equal(p.w.HexApp.state.items[0].status,'done');
  p.$('exportBtn').click();const entries=await zipDownload(p),manifest=JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));assert.equal(sha(entries.get(manifest.items[0].output)),sha(fixture('deflated.zip')));assert(b.calls.some(x=>x.operation==='read'));
});

test('missing snapshots fail the entire export with the filename and never download an incomplete ZIP',async t=>{
  const b=bridge(t),p=setup(t,b),bytes=C.cat([fixture('normal.png'),fixture('deflated.zip')]);await add(p,b,bytes,'good.png');const missing=await add(p,b,bytes,'missing.png');b.backend.previewSnapshots.release([missing.file._hexSnapshot.id]);
  p.$('exportBtn').click();await until(()=>p.$('toast').textContent.includes('导出失败'));assert.match(p.$('toast').textContent,/missing\.png.*重新推送/);assert.equal(p.downloads.length,0);assert(!p.$('exportBtn').disabled);assert(!p.$('clearBtn').disabled);
});

test('parallel scans, preview and export share unique native requests without busy failures',async t=>{
  const b=bridge(t);let active=0,peak=0;const ids=new Set(),fileApi={...b.files,async readSnapshot(args){assert(!ids.has(args.requestId));ids.add(args.requestId);active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,40));return await b.files.readSnapshot(args);}finally{active--;}}};
  const p=setup(t,b,fileApi),source=C.cat([fixture('normal.png'),fixture('deflated.zip')]);p.w.HexApp.performanceSettings.scanThreads=4;
  const files=[];for(let i=0;i<16;i++){const snapshot=await b.backend.previewSnapshots.save({bytes:source}),file=breakFile(new File([source],'item-'+i+'.png'));Object.defineProperty(file,'_hexSnapshot',{value:snapshot});files.push(file);}
  p.w.HexApp.addFiles(files);await until(()=>!p.$('exportBtn').disabled);assert(p.w.HexApp.state.running);p.w.HexApp.showTab('preview');p.$('exportBtn').click();await zipDownload(p);await until(()=>!p.w.HexApp.state.running);assert(p.w.HexApp.state.items.every(item=>item.status==='done'));assert.equal(peak,2);assert.doesNotMatch(p.$('previewStatus').textContent,/无法预览/);assert(ids.size>=18);
});

test('cancelling a worker read cancels its request and cannot complete a stale export',async t=>{
  const b=bridge(t);let pending;const p=setup(t,b,{...b.files,readSnapshot(args){if(pending)return b.files.readSnapshot(args);return new Promise(resolve=>pending={args,resolve});}});
  const bytes=new TextEncoder().encode('flag{cancel}'),snapshot=await b.backend.previewSnapshots.save({bytes}),file=breakFile(new File([bytes],'cancel.txt'));Object.defineProperty(file,'_hexSnapshot',{value:snapshot});
  const task=p.w.HexApp.job({kind:'strings',file,options:{min:4,encoding:'ascii',needle:''}}),rejected=assert.rejects(task.promise,/停止/);await until(()=>pending);task.cancel();await rejected;await until(()=>b.calls.some(x=>x.operation==='cancel'&&x.args.requestId===pending.args.requestId));pending.resolve(bytes);
  const result=await p.w.HexApp.job({kind:'analyze',file}).promise;assert.equal(result.result.sha256,sha(bytes));assert.equal(p.downloads.length,0);
});

test('queued reads can be cancelled without reaching IPC, and truncated reads are rejected',async t=>{
  const b=bridge(t),pending=[],p=setup(t,b,{async readPreview(_file,range){return new Promise(resolve=>pending.push({range,resolve}));},async cancelPreview(){}}),file=new File(['abc'],'memory.txt'),controller=new AbortController();
  const first=p.w.HexFileIO.read(file),second=p.w.HexFileIO.read(file);await until(()=>pending.length===2);const waiting=p.w.HexFileIO.read(file,0,3,{signal:controller.signal}),rejected=assert.rejects(waiting,/停止/);controller.abort();await rejected;assert.equal(pending.length,2);
  pending[0].resolve(new Uint8Array([97,98,99]));pending[1].resolve(new Uint8Array([97,98,99]));await Promise.all([first,second]);
  const short=p.w.HexFileIO.read(file),shortError=assert.rejects(short,/不完整/);await until(()=>pending.length===3);pending[2].resolve(new Uint8Array([97]));await shortError;
});
