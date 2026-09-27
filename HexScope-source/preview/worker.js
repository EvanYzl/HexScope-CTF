'use strict';
let workbook=null;
self.onmessage=async({data})=>{
 const {id,action}=data;
 try{
  if(action==='sheet'){
   if(!workbook)throw Error('请先载入工作簿。');self.postMessage({id,ok:true,result:self.HexPreviewCore.tablePage(workbook,data)});return;
  }
  const a=new Uint8Array(data.bytes),P=self.HexPreviewCore;let kind=data.kind||P.classify(a,data.name).kind,info;
  if(a[0]===0x50&&a[1]===0x4b){
   info=P.archiveInfo(a);const names=new Set(info.entries.map(x=>x.name));
   if(names.has('word/document.xml'))kind='docx';else if(names.has('xl/workbook.xml')||names.has('xl/workbook.bin')||names.has('content.xml')&&names.has('mimetype'))kind='spreadsheet';
   if(kind==='zip'){self.postMessage({id,ok:true,result:{kind:'archive',entries:info.entries.map(x=>({name:x.name,size:x.size,packed:x.packed,encrypted:!!(x.flags&1)}))}});return;}
  }
  if(kind==='docx'||kind==='spreadsheet'){
   if(a.length>P.LIMITS.office)throw Error('Office 预览文件上限 32 MiB。');
   const validated=info?await P.safeOffice(a,info):{bytes:a};
   if(kind==='docx'){
    if(!info)throw Error('这不是可读取的 DOCX ZIP 容器，可能是加密文件或旧版 Word。');
    self.postMessage({id,ok:true,result:await P.word(validated.bytes)});
   }else{workbook=P.readBook(validated.bytes,data.name);self.postMessage({id,ok:true,result:P.tablePage(workbook)});}
  }else if(kind==='text')self.postMessage({id,ok:true,result:P.text(a,data.encoding)});
  else throw Error('此格式暂无后台预览。');
 }catch(error){self.postMessage({id,ok:false,error:String(error.message||error)});}
};
