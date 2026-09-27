'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const {VisionEngine,capabilities}=require('../desktop/vision-engine.cjs'),{VisionService,installVisionIPC}=require('../desktop/vision-ipc.cjs');
const V=require('../vision/core.js'),{PDFDocument}=require('../desktop/vendor/vision/libraries.cjs')['pdf-lib'];
const root=path.resolve(__dirname,'../desktop'),vendor=path.join(root,'vendor/vision'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function sample(lines=['HexScope Offline OCR 123456','HELLO WORLD']){const c=createCanvas(1300,lines.length*90+50),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#000';x.font='52px Arial';lines.forEach((s,i)=>x.fillText(s,40,90+i*90));return c.toBuffer('image/png');}

test('all bundled language models and CJK font match pinned provenance and can decompress',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(vendor,'languages.json')));assert.equal(data.models.length,73);
 for(const model of data.models){const gz=fs.readFileSync(path.join(vendor,'languages',model.code+'.traineddata.gz'));assert.equal(sha(gz),model.compressedSHA256,model.code);const raw=zlib.gunzipSync(gz);assert.equal(raw.length,model.bytes);assert.equal(sha(raw),model.sha256);}
 const font=JSON.parse(fs.readFileSync(path.join(vendor,'font.json')));assert.equal(sha(fs.readFileSync(path.join(vendor,'NotoSansCJKsc-Regular.otf'))),font.sha256);
});
test('capability catalog contains local models, independent readable formats and generator examples',()=>{
 const c=capabilities();assert.equal(c.cpu,true);assert.equal(c.languages.length,73);assert.equal(c.barcodeWrite.length,111);assert(c.barcodeRead.includes('QRCode'));assert(c.barcodeRead.includes('MaxiCode'));assert(c.barcodeWrite.every(x=>x.id&&x.description&&x.example));
});
for(const [format,value,expected]of [['qrcode','flag{offline_qr}','QRCode'],['datamatrix','HexScope123','DataMatrix'],['azteccode','HexScope123','Aztec'],['pdf417','HexScope123','PDF417'],['code128','HexScope123','Code128'],['code39','HEXSCOPE123','Code39'],['code93','HEXSCOPE123','Code93'],['ean13','9520123456788','EAN13'],['ean8','95200002','EAN8'],['upca','012345000058','UPCA']])
 test('actual offline barcode roundtrip: '+format,async()=>{const engine=new VisionEngine();try{const bytes=await engine.run('barcode-create',{format,text:value});const found=await engine.run('barcode-read',{bytes});assert(found.some(x=>x.text===value&&x.format.startsWith(expected)||x.equivalent?.text===value&&x.equivalent?.format===expected),JSON.stringify(found));}finally{await engine.close();}});
