'use strict';
self.onmessage = async ({data:job}) => {
  const C=self.HexCore;
  try {
    if(job.file?.size>C.MAX_FILE)throw new Error('超过单文件 128 MiB 上限，未处理。');
    if(job.kind==='stego') {
      if(job.secondFile?.size>C.MAX_FILE)throw new Error('参考图片超过 128 MiB 上限。');
      const S=self.Stego,A=self.AudioStego,o=job.options||{};
      const textModes=['textAudit','textBits','base64Padding','textCandidates'];
      let a=null,input=o.text;
      if(textModes.includes(job.mode)) {
        if(job.file.size>8*1024*1024)throw new Error('文本隐写文件最多 8 MiB（解码后最多 4 Mi 字符）。');
        if(!['utf-8','utf-16le','utf-16be'].includes(o.encoding||'utf-8'))throw new Error('不支持此文本编码。');
        input=new TextDecoder(o.encoding||'utf-8',{fatal:true,ignoreBOM:true}).decode(await job.file.arrayBuffer());
      } else a=new Uint8Array(await job.file.arrayBuffer());
      let result;
      if(job.mode==='textAudit')result=S.textAudit(input);
      else if(job.mode==='textBits')result=S.textBits(input,o);
      else if(job.mode==='base64Padding')result=S.base64Padding(input,o);
      else if(job.mode==='textCandidates')result=S.textCandidates(input);
      else if(job.mode==='zipAudit')result=S.zipAudit(a);
      else if(job.mode==='zipRepair')result=S.zipRepair(a);
      else if(job.mode==='pngAudit')result=S.pngAudit(a);
      else if(job.mode==='pngSearch')result=S.pngSearch(a,o);
      else if(job.mode==='pngRepair')result=S.pngRepair(a,o);
      else if(job.mode==='pngChunk')result=S.pngChunk(a,o.index);
      else if(job.mode==='pngPalette')result=S.pngPalette(a,o);
      else if(job.mode==='imageOperation')result=S.imageOperation(a,job.secondFile?new Uint8Array(await job.secondFile.arrayBuffer()):null,o);
      else if(job.mode==='audioAnalyze')result=A.analyze(a,o);
      else if(job.mode==='audioLSB')result=A.lsb(a,o);
      else if(job.mode==='audioTransform')result=A.transform(a,o);
      else if(job.mode==='dtmf')result=A.dtmf(a,o);
      else if(job.mode==='animationInspect')result=self.AnimationStego.inspect(a);
      else if(job.mode==='animationFrame')result=self.AnimationStego.frame(a,o);
      else if(job.mode==='animationExport')result=self.AnimationStego.exportAll(a);
      else throw new Error('未知专项隐写工具。');
      self.postMessage({ok:true,result});return;
    }
    if(job.kind==='metadata') {
      const result=await self.CTF.metadata(new Uint8Array(await job.file.arrayBuffer()),job.type);self.postMessage({ok:true,result});return;
    }
    if(job.kind==='strings') {
      const result=self.CTF.strings(new Uint8Array(await job.file.arrayBuffer()),job.options);self.postMessage({ok:true,result});return;
    }
    if(job.kind==='convert') {
      const result=await self.CTF.convert(job.options);self.postMessage({ok:true,result});return;
    }
    if(job.kind==='pixel') {
      const image=self.CTF.pixels(new Uint8Array(await job.file.arrayBuffer()));
      if(job.mode==='auto'){self.postMessage({ok:true,result:{hits:self.CTF.autoLSB(image),note:image.note}});return;}
      if(job.mode==='lsb'){const data=self.CTF.lsb(image,job.options);self.postMessage({ok:true,result:{data,note:image.note,type:C.detect(data),width:image.width,height:image.height}},[data.buffer]);return;}
      const data=self.CTF.plane(image,job.options);self.postMessage({ok:true,result:{data,width:image.width,height:image.height,note:image.note}},[data.buffer]);return;
    }
    if(job.kind==='analyze') {
      if(job.file.size>C.MAX_FILE)throw new Error('超过单文件 128 MiB 上限，未扫描。');
      const bytes=new Uint8Array(await job.file.arrayBuffer()),result=C.analyze(bytes,job.file.name);
      try {const hash=await crypto.subtle.digest('SHA-256',bytes);result.sha256=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}catch{result.sha256=null;}
      self.postMessage({ok:true,result});
    } else if(job.kind==='export') {
      const files=[],manifest={tool:'HexScope CTF 4.1',createdAt:new Date().toISOString(),items:[]};
      let total=0;
      for(const item of job.items) {
        if((total+=item.finding.size)>256*1024*1024)throw new Error('本次导出超过 256 MiB，请减少勾选数量。');
        const f=item.finding;
        let bytes;
        if(f.absoluteOffsets)bytes=C.carve(new Uint8Array(await item.file.arrayBuffer()),f);
        else bytes=new Uint8Array(await item.file.slice(f.start,f.end).arrayBuffer());
        const name=C.safeName(item.name);files.push({name,data:bytes});
        manifest.items.push({output:name,source:item.file.name,sourceSHA256:item.sha256,format:f.type,start:f.start,endExclusive:f.end,confidence:f.level,evidence:f.evidence,modifiedZipOffsets:!!f.absoluteOffsets});
      }
      files.push({name:'manifest.json',data:C.enc.encode(JSON.stringify(manifest,null,2))});
      const data=C.makeZip(files);self.postMessage({ok:true,data:data.buffer,count:job.items.length},[data.buffer]);
    } else if(job.kind==='unzip') {
      const f=job.finding,a=new Uint8Array(await job.file.arrayBuffer());
      const zip=C.parseZip(a,f.start,f.end);
      if(!zip.verified)throw new Error('ZIP 结构未通过检查。');
      const members=zip.entries.filter(e=>!e.name.endsWith('/'));
      if(members.length>1000)throw new Error('ZIP 超过 1,000 个成员，请导出原压缩包。');
      if(members.reduce((n,e)=>n+e.size,0)>128*1024*1024)throw new Error('ZIP 解压总量超过 128 MiB，请导出原压缩包。');
      const files=[],used=new Set(),manifest=[];
      for(const entry of members) {
        const data=await C.inflateEntry(a.subarray(entry.dataStart,entry.dataEnd),entry);
        const name=C.uniqueName(entry.name,used);files.push({name,data});manifest.push({original:entry.name,exported:name,crc32:C.hex(entry.crc),size:data.length});
      }
      files.push({name:C.uniqueName('_extraction_manifest.json',used),data:C.enc.encode(JSON.stringify(manifest,null,2))});
      const data=C.makeZip(files);self.postMessage({ok:true,data:data.buffer,count:members.length},[data.buffer]);
    }
  } catch(error) {self.postMessage({ok:false,error:error?.message||String(error)});}
};
