'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createHash}=require('node:crypto');
const {page,until,execute,choose}=require('./ui-helper.cjs');
const {readBuiltHTML,script}=require('../../tests/built-artifact.cjs');
const {Forensics}=require('../../desktop/forensics.cjs');
const source=path.resolve(__dirname,'../..'),fixture=path.join(source,'tests/fixtures/disk');
function visible(p,id){
 assert.deepEqual(Array.from(p.w.document.querySelectorAll('main [id$="Workspace"]')).filter(x=>!x.hidden).map(x=>x.id),[id+'Workspace']);
 assert.deepEqual(Array.from(p.w.document.querySelectorAll('.mode-nav button.mode.active')).map(x=>x.id),[id==='inspection'?'inspectMode':id+'Mode']);
}
function native(t){
 const f=new Forensics(path.join(source,'desktop/engines/tsk/bin')),listeners=[];
 const progress=value=>listeners.forEach(fn=>fn(value));t.after(()=>f.dispose());
 const api={status:()=>f.task(()=>f.status()),open:()=>f.task(()=>f.open(path.join(fixture,'recorded/good.E01'))),
  openDropped:()=>f.task(()=>f.open(path.join(fixture,'recorded/good.E01'))),list:a=>f.task(()=>f.list(a)),
  details:a=>f.task(()=>f.details(a)),analyze:a=>f.task(()=>f.analyze(a)),analyzeBatch:a=>f.task(()=>f.analyzeBatch(a)),planAnalysis:a=>f.task(()=>f.planAnalysis(a)),
  hashCapabilities:async()=>f.hashCapabilities(),hashImage:a=>f.task(()=>f.hashImage(a,progress)),hashEntry:a=>f.task(()=>f.hashEntry(a,progress)),
  cancel:async()=>f.cancel(),close:async()=>{f.current=null;f.entryMap.clear();},onProgress:fn=>listeners.push(fn)};
 return {api,f};
}
async function open(p){p.$('diskMode').click();await until(()=>!p.$('diskOpen').disabled);p.$('diskOpen').click();await until(()=>p.$('diskRows').textContent.includes('HELLO.TXT')&&!p.$('diskOpen').disabled);}

