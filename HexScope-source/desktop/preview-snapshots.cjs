'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto'),{readPreview,MAX_READ}=require('./preview-read.cjs');
// Files extracted from an image have no OS-backed browser File. Keep their
// original bytes in a private, app-owned session directory, addressed by tokens.
class PreviewSnapshots{
  constructor(parent=process.env.HEXSCOPE_TEST_TMP||os.tmpdir()){
    this.parent=path.resolve(parent);this.directory=null;this.records=new Map();this.closed=false;
  }
  filename(id){
    if(!this.directory||!/^[0-9a-f-]{36}$/.test(id))throw Error('无效的镜像预览编号。');
    const filename=path.resolve(this.directory,id+'.bin');
    if(path.dirname(filename)!==this.directory)throw Error('无效的镜像预览位置。');return filename;
  }
  async save(result){
    if(this.closed)throw Error('镜像预览会话已关闭。');
    const bytes=result.bytes;if(!ArrayBuffer.isView(bytes)||bytes.byteLength>MAX_READ)throw Error('镜像提取字节无效或超过 128 MiB。');
    if(!this.directory){fs.mkdirSync(this.parent,{recursive:true});this.directory=fs.mkdtempSync(path.join(this.parent,'HexScope-preview-'));}
    const id=randomUUID(),filename=this.filename(id),record={path:filename,size:bytes.byteLength};
    this.records.set(id,record);
    try{
      await fsp.writeFile(filename,bytes,{flag:'wx',mode:0o600});
      if(this.closed||!this.records.has(id))throw Error('镜像预览会话已关闭。');
      const stat=await fsp.stat(filename,{bigint:true});
      record.lastModified=Number(stat.mtimeNs/1000000n);record.sha256=createHash('sha256').update(bytes).digest('hex');
      return {id,size:record.size,sha256:record.sha256};
    }catch(error){this.release([id]);throw Error(error.code==='ENOSPC'?'临时磁盘空间不足，无法保留镜像预览副本。':error.message||'镜像预览副本创建失败。');}
  }
  async read({snapshotId,offset,length},options){
    const record=this.records.get(snapshotId);if(!record||record.lastModified===undefined)throw Error('镜像预览副本已释放或尚未就绪，请重新推送该文件。');
    const bytes=await readPreview({...record,offset,length},options);
    if(offset===0&&length===record.size&&createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('镜像预览副本校验不一致，请重新推送该文件。');
    return bytes;
  }
  release(ids){
    for(const id of ids){if(!this.records.has(id))continue;const filename=this.filename(id);
      // Delete only files registered by this store, never paths from a request.
      try{fs.unlinkSync(filename);}catch(error){if(error.code!=='ENOENT')continue;}
      this.records.delete(id);
    }
    if(this.directory&&!this.records.size){try{fs.rmdirSync(this.directory);this.directory=null;}catch{}}
  }
  dispose(){this.closed=true;this.release([...this.records.keys()]);}
}
module.exports={PreviewSnapshots};
