(function(root){
  'use strict';
  const MAX_READ=128*1024*1024,pending=[];let active=0,serial=0;
  const stopped=()=>Error('文件读取已停止。');
  const size=file=>file._hexSnapshot?.size??file.size;
  function drain(){
    while(active<2&&pending.length){const next=pending.shift();next.signal?.removeEventListener('abort',next.abort);active++;next.resolve(()=>{active--;drain();});}
  }
  function acquire(signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(stopped());return;}
      const entry={signal,resolve,abort(){const i=pending.indexOf(entry);if(i>=0)pending.splice(i,1);reject(stopped());}};
      signal?.addEventListener('abort',entry.abort,{once:true});pending.push(entry);drain();
    });
  }
  async function read(file,start=0,end=size(file),{signal}={}){
    const total=size(file);end=Math.min(total,end);
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>total||end-start>MAX_READ)throw Error('无效的文件读取区间，单次最多读取 128 MiB。');
    const release=await acquire(signal),requestId=++serial,bridge=root.hexscopeFiles;
    const cancel=()=>bridge?.cancelPreview?.(requestId).catch(()=>{});
    signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(signal?.aborted)throw stopped();let data;
      if(file._hexSnapshot){
        if(!bridge?.readSnapshot)throw Error('镜像快照读取接口不可用，请从新版便携程序重新推送该文件。');
        data=await bridge.readSnapshot({snapshotId:file._hexSnapshot.id,offset:start,length:end-start,requestId});
        if(data==null)throw Error('镜像快照没有返回内容，请重新推送该文件。');
      }else if(bridge?.readPreview)data=await bridge.readPreview(file,{offset:start,length:end-start,requestId});
      if(signal?.aborted)throw stopped();
      if(data==null)data=await file.slice(start,end).arrayBuffer();
      if(signal?.aborted)throw stopped();
      const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
      if(bytes.byteLength!==end-start)throw Error('文件读取不完整，请重新选择文件；镜像文件请重新推送。');
      return bytes;
    }catch(error){
      if(['NotReadableError','NotFoundError','SecurityError'].includes(error.name)||/requested file could not be read/i.test(error.message||''))
        throw Error('原文件引用已无法读取。请确认原文件及磁盘仍可用，然后重新选择或拖入；镜像提取文件请重新推送到文件分析。');
      throw error;
    }finally{signal?.removeEventListener('abort',cancel);release();}
  }
  // File properties are lost during structured cloning. Send opaque per-job
  // descriptors to workers and serve their byte requests from the original
  // renderer-side source. Never forward filesystem paths or retain whole files.
  function bind(worker,payload){
    const sources=new Map(),controller=new AbortController();let closed=false;
    function source(file){
      if(!file||(!file._hexSnapshot&&!root.hexscopeFiles?.readPreview))return file;
      const key=String(sources.size);sources.set(key,file);return {name:file.name,size:size(file),_hexReadSource:key};
    }
    const prepared={...payload};
    for(const key of ['file','secondFile'])if(payload[key])prepared[key]=source(payload[key]);
    if(payload.items)prepared.items=payload.items.map(item=>({...item,file:source(item.file)}));
    function handle(message){
      if(message?.kind!=='hexscope-read-source')return false;
      if(closed)return true;
      const file=sources.get(message.source);
      Promise.resolve().then(()=>{
        if(!file||!Number.isSafeInteger(message.id)||message.id<1)throw Error('无效的后台文件读取请求。');
        return read(file,message.start,message.end,{signal:controller.signal});
      }).then(bytes=>{
        if(closed)return;
        const owned=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes:new Uint8Array(bytes);
        worker.postMessage({kind:'hexscope-source-bytes',id:message.id,ok:true,bytes:owned},[owned.buffer]);
      }).catch(error=>{
        if(!closed)worker.postMessage({kind:'hexscope-source-bytes',id:message.id,ok:false,error:(file?file.name+'：':'')+error.message});
      });
      return true;
    }
    return {payload:prepared,handle,close(){closed=true;controller.abort();sources.clear();}};
  }
  root.HexFileIO={read,size,bind};
})(globalThis);