test('all 111 advertised barcode generators accept the upstream standard examples',async()=>{
 const engine=new VisionEngine(),errors=[];try{for(const x of capabilities().barcodeWrite){try{const png=await engine.run('barcode-create',{format:x.id,text:x.example,useExample:true,scale:1});assert(png.length>50);}catch(e){errors.push(x.id+': '+e.message);}}}finally{await engine.close();}assert.deepEqual(errors,[]);
});
test('OCR subprocess uses packaged local worker/models and produces words plus a readable searchable PDF',async()=>{
 const service=new VisionService(),progress=[];try{const r=await service.run(100,'ocr',{bytes:sample(),languages:['eng']},p=>progress.push(p));
  assert.match(r.text,/HexScope Offline OCR 123456/);assert.match(r.text,/HELLO WORLD/);assert(r.words.length>=5);assert(r.confidence>70);assert(progress.some(x=>x.status==='recognizing text'));
  const doc=await PDFDocument.load(r.pdf);assert.equal(doc.getPageCount(),1);assert.equal(r.engine,'Tesseract.js 7.0.0 / CPU');
 }finally{service.close();}
});
test('Chinese and English mixed OCR is recognized with the shipped CJK model and font',async()=>{
 GlobalFonts.registerFromPath(path.join(vendor,'NotoSansCJKsc-Regular.otf'),'HexScopeTestCJK');const c=createCanvas(1200,220),x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='60px HexScopeTestCJK';x.fillText('文件分析 中文识别',35,90);x.fillText('HexScope 123456',35,180);
 const e=new VisionEngine();try{const r=await e.run('ocr',{bytes:c.toBuffer('image/png'),languages:['chi_sim','eng'],psm:6,pdf:false});assert.match(r.text.replace(/\s/g,''),/文件分析中文识别/);assert.match(r.text,/123456/);}finally{await e.close();}
});
test('cancelling a real OCR child rejects promptly and leaves the service reusable',async()=>{
 const s=new VisionService();const work=s.run(1,'ocr',{bytes:sample(),languages:['eng']});s.cancel(1);await assert.rejects(work,/已停止/);assert.equal(s.active.size,0);const c=await s.run(2,'capabilities',{});assert.equal(c.languages.length,73);s.close();
});
test('OCR and barcode reject paths, unknown models and huge pixel declarations before processing',async()=>{
 const e=new VisionEngine();try{await assert.rejects(e.run('ocr',{bytes:'C:\\private.png'}),/不能使用路径/);
  await assert.rejects(e.run('ocr',{bytes:sample(),languages:['https://invalid.test/model']}),/内置语言/);
  const png=sample();png.writeUInt32BE(1000000,16);await assert.rejects(e.run('barcode-read',{bytes:png}),/像素/);
  await assert.rejects(e.run('barcode-create',{format:'eval',text:'anything'}),/不支持/);
  await assert.rejects(e.run('docx',{text:'x'.repeat(8*1024*1024+1)}),/过大/);
 }finally{await e.close();}
});
test('DOCX and XLSX exports preserve Unicode while spreadsheet formula-looking strings remain text',async()=>{
 const e=new VisionEngine(),F=require('../vendor/fflate.js'),X=require('../desktop/vendor/vision/sheetjs.cjs');try{
  const doc=await e.run('docx',{text:'中文结果\nHello',rows:[['姓名','分数'],['小明','100']]});const zip=F.unzipSync(doc),xml=new TextDecoder().decode(zip['word/document.xml']);assert(xml.includes('中文结果'));assert(xml.includes('小明'));
  const xlsx=await e.run('xlsx',{rows:[['=HYPERLINK("x")','中文'],['100','text']]});const book=X.read(xlsx,{type:'buffer'});assert.equal(book.Sheets['识别表格'].A1.t,'s');assert.equal(book.Sheets['识别表格'].A1.f,undefined);assert.equal(book.Sheets['识别表格'].B1.v,'中文');
 }finally{await e.close();}
});
test('PDF text overlays and multi-page merging keep original page size and page count',async()=>{
 const e=new VisionEngine();try{const r=await e.run('ocr',{bytes:sample(),languages:['eng'],textOnlyPDF:true});const src=await PDFDocument.create();src.addPage([400,700]);const original=await src.save();
 const over=await e.run('pdf-overlay',{original,pages:[r.pdf]}),doc=await PDFDocument.load(over);assert.equal(doc.getPageCount(),1);assert.equal(doc.getPage(0).getWidth(),400);assert.equal(doc.getPage(0).getHeight(),700);
 const merged=await e.run('pdf-merge',{pages:[r.pdf,r.pdf]});assert.equal((await PDFDocument.load(merged)).getPageCount(),2);
 await assert.rejects(e.run('pdf-overlay',{original,pages:[r.pdf,r.pdf]}),/页数不一致/);
 }finally{await e.close();}
});
test('vision IPC denies untrusted frames and preserves request IDs in progress events',async()=>{
 const {pathToFileURL}=require('node:url'),handlers=new Map();let closed;const mainFrame={url:pathToFileURL(path.join(root,'HexScope.html')).href},webContents={mainFrame,isDestroyed:()=>false,send(){}};
 const ipcMain={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},win={webContents,on:(_name,fn)=>closed=fn};
 installVisionIPC({ipcMain},win,root);const handle=handlers.get('hexscope:vision');assert.equal((await handle({sender:{},senderFrame:mainFrame},'capabilities',{id:1})).ok,false);
 assert.equal((await handle({sender:webContents,senderFrame:{...mainFrame}},'capabilities',{id:2})).ok,false);
 const result=await handle({sender:webContents,senderFrame:mainFrame},'capabilities',{id:3});assert.equal(result.ok,true);assert.equal(result.data.languages.length,73);closed();assert.equal(handlers.size,0);
});
test('text cleanup, spreadsheet escaping, table coordinates and long-image tiling are deterministic',()=>{
 assert.equal(V.cleanText('中文\n测试\n\nhello\nworld',{join:true}),'中文测试\n\nhello world');assert.equal(V.cleanText('a\na\nb',{dedupe:true}),'a\nb');
 assert(V.csv([['=cmd',1]]).includes("'=cmd"));const words=[{text:'A',bbox:{x0:1,y0:1,x1:12,y1:12}},{text:'B',bbox:{x0:100,y0:1,x1:112,y1:12}},{text:'C',bbox:{x0:1,y0:30,x1:12,y1:42}},{text:'D',bbox:{x0:100,y0:30,x1:112,y1:42}}];assert.deepEqual(V.wordsToRows(words),[['A','B'],['C','D']]);
 const parts=V.tiles(2000,20000);assert(parts.length>2);assert(parts.every(p=>p.width*p.height<=7000000));assert.equal(parts.at(-1).y+parts.at(-1).height,20000);assert.throws(()=>V.tiles(100000,100000),/尺寸/);
});
test('scrolling screenshot matcher finds overlapping pixels and rejects flat, ambiguous regions',()=>{
 const w=40,h=120,pixels=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let k=0;k<3;k++)pixels[(y*w+x)*4+k]=(y*17+x*11+k*5)%256;
 const a=pixels.slice(0,w*80*4),b=pixels.slice(w*50*4);assert.equal(V.stitchOverlap(a,b,w,80,70),30);assert.equal(V.stitchOverlap(new Uint8Array(w*80*4),new Uint8Array(w*70*4),w,80,70),0);
});
