(function(root){
'use strict';
const MiB=1024*1024;
const LIMITS={office:32*MiB,member:16*MiB,inflated:48*MiB,entries:2000,rows:2000,columns:100,sheets:64,page:100,text:2*MiB,images:80,pdf:64*MiB,image:32*MiB,pixels:16000000};
const imageMime={PNG:'image/png',JPEG:'image/jpeg',GIF:'image/gif',BMP:'image/bmp',WEBP:'image/webp',WebP:'image/webp'};
const spreadsheet=new Set(['xlsx','xls','xlsm','xlsb','ods','csv','tsv']);
const textExt=new Set(['txt','log','md','json','xml','html','htm','svg','ini','cfg','conf','yaml','yml','sql','py','js','c','h','cpp','css','srt','ass','bat','ps1','sh']);
const mediaMime={mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',m4a:'audio/mp4',aac:'audio/aac',mp4:'video/mp4',webm:'video/webm',ogv:'video/ogg',mov:'video/quicktime'};
function classify(bytes,name=''){
 const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),ext=name.toLowerCase().split('.').pop(),type=root.HexCore.detect(a);
 if(type==='PDF'||new TextDecoder().decode(a.subarray(0,1024)).includes('%PDF-'))return {kind:'pdf',label:'PDF',mime:'application/pdf'};
 if(imageMime[type])return {kind:'image',label:type,mime:imageMime[type]};
 if(a[0]===0&&a[1]===0&&a[2]===1&&a[3]===0)return {kind:'image',label:'ICO',mime:'image/x-icon'};
 if(a.length>16&&String.fromCharCode(...a.subarray(4,8))==='ftyp'&&/avif|avis/.test(String.fromCharCode(...a.subarray(8,64))))return {kind:'image',label:'AVIF',mime:'image/avif'};
 if(['docx','docm'].includes(ext))return {kind:'docx',label:'Word / DOCX'};
 if(spreadsheet.has(ext))return {kind:'spreadsheet',label:'Excel / 表格'};
 if(type==='ZIP')return {kind:'zip',label:'ZIP / Office 容器'};
 if(mediaMime[ext])return {kind:mediaMime[ext].startsWith('audio')?'audio':'video',mime:mediaMime[ext],label:ext.toUpperCase()};
 if(textExt.has(ext))return {kind:'text',label:ext.toUpperCase()+' 文本'};
 if(a.length){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(a);if(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))return {kind:'text',label:'UTF-8 文本'};}catch{}}
 return {kind:'unsupported',label:'暂无预览',note:ext==='doc'?'旧版 .doc 暂不支持，请转换为 DOCX 后预览。':'此格式暂不支持内容预览，可继续查看十六进制、字符串或提取文件。'};
}
function archiveInfo(bytes){
 const parsed=root.HexCore.parseZip(bytes,0);
 if(!parsed.verified||!Array.isArray(parsed.entries))throw Error('ZIP / Office 容器结构损坏、加密或使用了不支持的 ZIP64。');
 if(parsed.entries.length>LIMITS.entries)throw Error('Office 容器超过 2,000 个条目预览上限。');
 return parsed;
}
function dimensions(a){
 const type=root.HexCore.detect(a),v=new DataView(a.buffer,a.byteOffset,a.byteLength);
 if(type==='PNG'&&a.length>=24)return [v.getUint32(16),v.getUint32(20)];
 if(type==='GIF'&&a.length>=10)return [v.getUint16(6,true),v.getUint16(8,true)];
 if(type==='BMP'&&a.length>=26){if(v.getUint32(14,true)===12)return [v.getUint16(18,true),v.getUint16(20,true)];return [Math.abs(v.getInt32(18,true)),Math.abs(v.getInt32(22,true))];}
 if(type==='JPEG'){let pos=2;while(pos+4<a.length){if(a[pos++]!==255)break;let marker=a[pos++];while(marker===255&&pos<a.length)marker=a[pos++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const size=v.getUint16(pos);if(size<2||pos+size>a.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=7)return [v.getUint16(pos+5),v.getUint16(pos+3)];pos+=size;}}
 return null;
}
async function safeOffice(bytes,parsed=archiveInfo(bytes)){
 if(bytes.length>LIMITS.office)throw Error('Office 预览文件上限 32 MiB。');
 const entries=Object.create(null),used=new Set();let total=0;
 for(const entry of parsed.entries){
  const name=entry.name.replace(/\\/g,'/');
  if(name.startsWith('/')||name.includes('\0')||name.split('/').some(s=>['..','__proto__','constructor','prototype'].includes(s))||used.has(name))throw Error('Office 容器包含不安全或重复路径。');
  used.add(name);if(name.endsWith('/'))continue;
  if(entry.flags&1)throw Error('Office 容器已加密，请先解密后预览。');
  if(entry.size>LIMITS.member||(total+=entry.size)>LIMITS.inflated)throw Error('Office 解压内容超过预览预算（单项 16 MiB / 合计 48 MiB）。');
  // Validate actual stream length and CRC before passing anything to a converter.
  const data=await root.HexCore.inflateEntry(bytes.subarray(entry.dataStart,entry.dataEnd),entry,LIMITS.member);
  if(/\.(xml|rels)$/i.test(name)){
   const encoding=data[0]===255&&data[1]===254||data[0]===60&&data[1]===0?'utf-16le':data[0]===254&&data[1]===255||data[0]===0&&data[1]===60?'utf-16be':'utf-8';
   if(/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder(encoding).decode(data)))throw Error('Office XML 含 DTD / 实体定义，未进行预览。');
  }
  entries[name]=[data,{level:0}];
 }
 // A fresh STORE-only archive has validated sizes and cannot expand inside a library.
 return {bytes:root.fflate.zipSync(entries),names:Object.keys(entries),decodedBytes:total};
}
async function word(bytes){
 let images=0,omitted=0;
 const result=await root.mammoth.convertToHtml({arrayBuffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},{
  externalFileAccess:false,includeEmbeddedStyleMap:false,idPrefix:'hexpreview-',
  convertImage:root.mammoth.images.imgElement(async image=>{
   const a=new Uint8Array(await image.readAsArrayBuffer()),kind=classify(a,'');
   const size=dimensions(a);
   if(++images>LIMITS.images||a.length>8*MiB||kind.kind!=='image'||size&&size[0]*size[1]>LIMITS.pixels){omitted++;return {src:'',alt:'[未显示的内嵌图片]'};}
   let encoded='';for(let i=0;i<a.length;i+=8192)encoded+=String.fromCharCode(...a.subarray(i,i+8192));
   return {src:'data:'+kind.mime+';base64,'+root.btoa(encoded)};
  })
 });
 if(result.value.length>12*MiB)throw Error('DOCX 预览内容超过 12 MiB 上限。');
 return {kind:'docx',html:result.value,messages:result.messages.slice(0,30).map(x=>String(x.message)),omittedImages:omitted,note:'正文重排预览，含表格、列表和内嵌图片；分页、浮动布局、文本框和部分样式可能与 Word 不同。'};
}
function readBook(bytes,name){
 let input=bytes,type='array';
 if(/\.(csv|tsv)$/i.test(name)&&!['ZIP','OLE'].includes(root.HexCore.detect(bytes))){
  let encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  try{input=new TextDecoder(encoding,{fatal:encoding==='utf-8'}).decode(bytes);}catch{input=new TextDecoder('gb18030').decode(bytes);}type='string';
 }
 const book=root.XLSX.read(input,{type,dense:true,sheetRows:LIMITS.rows,cellFormula:true,cellText:true,cellHTML:false,cellStyles:true,bookVBA:false,bookDeps:false,raw:false});
 if(!book.SheetNames?.length)throw Error('未发现可读取的工作表。');
 return book;
}
function columnName(index){return root.XLSX.utils.encode_col(index);}
function tablePage(book,{sheet=0,page=0,query=''}={}){
 const sheets=book.SheetNames.slice(0,LIMITS.sheets).map((name,i)=>({name,hidden:book.Workbook?.Sheets?.[i]?.Hidden||0}));
 if(!Number.isInteger(sheet)||sheet<0||sheet>=sheets.length)throw Error('工作表编号无效。');
 const ws=book.Sheets[sheets[sheet].name],range=root.XLSX.utils.decode_range(ws['!ref']||'A1'),full=root.XLSX.utils.decode_range(ws['!fullref']||ws['!ref']||'A1');
 const endRow=Math.min(range.e.r,LIMITS.rows-1),endColumn=Math.min(range.e.c,LIMITS.columns-1),startRow=Math.min(range.s.r,endRow),startColumn=Math.min(range.s.c,endColumn);
 const needle=String(query).slice(0,200).toLocaleLowerCase(),rows=[];const dense=ws['!data']||ws;
 function cell(r,c){const value=Array.isArray(dense)?dense[r]?.[c]:ws[root.XLSX.utils.encode_cell({r,c})];const display=value?.f&&value.v==null&&!value.w?'='+value.f:value?.w??value?.v??'';return value?{text:String(display).slice(0,4096),formula:value.f?String(value.f).slice(0,4096):'',type:value.t||'',hidden:!!ws['!cols']?.[c]?.hidden}:{text:'',formula:'',type:'',hidden:!!ws['!cols']?.[c]?.hidden};}
 for(let r=startRow;r<=endRow;r++){
  const cells=[];for(let c=startColumn;c<=endColumn;c++)cells.push(cell(r,c));
  if(!needle||cells.some(x=>x.text.toLocaleLowerCase().includes(needle)||x.formula.toLocaleLowerCase().includes(needle)))rows.push({number:r+1,hidden:!!ws['!rows']?.[r]?.hidden,cells});
 }
 const pages=Math.max(1,Math.ceil(rows.length/LIMITS.page));page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
 return {kind:'spreadsheet',sheets,sheet,page,pages,matchedRows:rows.length,rows:rows.slice(page*LIMITS.page,(page+1)*LIMITS.page),
  columns:Array.from({length:Math.max(0,endColumn-startColumn+1)},(_,i)=>columnName(i+startColumn)),totalRows:full.e.r+1,totalColumns:full.e.c+1,
  limited:full.e.r>=LIMITS.rows||full.e.c>=LIMITS.columns||book.SheetNames.length>LIMITS.sheets,
  note:'只读显示缓存值和公式文本，不执行公式、宏或外部链接。每表最多预览前 2,000 行、100 列，最多 64 张表；搜索限已载入范围。'};
}
function text(bytes,encoding='auto'){
 let chosen=encoding;if(chosen==='auto')chosen=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
 // Streaming decode holds an incomplete final code point at the preview boundary.
 const truncated=bytes.length>LIMITS.text,part=bytes.subarray(0,LIMITS.text);
 let content;try{content=new TextDecoder(chosen,{fatal:chosen==='utf-8'}).decode(part,{stream:truncated});}catch{if(encoding!=='auto')throw Error('不能以所选编码读取文本。');chosen='gb18030';content=new TextDecoder(chosen).decode(part,{stream:truncated});}
 return {kind:'text',text:content,encoding:chosen,truncated:bytes.length>LIMITS.text};
}
const api={LIMITS,classify,dimensions,archiveInfo,safeOffice,word,readBook,tablePage,text};root.HexPreviewCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
