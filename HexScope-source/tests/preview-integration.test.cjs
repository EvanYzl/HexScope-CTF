'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {page,until}=require('./preview-helper.cjs');
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/preview',name));
test('actual E01 entry travels through the existing push-to-analysis action into text preview',async t=>{
 const {Forensics}=require('../desktop/forensics.cjs'),f=new Forensics(path.resolve(__dirname,'../desktop/engines/tsk/bin'));
 const api={status:()=>f.task(()=>f.status()),open:()=>f.task(()=>f.open(path.resolve(__dirname,'fixtures/disk/split.E01'))),list:a=>f.task(()=>f.list(a)),details:a=>f.task(()=>f.details(a)),analyze:a=>f.task(()=>f.analyze(a)),analyzeBatch:a=>f.task(()=>f.analyzeBatch(a)),planAnalysis:a=>f.task(()=>f.planAnalysis(a)),hashCapabilities:async()=>f.hashCapabilities(),onProgress(){},cancel:async()=>f.cancel()};
 const p=page(api);t.after(()=>{p.close();f.dispose();assert.deepEqual(p.errors,[]);});p.$('diskMode').click();await until(()=>!p.$('diskOpen').disabled);p.$('diskOpen').click();await until(()=>p.$('diskRows').textContent.includes('HELLO.TXT')&&!p.$('diskOpen').disabled);
 const row=[...p.$('diskRows').querySelectorAll('tr')].find(x=>x.textContent.includes('HELLO.TXT'));row.querySelector('input').click();p.$('diskAnalyze').click();await until(()=>p.w.HexApp.state.items.length===1);p.w.HexApp.showTab('preview');await until(()=>p.$('previewStatus').textContent.includes('文本已载入'));
 const item=p.w.HexApp.selected();assert.equal(item.file.name,'HELLO.TXT');const expected=await item.file.text();assert.equal(p.$('previewStage').textContent,expected);assert.match(item.path,/HELLO.TXT/);await until(()=>p.$('diskTransferInfo').textContent.includes('"added": 1'));assert.equal(JSON.parse(p.$('diskTransferInfo').textContent).added,1);
});
test('crypto recovered bytes enter the same preview without lossy text conversion',async t=>{
 const p=page();t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});p.$('cryptoMode').click();p.$('cryptoManualTab').click();p.$('cryptoTool').value='convert';p.$('cryptoTool').dispatchEvent(new p.w.Event('change'));
 p.$('cryptoInput').value=Buffer.from('flag{preview_from_crypto} 中文').toString('base64');p.$('cryptoRun').click();await until(()=>!p.$('cryptoRun').disabled);
 const send=[...p.w.document.querySelectorAll('#cryptoWorkspace button')].find(x=>/送入文件分析/.test(x.textContent)&&!x.disabled);assert(send,'Recovered byte handoff control');send.click();await until(()=>p.w.HexApp.state.items.length===1);p.w.HexApp.showTab('preview');await until(()=>p.$('previewStatus').textContent.includes('文本已载入'));assert.match(p.$('previewStage').textContent,/flag\{preview_from_crypto\} 中文/);
});
test('preview timeout terminates an unresponsive parser and leaves file analysis usable',async t=>{
 const p=page();t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});const Native=p.w.Worker,timeout=p.w.setTimeout.bind(p.w);
 p.w.Worker=class extends Native{postMessage(value,transfer){if(value.action==='open')return;super.postMessage(value,transfer);}};
 p.w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===30000?80:ms,...args);
 await p.open(fixture('sample.docx'),'timeout.docx');assert.match(p.$('previewStatus').textContent,/超过|停止/);assert.equal(p.w.HexPreview.state.worker,null);
 p.w.HexApp.showTab('hex');assert.equal(p.$('hexPanel').hidden,false);assert.equal(p.$('previewPanel').hidden,true);
});
test('audio/video controls are local and never autoplay',async t=>{
 const p=page();t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});for(const name of ['sample.mp3','sample.mp4']){
  await p.open(new Uint8Array([0,0,0,0,255]),name);const media=p.$('previewStage').querySelector('audio,video');assert(media);assert.equal(media.autoplay,false);assert.equal(media.controls,true);assert.match(media.src,/^blob:/);
 }
});
test('analysis completion cannot restart a preview hidden by another workspace',async t=>{
 const p=page();t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});await p.open(fixture('sample.xlsx'),'sample.xlsx');p.w.HexApp.showWorkspace('codec');p.w.HexApp.renderDetail();await new Promise(r=>setTimeout(r,50));assert.equal(p.w.HexPreview.state.worker,null);assert.equal(p.w.HexPreview.state.id,null);
});
