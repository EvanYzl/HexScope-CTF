'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {previewWorker,page,until}=require('./preview-helper.cjs'),{readBuiltHTML,script}=require('./built-artifact.cjs');
const fixture=name=>new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures/preview',name)));
function setup(t){const p=page();t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});return p;}
test('preview assets and CSP belong to the current integrated 4.1 build',()=>{
 const html=readBuiltHTML();for(const id of ['previewCoreCode','previewWorkerSource','previewPdfLibrary','previewPdfWorker','previewUiCode'])assert(script(html,id).length>100);
 assert.match(html,/connect-src 'none'/);assert.match(html,/font-src blob: data:/);assert.match(html,/wasm-unsafe-eval/);assert.match(html,/data-tab="preview"/);
 const vendor=path.resolve(__dirname,'../preview/vendor'),record=JSON.parse(fs.readFileSync(path.join(vendor,'SOURCES.json'))),sha=data=>require('node:crypto').createHash('sha256').update(data).digest('hex');
 for(const [file,hash]of Object.entries(record.builtFiles))assert.equal(sha(fs.readFileSync(path.join(vendor,file))),hash,file);
 for(const component of record.components)assert.equal(sha(fs.readFileSync(path.join(vendor,'upstream-archives',component.archive))),component.archiveSHA256);
});
test('actual preview worker converts independent DOCX text, table and image',async t=>{
 const w=previewWorker();t.after(()=>w.close());const r=await w.run({bytes:fixture('sample.docx'),name:'sample.docx',kind:'docx'});
 assert.equal(r.kind,'docx');assert.match(r.html,/flag\{docx_preview\}/);assert.match(r.html,/<table>/);assert.match(r.html,/data:image\/png;base64,/);assert.match(r.html,/中文正文/);
});
test('actual preview worker reads Excel formatted values, formula, hidden sheets and row limits',async t=>{
 const w=previewWorker();t.after(()=>w.close());const r=await w.run({bytes:fixture('sample.xlsx'),name:'sample.xlsx',kind:'spreadsheet'});
 assert.equal(r.sheets.length,2);assert.equal(r.sheets[1].hidden,1);assert.equal(r.rows[1].cells[1].text,'1,234.50');assert.equal(r.rows[1].cells[2].formula,'SUM(B2,10)');assert.equal(r.limited,true);assert.equal(r.columns.length,100);assert.equal(r.matchedRows,2000);
 const hidden=await w.run({action:'sheet',sheet:1});assert.equal(hidden.rows[0].cells[0].text,'flag{hidden_sheet}');
 const found=await w.run({action:'sheet',sheet:0,query:'row-1150'});assert.equal(found.rows.length,1);assert.equal(found.rows[0].number,1150);
});
test('DOCX is recognized inside a ZIP with a misleading extension',async t=>{
 const w=previewWorker();t.after(()=>w.close());const r=await w.run({bytes:fixture('sample.docx'),name:'recovered.zip',kind:'zip'});assert.equal(r.kind,'docx');
});
test('DOCX UI uses reconstructed nodes and strips executable markup and links',async t=>{
 const p=setup(t);await p.open(fixture('sample.docx'),'sample.docx');assert.match(p.$('previewStatus').textContent,/已载入/);assert.match(p.$('previewStage').textContent,/flag\{docx_preview\}/);
 assert.equal(p.$('previewStage').querySelectorAll('table').length,1);assert.equal(p.$('previewStage').querySelectorAll('img').length,1);assert.equal(p.$('previewStage').querySelectorAll('a,script,iframe').length,0);
 const safe=p.w.HexPreview.safeDocument('<p onclick="alert(1)">safe<a href="javascript:x">link</a><script>bad</script><img src="https://example.invalid/x"><svg onload="x"/></p>');assert.match(safe.textContent,/safelink/);assert.equal(safe.querySelectorAll('[onclick],[href],script,img,svg').length,0);
});
test('Excel UI displays values literally and supports sheet selection',async t=>{
 const p=setup(t);await p.open(fixture('sample.xlsx'),'sample.xlsx');assert.match(p.$('previewStatus').textContent,/工作表/);assert.match(p.$('previewStage').textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(p.$('previewStage').querySelectorAll('img,script').length,0);
 const picker=p.$('previewTools').querySelector('select');picker.value='1';picker.dispatchEvent(new p.w.Event('change'));await until(()=>p.$('previewStage').textContent.includes('flag{hidden_sheet}'));
});
test('PDF real worker parses two pages; native canvas renders text without executing OpenAction',async t=>{
 const p=setup(t);await p.open(fixture('sample.pdf'),'sample.pdf');assert.match(p.$('previewStatus').textContent,/PDF 第 1 \/ 2 页/);assert.match(p.$('previewStage').textContent,/flag\{pdf_page_one\}/);
 const canvas=p.$('previewStage').querySelector('canvas');assert.equal(canvas.width,320);assert.equal(canvas.height,180);const pixels=canvas._native.getContext('2d').getImageData(0,0,320,180).data;assert(pixels.some((value,i)=>i%4!==3&&value<180),'rendered visible ink');
 [...p.$('previewTools').querySelectorAll('button')].find(x=>x.textContent==='下一页 →').click();await until(()=>p.$('previewStatus').textContent.includes('PDF 第 2 / 2 页'));assert.match(p.$('previewStage').textContent,/flag\{pdf_page_two\}/);assert.equal(p.$('previewStage').querySelector('canvas').width,180);
});
test('text preview detects GB18030 and UTF-16; renders HTML as inert text',async t=>{
 const p=setup(t);await p.open(fixture('gbk.txt'),'gbk.txt');assert.match(p.$('previewStage').textContent,/中文线索/);assert.match(p.$('previewStatus').textContent,/gb18030/);
 await p.open(fixture('utf16.txt'),'utf16.txt');assert.match(p.$('previewStage').textContent,/中文 UTF16/);
 await p.open(new TextEncoder().encode('<script>alert(1)</script><img src=x onerror=x>'),'sample.html');assert.equal(p.$('previewStage').querySelectorAll('script,img').length,0);assert.match(p.$('previewStage').textContent,/<script>/);
});
