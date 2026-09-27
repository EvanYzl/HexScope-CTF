'use strict';
const fs=require('node:fs'),path=require('node:path');
const libs=require('./vendor/vision/libraries.cjs');
const assets=path.join(__dirname,'vendor/vision');
const {PDFDocument}=libs['pdf-lib'];
const manifest=()=>JSON.parse(fs.readFileSync(path.join(assets,'languages.json'),'utf8'));
const LIMIT=64*1024*1024;
function bytes(value,max=LIMIT){
 if(!(value instanceof Uint8Array)&&!(value instanceof ArrayBuffer))throw Error('需要文件字节，不能使用路径或网址。');
 const data=Buffer.from(value);if(!data.length||data.length>max)throw Error('单次文件数据需介于 1 字节与 '+max/1024/1024+' MiB。');return data;
}
function png(value){
 const data=bytes(value,32*1024*1024);
 if(data.length<33||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('请先将图像转换为 PNG 像素副本。');
 const w=data.readUInt32BE(16),h=data.readUInt32BE(20);
 if(!w||!h||w*h>16000000)throw Error('单块图像上限为 1,600 万像素，请分块识别。');return data;
}
function text(value,max=8*1024*1024){if(typeof value!=='string'||value.length>max)throw Error('文本参数无效或过大。');return value;}
function grid(value){
 if(!Array.isArray(value)||value.length>10000)throw Error('表格最多导出 10,000 行。');
 let length=0;return value.map(row=>{if(!Array.isArray(row)||row.length>256)throw Error('表格最多 256 列。');return row.map(x=>{x=String(x??'');length+=x.length;if(length>8000000)throw Error('表格内容过大。');return x;});});
}
function capabilities(){return {languages:manifest().models.map(({code,name})=>({code,name})),cpu:true,
 barcodeRead:libs['zxing-wasm'].READABLE_BARCODE_FORMATS,
 barcodeWrite:libs['bwip-js'].symbolList.map(v=>({id:v.bcid,description:v.desc||v.bcid,example:v.text,options:v.opts}))};}
class VisionEngine{
 constructor(progress=()=>{}){this.progress=progress;this.ocr=null;this.language=null;}
 async close(){await this.ocr?.terminate();this.ocr=null;}
 async run(op,args={}){
  if(op==='capabilities')return capabilities();
  if(op==='ocr'){
   const image=png(args.bytes),available=new Set(manifest().models.map(x=>x.code));
   const languages=args.languages||['chi_sim','eng'];
   if(!Array.isArray(languages)||!languages.length||languages.length>4||languages.some(x=>!available.has(x)))throw Error('请选择 1–4 个内置语言模型。');
   const language=[...new Set(languages)].sort().join('+');
   if(language!==this.language){await this.close();this.language=language;
    this.ocr=await libs['tesseract.js'].createWorker(language,1,{workerPath:path.join(assets,'ocr-worker.cjs'),
     langPath:path.join(assets,'languages'),cacheMethod:'none',gzip:true,logger:m=>this.progress({status:m.status,progress:m.progress})});
   }
   const psm=Number(args.psm??3);if(![3,4,5,6,7,8,11,12,13].includes(psm))throw Error('无效的版面模式。');
   await this.ocr.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
   const {data}=await this.ocr.recognize(image,{rotateAuto:args.deskew!==false,pdfTextOnly:!!args.textOnlyPDF},
    {text:true,blocks:true,tsv:true,pdf:args.pdf!==false});
   const words=[];
   for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[])words.push({text:word.text,confidence:word.confidence,bbox:word.bbox});
   return {text:data.text,confidence:data.confidence,words,tsv:data.tsv,rotation:data.rotateRadians,pdf:data.pdf,
    width:image.readUInt32BE(16),height:image.readUInt32BE(20),engine:'Tesseract.js 7.0.0 / CPU'};
  }
  if(op==='barcode-read'){
   const image=png(args.bytes),zxing=libs['zxing-wasm'];
   zxing.prepareZXingModule({overrides:{wasmBinary:fs.readFileSync(path.join(assets,'zxing_full.wasm'))}});
   const found=await zxing.readBarcodes(image,{tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:true,maxNumberOfSymbols:255});
   const output=found.filter(x=>x.isValid!==false).map(x=>({format:x.format,text:x.text,bytes:x.bytes,position:x.position,symbology:x.symbology,contentType:x.contentType,
    ...(x.format==='EAN13'&&/^0\d{12}$/.test(x.text)?{equivalent:{format:'UPCA',text:x.text.slice(1)}}:{})}));
   return output;
  }
  if(op==='barcode-create'){
   const code=text(args.format,80),all=libs['bwip-js'].symbolList;
   if(!all.some(x=>x.bcid===code))throw Error('不支持的条码类型。');
   const value=text(args.text,12000),scale=Math.round(Number(args.scale??3));
   if(scale<1||scale>8)throw Error('条码倍率应为 1–8。');
   const defaults={};
   // These defaults are authored by the bundled library, never interpreted as code.
   if(args.useExample){const entry=all.find(x=>x.bcid===code);if(value!==entry.text)throw Error('示例内容已改变，请关闭示例选项。');
    for(const option of (entry.opts||'').split(/\s+/)){const [key,v]=option.split('=');if(/^[a-z][a-z0-9]*$/i.test(key))defaults[key]=v===undefined?true:v;}}
   // Code 93 requires C and K check characters. BWIPP leaves includecheck off
   // by default so callers can supply them; HexScope accepts the payload only.
   if(code==='code93'||code==='code93ext')defaults.includecheck=true;
   return await libs['bwip-js'].toBuffer({...defaults,bcid:code,text:value,scale,paddingwidth:12,paddingheight:12,
    includetext:!!args.caption,backgroundcolor:'ffffff',...(args.options&&typeof args.options==='object'?{
     ...(args.options.eclevel&&['L','M','Q','H'].includes(args.options.eclevel)?{eclevel:args.options.eclevel}:{}),
     ...(args.options.mode&&[2,3,4,5,6].includes(args.options.mode)?{mode:args.options.mode}:{})}: {})});
  }
  if(op==='docx'){
   const D=libs.docx,value=text(args.text||''),rows=args.rows?grid(args.rows):null;
   const children=value.split(/\r?\n/).map(line=>new D.Paragraph({children:[new D.TextRun({text:line,font:'宋体',size:24})]}));
   if(rows)children.push(new D.Table({rows:rows.map(row=>new D.TableRow({children:row.map(cell=>new D.TableCell({children:[new D.Paragraph({children:[new D.TextRun({text:cell,font:'宋体',size:24})]})]}))}))}));
   const doc=new D.Document({creator:'HexScope CTF',title:text(args.title||'识别文本',300),sections:[{children}]});
   return new Uint8Array(await D.Packer.toBuffer(doc));
  }
  if(op==='xlsx'){
   const rows=grid(args.rows),X=require('./vendor/vision/sheetjs.cjs');
   const sheet=X.utils.aoa_to_sheet(rows); // all cells are strings: formulas from evidence are never executed.
   const book=X.utils.book_new();X.utils.book_append_sheet(book,sheet,'识别表格');
   return X.write(book,{type:'buffer',bookType:'xlsx'});
  }
  if(op==='pdf-raster'){
   if(!Array.isArray(args.pages)||!args.pages.length||args.pages.length>1000)throw Error('需要 1–1,000 页图片。');
   const doc=await PDFDocument.create();let total=0;
   for(const p of args.pages){const b=bytes(p.bytes,32*1024*1024);total+=b.length;if(total>256*1024*1024)throw Error('PDF 图像超过 256 MiB。');
    if(!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<1||p.height<1||p.width>14400||p.height>14400)throw Error('PDF 页面尺寸无效。');
    // pdf-lib's JPEG parser reads from buffer offset zero; a pooled Node Buffer
    // can have a nonzero byteOffset, so pass a standalone byte array.
    const image=await doc.embedJpg(Uint8Array.from(b)),page=doc.addPage([p.width,p.height]);page.drawImage(image,{x:0,y:0,width:p.width,height:p.height});
   }return await doc.save();
  }
  if(op==='pdf-merge'||op==='pdf-overlay'){
   if(!Array.isArray(args.pages)||!args.pages.length||args.pages.length>1000)throw Error('一次合并需要 1–1,000 页 PDF。');
   let total=0;const pages=args.pages.map(value=>{const b=bytes(value);total+=b.length;if(total>256*1024*1024)throw Error('PDF 合并输入上限 256 MiB。');return b;});
   const doc=op==='pdf-overlay'?await PDFDocument.load(bytes(args.original)):await PDFDocument.create();
   if(op==='pdf-overlay'&&doc.getPageCount()!==pages.length)throw Error('OCR 文本层与原 PDF 页数不一致。');
   for(let i=0;i<pages.length;i++){
    this.progress({status:'生成 PDF',progress:i/pages.length});
    if(op==='pdf-overlay'){
     const [embedded]=await doc.embedPdf(pages[i],[0]),page=doc.getPage(i);page.drawPage(embedded,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});
    }else{const src=await PDFDocument.load(pages[i]);for(const page of await doc.copyPages(src,src.getPageIndices()))doc.addPage(page);}
   }
   return await doc.save();
  }
  throw Error('未知的图文工具操作。');
 }
}
module.exports={VisionEngine,capabilities,bytes,png,grid};
