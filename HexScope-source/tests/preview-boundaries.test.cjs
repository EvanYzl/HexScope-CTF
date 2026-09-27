'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {previewWorker,page,until}=require('./preview-helper.cjs'),{readBuiltHTML,script}=require('./built-artifact.cjs');
const F=require('../vendor/fflate.js'),fixture=name=>new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures/preview',name)));
function setup(t){const p=page();t.after(()=>{p.close();assert.deepEqual(p.errors,[]);});return p;}
function core(){const r={TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView};r.self=r;r.globalThis=r;vm.createContext(r);vm.runInContext(script(readBuiltHTML(),'coreCode')+'\n;'+script(readBuiltHTML(),'previewCoreCode'),r);return r.HexPreviewCore;}
function zip(files){const entries=Object.create(null);for(const [name,value]of Object.entries(files))entries[name]=typeof value==='string'?new TextEncoder().encode(value):value;return F.zipSync(entries);}
for(const extension of ['xls','xlsb','ods','csv'])test('real worker previews '+extension.toUpperCase()+' without Office',async t=>{
 const w=previewWorker();t.after(()=>w.close());const r=await w.run({bytes:fixture('sample.'+extension),name:'sample.'+extension,kind:'spreadsheet'});assert.equal(r.kind,'spreadsheet');assert.match(JSON.stringify(r),/中文/);if(extension!=='csv')assert.equal(r.rows[1].cells[1].text,'123');else assert.equal(r.rows[1].cells[2].text,'逗号,引号');
});
test('UTF-8 preview boundary holds incomplete code points without false GB18030 fallback',()=>{
 const p=core(),bytes=new Uint8Array(p.LIMITS.text+6).fill(65);bytes.set(new TextEncoder().encode('中文'),p.LIMITS.text-1);const result=p.text(bytes);assert.equal(result.encoding,'utf-8');assert.equal(result.truncated,true);assert(!result.text.includes('�'));assert.equal(result.text.length,p.LIMITS.text-1);
});
test('CSV without BOM and GB18030 TSV preserve Chinese text and never evaluate formulas',async t=>{
 const w=previewWorker();t.after(()=>w.close());const csv=await w.run({bytes:new TextEncoder().encode('名称,公式\n中文,=1+1'),name:'a.csv',kind:'spreadsheet'});assert.equal(csv.rows[1].cells[0].text,'中文');assert.equal(csv.rows[1].cells[1].formula,'1+1');assert.notEqual(csv.rows[1].cells[1].text,'2');
 const tsv=await w.run({bytes:Buffer.concat([Buffer.from([0xc3,0xfb,0xb3,0xc6]),Buffer.from('\tvalue\n'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('\t42')]),name:'a.tsv',kind:'spreadsheet'});assert.equal(tsv.rows[1].cells[0].text,'中文');
});
test('magic wins over misleading image extension and oversized image dimensions are recognized',()=>{
 const p=core(),data=fixture('pixel.png');assert.equal(p.classify(data,'renamed.docx').kind,'image');const v=new DataView(data.buffer);v.setUint32(16,100000);v.setUint32(20,100000);assert(p.dimensions(data).reduce((a,b)=>a*b)>p.LIMITS.pixels);
});
test('legacy DOC, TIFF and arbitrary binary receive explicit unsupported results',()=>{
 const p=core();for(const name of ['old.doc','scan.tif','data.bin'])assert.equal(p.classify(new Uint8Array([0,0,0,255]),name).kind,'unsupported');
});
test('Office traversal paths are rejected before parsing XML',async t=>{
 const w=previewWorker();t.after(()=>w.close());await assert.rejects(w.run({bytes:zip({'../secret.txt':'no','word/document.xml':'<w/>'}),name:'bad.docx',kind:'docx'}),/不安全/);
});
for(const encoding of ['utf8','utf16le'])test('Office '+encoding+' XML entity declarations are rejected',async t=>{
 const w=previewWorker();t.after(()=>w.close());const xml=Buffer.from('<!DOCTYPE x [<!ENTITY a "boom">]><x>&a;</x>',encoding);
 await assert.rejects(w.run({bytes:zip({'word/document.xml':xml}),name:'bad.docx',kind:'docx'}),/DTD/);
});
test('Office expansion budget rejects a tiny compressed oversized member',async t=>{
 const w=previewWorker();t.after(()=>w.close());const bytes=zip({'word/document.xml':new Uint8Array(16*1024*1024+1)});assert(bytes.length<40000);await assert.rejects(w.run({bytes,name:'bomb.docx',kind:'docx'}),/解压内容超过/);
});
test('Office corrupted CRC fails instead of displaying unchecked data',async t=>{
 const w=previewWorker();t.after(()=>w.close());const bytes=zip({'word/document.xml':'some repeated content '.repeat(100)});const view=new DataView(bytes.buffer);view.setUint32(14,0,true);let i=0;for(;i<bytes.length-4;i++)if(view.getUint32(i,true)===0x02014b50)break;view.setUint32(i+16,0,true);await assert.rejects(w.run({bytes,name:'bad.docx',kind:'docx'}),/CRC/);
});
test('invalid and encrypted ZIP entries fail clearly',async t=>{
 const w=previewWorker();t.after(()=>w.close());await assert.rejects(w.run({bytes:new Uint8Array([80,75,3,4]),name:'broken.docx',kind:'docx'}),/损坏/);
 const bytes=zip({'word/document.xml':'<w/>'}),v=new DataView(bytes.buffer);v.setUint16(6,v.getUint16(6,true)|1,true);let i=0;for(;i<bytes.length-4;i++)if(v.getUint32(i,true)===0x02014b50)break;v.setUint16(i+8,v.getUint16(i+8,true)|1,true);await assert.rejects(w.run({bytes,name:'locked.docx',kind:'docx'}),/加密/);
});
test('generic ZIP lists literal member paths and sizes',async t=>{
 const w=previewWorker();t.after(()=>w.close());const r=await w.run({bytes:zip({'folder/<img>.txt':'flag{zip_directory}'}),kind:'zip',name:'a.zip'});assert.equal(r.kind,'archive');assert.equal(r.entries[0].name,'folder/<img>.txt');assert.equal(r.entries[0].size,19);
});
test('PDF AES-256 password prompt retries, succeeds and clears the password field',async t=>{
 const p=setup(t);await p.open(fixture('encrypted.pdf'),'encrypted.pdf');assert.equal(p.$('previewPasswordForm').hidden,false);p.$('previewPassword').value='wrong';p.$('previewPasswordForm').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await until(()=>p.$('previewStatus').textContent.includes('不正确'));
 p.$('previewPassword').value='hexscope';p.$('previewPasswordForm').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await until(()=>p.$('previewStatus').textContent.includes('PDF 第 1 / 2 页'));assert.equal(p.$('previewPassword').value,'');assert.equal(p.$('previewPasswordForm').hidden,true);assert.match(p.$('previewStage').textContent,/flag\{pdf_page_one\}/);
});
test('all PDF CMaps, standard fonts and WASM resources are embedded; factory disallows other names',async t=>{
 const p=setup(t),map=JSON.parse(p.$('previewPdfAssets').textContent),factory=new p.w.HexPreviewPDF.OfflineBinaryDataFactory();assert(Object.keys(map).filter(x=>x.endsWith('.bcmap')).length>150);
 for(const [kind,filename]of [['cMapUrl','UniGB-UCS2-H.bcmap'],['standardFontDataUrl','LiberationSans-Regular.ttf'],['wasmUrl','openjpeg.wasm']]){const bytes=await factory.fetch({kind,filename});assert(bytes.length>100);}
 await assert.rejects(factory.fetch({kind:'wasmUrl',filename:'../../secret'}),/无效/);await assert.rejects(factory.fetch({kind:'network',filename:'https:'}),/无效/);
 const wasm=await factory.fetch({kind:'wasmUrl',filename:'qcms_bg.wasm'});assert(WebAssembly.validate(wasm));
});
test('malformed PDF returns a visible failure with released worker',async t=>{
 const p=setup(t);await p.open(new TextEncoder().encode('%PDF-1.7\nbroken\n'),'bad.pdf');assert.match(p.$('previewStatus').textContent,/无法预览/);assert.equal(p.w.HexPreview.state.pdf,null);
});
test('stopping a password-protected PDF releases resources and later files still open',async t=>{
 const p=setup(t);await p.open(fixture('encrypted.pdf'),'encrypted.pdf');p.$('previewStop').click();assert.equal(p.w.HexPreview.state.pdf,null);assert.equal(p.$('previewPasswordForm').hidden,true);assert.match(p.$('previewStatus').textContent,/已停止/);assert.equal(p.w.HexPreview.state.urls.size,0);
 await p.open(new TextEncoder().encode('flag{after_stop}'),'next.txt');assert.match(p.$('previewStage').textContent,/flag\{after_stop\}/);
});
test('switching files suppresses a late asynchronous read from the prior selection',async t=>{
 const p=setup(t);let resolve;
 const slow={id:10001,file:{name:'slow.docx',size:1024,slice(){return {arrayBuffer(){return new Promise(r=>{resolve=r;});}}}}};
 const pending=p.w.HexPreview.load(slow);await until(()=>typeof resolve==='function');await p.open(new TextEncoder().encode('current file'),'current.txt');resolve(fixture('sample.docx').buffer);await pending;assert.equal(p.$('previewStage').textContent,'current file');
});
test('clear queue and workspace navigation dispose the spreadsheet worker',async t=>{
 const p=setup(t);await p.open(fixture('sample.xlsx'),'sample.xlsx');assert(p.w.HexPreview.state.worker);p.$('clearBtn').click();assert.equal(p.w.HexPreview.state.worker,null);assert.equal(p.w.HexPreview.state.id,null);assert.equal(p.$('previewStage').childElementCount,0);
 await p.open(fixture('sample.xlsx'),'again.xlsx');p.w.HexApp.showWorkspace('codec');assert.equal(p.w.HexPreview.state.worker,null);p.w.HexApp.showWorkspace('inspection');await until(()=>p.$('previewStatus').textContent.includes('工作表'));
});
test('image controls rotate the view and release its Blob on file change',async t=>{
 const p=setup(t),pending=p.open(fixture('pixel.png'),'image.png');await until(()=>p.$('previewStage').querySelector('img'));const img=p.$('previewStage').querySelector('img');Object.defineProperties(img,{naturalWidth:{value:2},naturalHeight:{value:2}});img.onload();await pending;
 const original=img.src;[...p.$('previewTools').querySelectorAll('button')].find(x=>x.textContent==='旋转 90°').click();assert.equal(img.style.transform,'rotate(90deg)');
 await p.open(new TextEncoder().encode('next'),'next.txt');assert(!p.blobs.has(original));
});
test('oversized images are rejected before creating a native decoder element',async t=>{
 const p=setup(t),bytes=fixture('pixel.png'),v=new DataView(bytes.buffer);v.setUint32(16,100000);v.setUint32(20,100000);await p.open(bytes,'large.png');assert.match(p.$('previewStatus').textContent,/像素预览上限/);assert.equal(p.$('previewStage').querySelector('img'),null);
});
test('Office and PDF byte caps apply before reading their full contents',async t=>{
 const p=setup(t);for(const [name,size,header]of [['huge.docx',33*1024*1024,new Uint8Array([80,75,3,4])],['huge.pdf',65*1024*1024,new TextEncoder().encode('%PDF-1.7')]]){
  let read=false;await p.w.HexPreview.load({id:name,file:{name,size,slice(start,end){if(start!==0||end>65536){read=true;throw Error('must not read full file');}const bytes=new Uint8Array(end-start);bytes.set(header);return new Blob([bytes]);},arrayBuffer(){read=true;throw Error('must not read');}}});assert.equal(read,false);assert.match(p.$('previewStatus').textContent,/上限/);
 }
});