test('integrated artifact retains 4.1 workspaces, native controls and the complete 78-tool catalog',()=>{
 const p=page();try{
  assert.match(p.w.document.title,/4\.1/);
  for(const id of ['diskWorkspace','hashWorkspace','mountConvert','mountAttach','mountLetter','diskHashImage','diskHashEntry','diskPushFiltered'])assert(p.$(id),id);
  assert.equal(new Set(Array.from(p.$('cryptoTool').options).map(x=>x.value)).size,78);
  const html=readBuiltHTML();assert(!html.includes('/*__'));assert.equal(p.w.document.querySelectorAll('script[src],link[rel="stylesheet"]').length,0);
  assert.match(p.w.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,/connect-src 'none'/);
  assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('all five workspaces switch both ways without overlapping or losing crypto input',()=>{
 const p=page();try{p.$('cryptoInput').value='keep current exercise';
  for(const from of ['inspection','disk','hash','codec','crypto'])for(const to of ['inspection','disk','hash','codec','crypto']){
   p.$(from==='inspection'?'inspectMode':from+'Mode').click();p.$(to==='inspection'?'inspectMode':to+'Mode').click();visible(p,to);
  }
  assert.equal(p.$('cryptoInput').value,'keep current exercise');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('programmatic image and entry hash navigation hides the crypto workspace',()=>{
 const p=page();try{p.w.HexCryptoUI.open('keep');p.w.HexHash.useImage({});visible(p,'hash');p.w.HexCryptoUI.open('again');p.w.HexHash.useEntry({},{});visible(p,'hash');assert.deepEqual(p.errors,[]);}finally{p.close();}
});

test('dropping E01 while crypto is visible opens the actual native image browser',async t=>{
 const backend=native(t),p=page(backend.api);try{
  p.$('cryptoMode').click();const e=new p.w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{files:[new File(['picker placeholder'],'good.E01')]}});p.w.document.dispatchEvent(e);
  await until(()=>p.$('diskRows').textContent.includes('HELLO.TXT')&&!p.$('diskOpen').disabled);visible(p,'disk');
  assert.equal(backend.f.current.segments.length,6);assert.equal(p.w.HexApp.state.items.length,0);assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('real E01 file to analysis to crypto and back preserves PNG bytes and appended ZIP',async t=>{
 const backend=native(t),p=page(backend.api);try{
  await open(p);Array.from(p.$('diskRows').querySelectorAll('tr')).find(x=>x.textContent.includes('PICTURES')).querySelector('input').click();p.$('diskAnalyze').click();
  await until(()=>p.w.HexApp.state.items.length===1&&p.w.HexApp.state.items[0].result);const original=p.w.HexApp.state.items[0];
  assert(original.result.findings.some(x=>x.type==='ZIP'));choose(p,'convert');p.$('cryptoMode').click();p.$('cryptoImportSelected').click();
  await until(()=>p.$('cryptoStatus').textContent.startsWith('已载入 '));assert.equal(JSON.parse(p.$('cryptoOptions').value).from,'hex');await execute(p);
  p.$('cryptoSaveBytes').click();assert.deepEqual(Buffer.from(await p.downloads.at(-1).blob.arrayBuffer()),Buffer.from(await original.file.arrayBuffer()));
  p.$('cryptoToAnalysis').click();await until(()=>p.w.HexApp.state.items.length===2&&p.w.HexApp.state.items[1].result);visible(p,'inspection');
  const recovered=p.w.HexApp.state.items[1];assert.equal(recovered.file.name,'crypto_result.png');assert(recovered.result.findings.some(x=>x.type==='ZIP'&&x.exportable));
  assert.deepEqual(Buffer.from(await recovered.file.arrayBuffer()),Buffer.from(await original.file.arrayBuffer()));assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('independent crypto worker completes while a native source hash remains busy',async t=>{
 const backend=native(t),hash=backend.api.hashImage;let release;const gate=new Promise(resolve=>release=resolve);backend.api.hashImage=async a=>{await gate;return hash(a);};
 const p=page(backend.api);try{
  await open(p);p.$('diskHashImage').click();await until(()=>!p.$('hashRun').disabled);p.$('hashRun').click();assert(p.$('hashRun').disabled);
  p.$('cryptoMode').click();choose(p,'convert');await execute(p);assert.equal(p.$('cryptoOutput').value,'flag{hello}');
  assert(p.$('hashRun').disabled);assert(p.$('diskOpen').disabled);assert(p.$('mountConvert').disabled);
  release();await until(()=>!p.$('hashJSON').disabled);visible(p,'crypto');p.$('hashMode').click();visible(p,'hash');await until(()=>!p.$('hashJSON').disabled);p.$('hashJSON').click();
  const report=JSON.parse(await p.downloads.at(-1).blob.text()),expected=JSON.parse(fs.readFileSync(path.join(fixture,'hash-vectors.json')));
  assert.equal(report.hashes.find(x=>x.algorithm==='sha256').hex,expected.hashes.sha256);assert.deepEqual(p.errors,[]);
 }finally{release();p.close();}
});

test('crypto stopped after workspace changes can restart without accepting an old result',async()=>{
 const p=page();try{
  p.$('cryptoMode').click();choose(p,'pbkdf2');p.$('cryptoOptions').value=JSON.stringify({...JSON.parse(p.$('cryptoOptions').value),iterations:500000});p.$('cryptoRun').click();
  p.$('codecMode').click();p.$('cryptoMode').click();p.$('cryptoStop').click();assert.equal(p.active.size,0);
  choose(p,'convert');await execute(p);assert.equal(p.$('cryptoOutput').value,'flag{hello}');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('recovered bytes enter analysis even when the queue already contains 1000 files',async()=>{
 const p=page();try{p.$('cryptoMode').click();choose(p,'convert');await execute(p);
  const H=p.w.HexApp;H.state.items=Array.from({length:1000},(_,i)=>({id:i+1,file:new File(['x'],'existing-'+i+'.txt'),path:'existing-'+i+'.txt',status:'cancelled',result:null,chosen:new Set()}));H.state.next=1001;
  p.$('cryptoToAnalysis').click();visible(p,'inspection');assert.equal(H.state.items.length,1001);await until(()=>H.state.items.at(-1).result);assert.equal(await H.state.items.at(-1).file.text(),'flag{hello}');
  p.$('cryptoSaveBytes').click();assert.equal(await p.downloads.at(-1).blob.text(),'flag{hello}');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('codec Hex input transfers to auto analysis with exact byte semantics',async()=>{
 const p=page();try{p.$('codecMode').click();p.$('codecFrom').value='hex';p.$('codecInput').value=Buffer.from('ZmxhZ3tjb2RlY19icmlkZ2V9').toString('hex');
  p.$('cryptoMode').click();p.$('cryptoImportCodec').click();assert.equal(p.$('cryptoFrom').value,'hex');p.$('cryptoDepth').value='2';p.$('cryptoExtended').checked=false;await execute(p);
  assert.equal(p.$('cryptoOutput').value,'flag{codec_bridge}');assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('integrated report identifies 4.1 and retains sorted candidates, paths and byte hashes',async()=>{
 const p=page();try{p.$('cryptoMode').click();p.$('cryptoLoadExample').click();p.$('cryptoExtended').checked=false;p.$('cryptoDepth').value='3';await execute(p);p.$('cryptoSaveReport').click();
  const report=JSON.parse(await p.downloads.at(-1).blob.text());assert.equal(report.application,'HexScope CTF 4.1');const rows=report.result.results;
  assert(rows.length>1);for(let i=1;i<rows.length;i++)assert(rows[i-1].score>=rows[i].score);
  const best=rows.find(x=>x.text==='flag{hello}');assert.equal(best.path.length,2);assert.equal(best.data.hex.replace(/ /g,''),Buffer.from('flag{hello}').toString('hex'));assert.deepEqual(p.errors,[]);
 }finally{p.close();}
});

test('crypto build embeds current app core, codecs and compression rather than the historic copies',()=>{
 const worker=script(readBuiltHTML(),'hexCryptoWorkerSource');
 for(const file of ['src/core.js','src/ctf.js','vendor/fflate.js'])assert(worker.includes(fs.readFileSync(path.join(source,file),'utf8').replace(/<\/script/gi,'<\\/script')));
 const record=JSON.parse(fs.readFileSync(path.join(source,'../HexScope.build.json')));assert.equal(record.cryptoTools,78);
 assert(!Object.keys(record.inputs).some(x=>x.startsWith('base/')||/crypto\/vendor\/hexscope-/.test(x)));
});

test('vendored crypto dependencies match provenance and include license and build lockfiles',()=>{
 const root=path.join(source,'crypto'),record=JSON.parse(fs.readFileSync(path.join(root,'vendor/SOURCES.json')));
 for(const [file,sha]of Object.entries(record.builtFiles))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),sha,file);
 for(const file of ['vendor/crypto-js.LICENSE','vendor/licenses/noble-ciphers.LICENSE','vendor/licenses/noble-hashes.LICENSE','vendor/licenses/noble-curves.LICENSE','vendor/licenses/twofish-ts.LICENSE.txt','vendor/licenses/twofish-ts.package.json','vendor-build/package-lock.json','题型覆盖与限制.md'])assert(fs.statSync(path.join(root,file)).size>0,file);
});
