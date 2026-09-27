'use strict';
// Only fixed, bundled TSK tools are executable. Images are opened read-only.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {spawn}=require('node:child_process');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {capabilities,parseImageHashes,snapshot,sameFile,hashStream}=require('./hashing.cjs');
const TOOLS=new Set(['img_stat','img_cat','mmls','fls','icat','fsstat','istat']);
const MAX_ANALYZE=128*1024*1024,MAX_ENTRIES=200000;
function integer(value,name,max=Number.MAX_SAFE_INTEGER){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw Error(name+'无效');return n;}
function safeName(value){let s=String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,120);if(!s||/^\.{1,2}$/.test(s))s='unnamed';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))s='_'+s;return s;}
function safeRelative(value){const parts=String(value).replace(/\\/g,'/').split('/').filter(Boolean);if(parts.length>64||parts.some(x=>x==='..'||x==='.')||/^[A-Za-z]:/.test(value))throw Error('镜像中的路径不适合导出：'+value);return parts.map(safeName).join(path.sep)||'unnamed';}
function contained(root,relative){const result=path.resolve(root,relative),rel=path.relative(root,result);if(!rel||rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))throw Error('导出路径越界');return result;}
function parsePartitions(text){
  const unit=/Units are in (\d+)-byte sectors/i.exec(text);const sectorSize=unit?Number(unit[1]):512;
  const partitions=[];
  for(const line of text.split(/\r?\n/)){const m=/^\s*(\d+):\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);if(!m||!/^\d+:\d+$/.test(m[2]))continue;const start=Number(m[3]),length=Number(m[5]);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length))continue;partitions.push({slot:m[2],offset:start,length,sectorSize,description:m[6].trim()});}
  return {sectorSize,partitions};
}
function parseBody(text,base='/'){
  const entries=[];let skipped=0;
  for(const line of text.split(/\r?\n/)){
    if(!line.trim())continue;
    const fields=line.split('|');if(fields.length<11){skipped++;continue;}
    const tail=fields.slice(-9),[inode,mode,uid,gid,bytes,accessed,modified,changed,created]=tail;
    if(!/^\d+(?:-\d+){0,2}$/.test(inode)||!Number.isSafeInteger(Number(bytes))||Number(bytes)<0){skipped++;continue;}
    let name=fields.slice(1,-9).join('|');const deleted=/ \(deleted(?:-realloc)?\)$/.test(name);
    name=name.replace(/ \(deleted(?:-realloc)?\)$/,'').replace(/^\//,'');
    const relative=name;const fullPath=(base.replace(/\/$/,'')+'/'+name).replace(/^\/*/,'/');
    const leaf=fullPath.split('/').pop();if(!leaf||leaf==='.'||leaf==='..')continue;
    entries.push({inode,mode,uid,gid,size:Number(bytes),accessed:Number(accessed),modified:Number(modified),changed:Number(changed),created:Number(created),deleted,directory:/^[dV]/.test(mode),virtual:/^[vV]/.test(mode)||leaf.startsWith('$'),name:leaf,path:fullPath,relative});
  }
  return {entries,skipped};
}
async function ewfSegments(filename,firstHead){
  if(firstHead[3]!==9||firstHead.subarray(0,3).toString()!=='EVF')return [];
  const folder=path.dirname(filename),stem=path.basename(filename,path.extname(filename)).toLowerCase();
  const candidates=(await fsp.readdir(folder)).filter(name=>path.basename(name,path.extname(name)).toLowerCase()===stem&&/^\.[e-z][0-9a-z]{2}$/i.test(path.extname(name)));
  if(candidates.length>65535)throw Error('镜像分卷数量异常。');
  const segments=[];
  for(const name of candidates){
    const full=path.join(folder,name),stat=await fsp.stat(full);if(!stat.isFile())continue;
    const handle=await fsp.open(full,'r'),head=Buffer.alloc(13),tail=Buffer.alloc(76);
    try{await handle.read(head,0,13,0);if(head.subarray(0,4).toString('hex')!=='45564609')continue;if(stat.size<89)throw Error('E01 分卷过短：'+name);await handle.read(tail,0,76,stat.size-76);}finally{await handle.close();}
    const last=tail.subarray(0,16).toString('ascii').replace(/\0.*$/s,'');
    segments.push({filename:full,name,...snapshot(stat),number:head.readUInt16LE(9),last});
  }
  segments.sort((a,b)=>a.number-b.number);
  if(!segments.length)throw Error('E01 分卷命名无法识别，请保留 .E01、.E02 等原始文件名。');
  for(let i=0;i<segments.length;i++){const part=segments[i];if(part.number!==i+1)throw Error('E01 分卷不连续：缺少或重复第 '+(i+1)+' 卷。请将完整分卷放在同一目录。');if(part.last!==(i===segments.length-1?'done':'next'))throw Error('E01 分卷缺失、截断或结束标记异常：'+part.name+'。请检查是否包含全部分卷。');}
  return segments;
}
class Forensics {
  constructor(engineDir){this.engineDir=path.resolve(engineDir);this.child=null;this.children=new Set();this.busy=false;this.cancelled=false;this.current=null;this.hashFileSource=null;this.entryMap=new Map();this.engineStatus=null;}
  cancel(){this.cancelled=true;for(const child of this.children)child.kill();}
  dispose(){this.cancel();this.current=null;this.hashFileSource=null;this.entryMap.clear();}
  async task(fn){if(this.busy)throw Error('镜像任务仍在运行，请等待或点击停止。');this.busy=true;this.cancelled=false;try{return await fn();}finally{this.busy=false;this.child=null;}}
  check(){if(this.cancelled)throw Error('镜像任务已停止。');}
  run(tool,args,{maxBytes=16*1024*1024,timeout=120000,idleTimeout=0,onChunk}={}){
    this.check();if(!TOOLS.has(tool))throw Error('不允许调用此工具');
    const executable=path.join(this.engineDir,tool+'.exe');
    if(!fs.existsSync(executable))throw Error('缺少镜像组件 '+tool+'.exe，请解压完整便携包。');
    return new Promise((resolve,reject)=>{
      const child=spawn(executable,args.map(String),{cwd:this.engineDir,windowsHide:true,shell:false,env:{...process.env,TZ:'UTC',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});
      this.child=child;this.children.add(child);let size=0,stderr='',buffers=[],fault=null;
      const timer=timeout>0?setTimeout(()=>{fault=Error('镜像操作超时，可缩小目录范围后重试。');child.kill();},timeout):null;
      let idle=null;const touch=()=>{if(!idleTimeout)return;clearTimeout(idle);idle=setTimeout(()=>{fault=Error('镜像组件连续 5 分钟没有返回数据，任务已停止，未生成完整结果。');child.kill();},idleTimeout);};touch();
      child.stdout.on('data',chunk=>{if(fault||this.cancelled)return;touch();size+=chunk.length;if(size>maxBytes){fault=Error('输出超过限制，请缩小目录范围或改为逐目录浏览。');child.kill();return;}try{if(onChunk)onChunk(chunk);else buffers.push(chunk);}catch(e){fault=e;child.kill();}});
      child.stderr.on('data',chunk=>{if(stderr.length<16000)stderr+=chunk.toString('utf8');});
      child.on('error',error=>{fault=Error('无法启动镜像组件：'+error.message);});
      child.on('close',code=>{clearTimeout(timer);clearTimeout(idle);this.children.delete(child);if(this.child===child)this.child=null;if(this.cancelled)return reject(Error('镜像任务已停止。'));if(fault)return reject(fault);if(code!==0)return reject(Error((stderr.trim()||('组件退出码 '+code)).slice(0,6000)));resolve({data:Buffer.concat(buffers),stderr,size});});
    });
  }
  async status(){
    if(this.engineStatus)return this.engineStatus;
    const version=await this.run('img_stat',['-V']);
    // TSK intentionally returns a non-zero status when listing supported types.
    let formats='';try{const result=await this.run('img_stat',['-i','list']);formats=result.data.toString()+result.stderr;}catch(e){formats=e.message;}
    if(!/ewf/i.test(formats))throw Error('此 TSK 构建未启用 libewf，不能读取 E01。');
    let manifest={};try{manifest=JSON.parse(await fsp.readFile(path.join(this.engineDir,'../ENGINE_INFO.json'),'utf8'));}catch{}
    return this.engineStatus={version:(version.data.toString()+version.stderr).trim(),formats,libewf:manifest.libewf||'内置（EWF 支持已确认）',analysisLimits:this.analysisLimits()};
  }
  async open(filename){
    await this.status();this.check();
    if(typeof filename!=='string'||!path.isAbsolute(filename))throw Error('请选择磁盘上的镜像文件。');
    if(/\.e(?:0[2-9]|[1-9]\d)$/i.test(filename))throw Error('请选择首个 .E01 文件，并把所有分卷放在同一目录。');
    const real=await fsp.realpath(filename),stat=await fsp.stat(real);if(!stat.isFile())throw Error('请选择普通镜像文件。');
    const fh=await fsp.open(real,'r');const head=Buffer.alloc(8);try{await fh.read(head,0,8,0);}finally{await fh.close();}
    const imageType=/^(EVF|LVF)/.test(head.toString('ascii'))||/\.(e01|ex01)$/i.test(real)?'ewf':null;
    let segments=imageType==='ewf'?await ewfSegments(real,head):[];
    const imageArgs=imageType?['-i',imageType]:[];
    const info=await this.run('img_stat',[...imageArgs,real]);const infoText=info.data.toString('utf8');
    if(/^Image Type:\s*raw\s*$/mi.test(infoText)&&infoText.includes('Split Information:')){
      segments=[];for(const line of infoText.split('Split Information:')[1].split(/\r?\n/)){
        const match=/^(.*?)  \((\d+) to (\d+)\)$/.exec(line);if(!match)continue;
        if(!path.isAbsolute(match[1]))throw Error('无法识别 RAW 分卷的完整路径。');
        const partStat=await fsp.stat(match[1]);if(!partStat.isFile())throw Error('RAW 分卷不是普通文件。');
        segments.push({filename:match[1],name:path.basename(match[1]),...snapshot(partStat)});
      }if(segments.length<2)throw Error('RAW 分卷列表解析失败。');
    }
    let layout='',layoutError='';try{layout=(await this.run('mmls',[...imageArgs,real])).data.toString('utf8');}catch(e){this.check();layoutError=e.message;}
    const parsed=parsePartitions(layout);if(!layout){const sector=/Sector size:\s*(\d+)/.exec(infoText);if(sector)parsed.sectorSize=Number(sector[1]);}
    if(!parsed.partitions.length)parsed.partitions.push({slot:'whole',offset:0,length:0,sectorSize:parsed.sectorSize,description:'完整镜像 / 无分区表（偏移 0）'});
    const image={id:randomUUID(),filename:real,imageType,name:path.basename(real),sourceBytes:stat.size,sourceStat:snapshot(stat),containerBytes:segments.length?segments.reduce((n,p)=>n+p.size,0):stat.size,segmentCount:segments.length||1,segments,mtimeMs:stat.mtimeMs,info:infoText,layout,layoutError,...parseImageHashes(infoText),...parsed};
    this.current=image;this.entryMap.clear();return this.publicImage();
  }
  publicImage(){const {filename,mtimeMs,segments,sourceBytes,sourceStat,...info}=this.current;return info;}
  image(id){if(!this.current||id!==this.current.id)throw Error('镜像已关闭或被替换，请重新选择。');return this.current;}
  async unchanged(){const parts=this.current.segments.length?this.current.segments:[{filename:this.current.filename,...this.current.sourceStat}];for(const part of parts){this.check();const stat=await fsp.stat(part.filename);if(!sameFile(stat,part))throw Error('源镜像已发生变化，请关闭并重新打开。');}}
  hashCapabilities(){return capabilities();}
  async selectHashFile(filename){
    this.check();if(typeof filename!=='string'||!path.isAbsolute(filename))throw Error('请选择本机文件。');
    const real=await fsp.realpath(filename),stat=await fsp.stat(real);
    if(!stat.isFile()||!Number.isSafeInteger(stat.size))throw Error('请选择大小可识别的普通文件。');
    this.hashFileSource={id:randomUUID(),filename:real,name:path.basename(real),...snapshot(stat)};
    return {id:this.hashFileSource.id,name:path.basename(real),size:stat.size};
  }
  async hashFile(args,notify){
    const source=this.hashFileSource;if(!source||source.id!==args.fileId)throw Error('文件已更换，请重新选择。');
    const handle=await fsp.open(source.filename,'r');
    const verify=async()=>{if(!sameFile(await handle.stat(),source)||!sameFile(await fsp.stat(source.filename),source))throw Error('文件在选择或计算后发生变化，请重新选择。');};
    try{return await hashStream({algorithms:args.algorithms,total:source.size,source:{kind:'file',name:source.name,scope:'本机单个文件的全部字节（包含文件头、元数据与文件尾）'},check:()=>this.check(),notify,verify,read:async onChunk=>{
      const buffer=Buffer.alloc(1024*1024);let position=0;
      while(true){this.check();const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;onChunk(buffer.subarray(0,bytesRead));position+=bytesRead;}
    }});}finally{await handle.close();}
  }
  async streamImage(imageId,onChunk){
    const image=this.image(imageId);await this.unchanged();
    if(!Number.isSafeInteger(image.mediaBytes)||image.mediaBytes<0)throw Error('镜像组件未报告有效的完整数据长度。');
    // img_cat defaults to byte zero through img->size. Never pass a partition offset or sector range.
    const result=await this.run('img_cat',[...(image.imageType?['-i',image.imageType]:[]),image.filename],{maxBytes:image.mediaBytes,timeout:0,idleTimeout:300000,onChunk});
    this.check();if(result.size!==image.mediaBytes)throw Error('镜像读取未完成（'+result.size+' / '+image.mediaBytes+' 字节）。');await this.unchanged();return result;
  }
  async hashImage(args,notify){
    const image=this.image(args.imageId);
    return hashStream({algorithms:args.algorithms,total:image.mediaBytes,source:{kind:'image',name:image.name,scope:'解码后的完整采集数据流，从字节 0 到末尾；不采用当前分区偏移或目录筛选',imageType:image.imageType||'auto',segmentCount:image.segmentCount,containerBytes:image.containerBytes,sectorSize:image.sectorSize,storedHashNote:'采集哈希仅列出 img_stat 报告的值（当前 EWF 组件只报告 MD5）。未显示不代表容器内不存在其他采集哈希。'},storedHashes:image.storedHashes,read:onChunk=>this.streamImage(image.id,onChunk),verify:()=>this.unchanged(),check:()=>this.check(),notify});
  }
  async hashEntry(args,notify){
    const entry=this.entry(args.entryId);if(entry.directory)throw Error('请选择单个文件。');
    return hashStream({algorithms:args.algorithms,total:entry.size,source:{kind:'entry',name:entry.name,image:this.current.name,path:entry.path,inode:entry.inode,partitionOffset:entry.offset,sectorSize:entry.sectorSize,deleted:entry.deleted,scope:'镜像内指定文件或命名数据流的内容；不包括空闲空间、文件松弛区或其他数据流'},read:onChunk=>this.read(entry,onChunk,{timeout:0,idleTimeout:300000}),verify:()=>this.unchanged(),check:()=>this.check(),notify});
  }
  context(args){const image=this.image(args.imageId),sectorSize=integer(args.sectorSize||image.sectorSize,'扇区大小',65536);if(![512,1024,2048,4096,8192].includes(sectorSize))throw Error('不支持此扇区大小');const offset=integer(args.offset,'分区偏移');return {image,offset,sectorSize};}
  fsArgs(context){return [...(this.current?.imageType?['-i',this.current.imageType]:[]),'-b',String(context.sectorSize),'-o',String(context.offset)];}
  register(entries,context){
    if(entries.length+this.entryMap.size>MAX_ENTRIES)throw Error('目录索引超过 200,000 条，请重新打开镜像并缩小扫描范围。');
    return entries.map(entry=>{const item={...entry,id:randomUUID(),imageId:context.image.id,offset:context.offset,sectorSize:context.sectorSize};this.entryMap.set(item.id,item);return item;});
  }
  entry(id){const entry=this.entryMap.get(id);if(!entry||entry.imageId!==this.current?.id)throw Error('所选文件条目已经失效。');return entry;}
  async list(args){
    const context=this.context(args);await this.unchanged();let inode=null,base='/';
    if(args.directoryId){const directory=this.entry(args.directoryId);if(!directory.directory||directory.offset!==context.offset||directory.sectorSize!==context.sectorSize)throw Error('目录与当前分区不匹配');inode=directory.inode;base=directory.path;}
    const argv=[...this.fsArgs(context),'-m','/',...(args.recursive?['-r']:[]),context.image.filename,...(inode?[inode]:[])];
    const result=await this.run('fls',argv,{maxBytes:64*1024*1024,timeout:300000});const parsed=parseBody(result.data.toString('utf8'),base);
    return {entries:this.register(parsed.entries,context),skipped:parsed.skipped,warning:result.stderr,recursive:!!args.recursive,base};
  }
  async details(args){
    const context=this.context(args);await this.unchanged();
    let tool='fsstat',argv=[...this.fsArgs(context),context.image.filename];
    if(args.entryId){const entry=this.entry(args.entryId);if(entry.offset!==context.offset||entry.sectorSize!==context.sectorSize)throw Error('条目与分区不匹配');tool='istat';argv.push(entry.inode);}
    return (await this.run(tool,argv,{maxBytes:4*1024*1024})).data.toString('utf8');
  }
  async read(entry,onChunk,options={}){
    this.image(entry.imageId);await this.unchanged();
    if(entry.directory)throw Error('请选择文件');if(entry.mode.startsWith('l'))throw Error('符号链接仅显示元数据，不跟随或导出。');
    const context={offset:entry.offset,sectorSize:entry.sectorSize};
    const result=await this.run('icat',[...this.fsArgs(context),...(entry.deleted?['-r']:[]),this.current.filename,entry.inode],{maxBytes:entry.size,timeout:1800000,...options,onChunk});
    if(result.size!==entry.size)throw Error('提取字节数与目录记录不一致，可能已损坏或被覆盖（'+result.size+' / '+entry.size+'）。');
    await this.unchanged();return result;
  }
  async analyze(args){const entry=this.entry(args.entryId);if(entry.size>MAX_ANALYZE)throw Error('隐写分析单文件上限为 128 MiB；大文件可直接导出。');const result=await this.read(entry);return {name:entry.name,path:this.current.name+entry.path,bytes:result.data,deleted:entry.deleted};}
  analysisLimits(){return {threads:Math.max(1,os.availableParallelism?.()||os.cpus().length),batchBytes:256*1024*1024};}
  async analyzeBatch(args){
    const limits=this.analysisLimits(),threads=integer(args.threads??limits.threads,'提取并发',limits.threads);
    if(!threads||!Array.isArray(args.entryIds)||!args.entryIds.length||args.entryIds.length>threads)throw Error('无效的并发提取批次。');
    const entries=args.entryIds.map(id=>this.entry(id));
    if(entries.some(row=>row.size>MAX_ANALYZE)||entries.reduce((n,row)=>n+row.size,0)>limits.batchBytes)throw Error('并发读取的数据过大，请分批提取。');
    // All children belong to this one exclusive service task. Cancellation
    // kills every reader and the task stays locked until every child settles.
    const results=await Promise.all(entries.map(async row=>{
      try{this.check();return {entryId:row.id,ok:true,...await this.analyze({entryId:row.id})};}
      catch(error){return {entryId:row.id,ok:false,error:error.message};}
    }));
    return {results,cancelled:this.cancelled};
  }
  async planAnalysis(args){
    this.image(args.imageId);if(!Array.isArray(args.entryIds)||!args.entryIds.length||args.entryIds.length>MAX_ENTRIES)throw Error('当前没有可以送入分析的文件或目录。');
    const seen=new Set(),entries=[],skipped=[];let bytes=0;
    const add=item=>{const key=item.offset+':'+item.inode+':'+item.path;if(seen.has(key)||item.directory)return;seen.add(key);let reason='';if(item.mode.startsWith('l'))reason='符号链接不跟随';else if(item.size>MAX_ANALYZE)reason='单文件超过 128 MiB';if(reason)skipped.push({path:item.path,size:item.size,reason});else{entries.push(item);bytes+=item.size;}};
    for(const id of args.entryIds){this.check();const item=this.entry(id);if(item.directory){try{const nested=await this.list({imageId:item.imageId,offset:item.offset,sectorSize:item.sectorSize,directoryId:item.id,recursive:true});for(const child of nested.entries)add(child);if(nested.skipped)skipped.push({path:item.path,reason:nested.skipped+' 条目录记录无法解析'});}catch(error){this.check();skipped.push({path:item.path,reason:error.message});}}else add(item);}
    return {entries,skipped,bytes,limits:this.analysisLimits(),note:'文件队列不限制条目数量；按并发数和活动数据量自动分批。目录递归不会自动进入已删除目录；已删除目录需要单独选择。'};
  }
  async exportFiles(args,destination,notify=()=>{}){
    this.image(args.imageId);if(!Array.isArray(args.entryIds)||!args.entryIds.length||args.entryIds.length>MAX_ENTRIES)throw Error('请选择需要导出的文件或目录。');
    const files=[],seen=new Set();
    for(const id of args.entryIds){this.check();const entry=this.entry(id);let list=[entry];if(entry.directory){const nested=await this.list({imageId:entry.imageId,offset:entry.offset,sectorSize:entry.sectorSize,directoryId:id,recursive:true});if(nested.skipped)throw Error('目录存在无法解析的记录，请单独导出可识别文件。');list=nested.entries.filter(x=>!x.directory);}
      for(const item of list){const key=item.offset+':'+item.inode+':'+item.path;if(!seen.has(key)){seen.add(key);files.push(item);}}
    }
    if(!files.length)throw Error('没有可导出的文件。');
    const exportRoot=await fsp.mkdtemp(path.join(destination,'HexScope-export-'));
    const manifest={source:this.current.name,imageInfo:this.current.info,segmentCount:this.current.segmentCount,created:new Date().toISOString(),files:[],errors:[],cancelled:false,notes:'只读提取；不跟随符号链接。已删除内容可能被覆盖，目录递归不自动遍历已删除目录。时间数值来自 TSK（进程 TZ=UTC），零值可能表示缺失，不代表文件实际创建于 1970 年。'};
    let done=0,total=0;
    try{
      for(const entry of files){this.check();let fd,temporary;
        try{
          const relative=path.join('partition-'+entry.offset, safeRelative(entry.path));
          // Preserve every entry (ADS / deleted duplicate names included), never overwrite.
          const parsed=path.parse(relative),unique=path.join(parsed.dir,safeName(parsed.name)+'__'+safeName(entry.inode)+'_'+entry.id.slice(0,8)+parsed.ext);
          const dest=contained(exportRoot,unique);await fsp.mkdir(path.dirname(dest),{recursive:true});temporary=dest+'.part';fd=fs.openSync(temporary,'wx');
          const hash=createHash('sha256');let written=0;
          await this.read(entry,chunk=>{let offset=0;while(offset<chunk.length)offset+=fs.writeSync(fd,chunk,offset,chunk.length-offset);hash.update(chunk);written+=chunk.length;notify({phase:'export',done,total:files.length,name:entry.name,bytes:total+written});});
          fs.closeSync(fd);fd=null;await fsp.rename(temporary,dest);temporary=null;
          total+=written;manifest.files.push({sourcePath:entry.path,inode:entry.inode,partitionOffset:entry.offset,sectorSize:entry.sectorSize,deleted:entry.deleted,size:written,sha256:hash.digest('hex'),timestamps:{accessed:entry.accessed,modified:entry.modified,changed:entry.changed,created:entry.created},exportPath:unique});
        }catch(error){manifest.errors.push({sourcePath:entry.path,inode:entry.inode,error:error.message});if(this.cancelled)throw error;}
        finally{if(fd!==undefined&&fd!==null)fs.closeSync(fd);if(temporary)await fsp.unlink(temporary).catch(()=>{});}
        done++;notify({phase:'export',done,total:files.length,bytes:total});
      }
    }catch(error){if(this.cancelled)manifest.cancelled=true;else manifest.errors.push({error:error.message});}
    finally{await fsp.writeFile(path.join(exportRoot,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');}
    return {directory:exportRoot,count:manifest.files.length,errors:manifest.errors,cancelled:manifest.cancelled,bytes:total};
  }
}
module.exports={Forensics,parsePartitions,parseBody,safeRelative,safeName,contained,MAX_ANALYZE};
