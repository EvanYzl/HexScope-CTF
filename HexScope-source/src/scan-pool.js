(function(root){
  'use strict';
  // A worker handles one file at a time and is reused after its reply. Failed,
  // timed-out or cancelled workers are retired so late replies cannot leak.
  class ScanPool {
    constructor(createWorker){this.createWorker=createWorker;this.idle=[];this.active=new Set();this.closed=false;}
    run(payload,timeout=90000){
      let worker,finish,timer,binding,settled=false;
      const promise=new Promise((resolve,reject)=>{
        finish=(error,value,retire=false)=>{
          if(settled)return;settled=true;clearTimeout(timer);binding?.close();
          if(worker){worker.onmessage=null;worker.onerror=null;this.active.delete(handle);if(retire||this.closed)worker.terminate();else this.idle.push(worker);}
          error?reject(error):resolve(value);
        };
        // Start in a microtask so the cancellation handle exists even when a
        // Worker constructor or test transport replies synchronously.
        Promise.resolve().then(()=>{
          if(settled)return;if(this.closed){finish(Error('已停止扫描。'));return;}
          try{
            worker=this.idle.pop()||this.createWorker();this.active.add(handle);
            binding=root.HexFileIO?.bind(worker,payload);
            worker.onmessage=({data})=>{if(!binding?.handle(data))finish(data.ok?null:Error(data.error),data);};
            worker.onerror=e=>finish(Error(e.message||'分析线程无法启动。'),null,true);
            timer=setTimeout(()=>finish(Error('处理超时，当前文件已停止。'),null,true),timeout);
            worker.postMessage(binding?.payload||payload);
          }catch(error){finish(error,null,true);}
        });
      });
      const handle={promise,cancel:()=>finish(Error('已停止扫描。'),null,true)};
      return handle;
    }
    trim(limit){while(this.idle.length+this.active.size>limit&&this.idle.length)this.idle.pop().terminate();}
    close(){this.closed=true;for(const handle of [...this.active])handle.cancel();for(const worker of this.idle)worker.terminate();this.idle=[];}
  }
  if(typeof module==='object'&&module.exports)module.exports=ScanPool;else root.HexScanPool=ScanPool;
})(typeof globalThis==='object'?globalThis:this);
