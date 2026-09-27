(function () {
  'use strict';
  const C=window.HexCore,$=id=>document.getElementById(id),MiB=1024*1024;
  const state={items:[],selected:null,tab:'overview',offset:0,running:false,scanJobs:new Set(),scanCursor:0,generation:0,exporting:false,next:1,closedDirs:new Set(),page:0};
  $('creatorAvatar').src=document.querySelector('link[rel="icon"]').href;
  const workerURL=URL.createObjectURL(new Blob(['coreCode','exifCode','flateCode','ctfCode','stegoCode','audioCode','animationCode','workerCode'].map(id=>$(id).textContent+'\n'),{type:'text/javascript'}));
  const cpuCount=Math.max(1,Math.floor(Number(navigator.hardwareConcurrency)||4));
  const performanceSettings={cpuCount,scanThreads:cpuCount,scanMemory:Math.max(256*MiB,Math.min(1024*MiB,(Number(navigator.deviceMemory)||4)*256*MiB))};
  let scanPool=new window.HexScanPool(()=>new Worker(workerURL)),pumpScan=null,refreshTimer=null,detailDirty=false;
  function flushQueueUI(){clearTimeout(refreshTimer);refreshTimer=null;renderList();if(detailDirty){detailDirty=false;renderDetail();}}
  function scheduleQueueUI(detail=false){detailDirty=detailDirty||detail;if(!refreshTimer)refreshTimer=setTimeout(flushQueueUI,150);}
  const labels={clean:'未见结构异常',suspect:'发现附加 / 可疑数据',mismatch:'后缀与格式不匹配',damaged:'结构损坏 / 不完整',limited:'检测范围受限'};
  const badgeClass={clean:'good',suspect:'warn',mismatch:'error',damaged:'error',limited:'info'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const size=n=>n<1024?n+' B':n<MiB?(n/1024).toFixed(1)+' KiB':(n/MiB).toFixed(2)+' MiB';
  const selected=()=>state.items.find(x=>x.id===state.selected);
  let toastTimer,hexToken=0;
  function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
  function job(payload,timeout=90000) {
    const worker=new Worker(workerURL);let timer,rejectJob;
    const promise=new Promise((resolve,reject)=>{
      rejectJob=reject;timer=setTimeout(()=>{worker.terminate();reject(new Error('处理超时，已停止当前文件。可导出原始区间或使用桌面工具继续分析。'));},timeout);
      worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.ok?resolve(data):reject(new Error(data.error));};
      worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message||'分析线程无法启动，请用新版 Edge / Chrome 打开此文件。'));};
      worker.postMessage(payload);
    });
    return {promise,cancel:()=>{clearTimeout(timer);worker.terminate();rejectJob(new Error('已停止扫描。'));}};
  }
  function download(data,name,type='application/octet-stream') {
    const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));
    const a=document.createElement('a');a.href=url;a.download=C.safeName(name);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function collectExports() {
    const out=[];
    for(const item of state.items)if(item.result)for(const index of item.chosen) {
      const f=item.result.findings[index];if(f)out.push({item,index,f});
    }
    return out;
  }
  function updateStats() {
    const done=state.items.filter(x=>x.result),r=done.map(x=>x.result);
    $('statTotal').textContent=String(done.length).padStart(2,'0');
    $('statSuspect').textContent=String(r.filter(x=>x.status==='suspect').length).padStart(2,'0');
    $('statMismatch').textContent=String(r.filter(x=>x.matches===false).length).padStart(2,'0');
    $('statExtract').textContent=String(r.reduce((n,x)=>n+x.findings.filter(f=>f.level==='verified').length,0)).padStart(2,'0');
    $('fileCount').textContent=state.items.length;
    const exports=collectExports();$('exportCount').textContent=exports.length+' 个文件待导出'+(exports.length?' · '+size(exports.reduce((n,x)=>n+x.f.size,0)):'');
    $('exportBtn').disabled=!exports.length||state.exporting;
    $('exportBtn').textContent=state.exporting?'正在准备导出…':'一键导出检出文件 ↓';
    $('clearBtn').disabled=!state.items.length||state.exporting;$('reportBtn').disabled=!state.items.length;
    $('queueStatus').textContent=state.items.length?done.length+' / '+state.items.length+' 已分析':'所有分析均在本地进行';
  }
  function renderList() {
    const needle=$('searchInput').value.trim().toLowerCase(),filter=$('filterSelect').value;
    const unit=Number($('sizeUnit').value),min=$('minSize').value===''?0:Number($('minSize').value)*unit,max=$('maxSize').value===''?Infinity:Number($('maxSize').value)*unit;
    const valid=Number.isFinite(min)&&!Number.isNaN(max)&&min>=0&&max>=min;
    const rows=state.items.filter(x=>((x.path||x.file.name).toLowerCase().includes(needle))&&(filter==='all'||(filter==='mismatch'?x.result?.matches===false:x.result?.status===filter))&&(!valid||(x.file.size>=min&&x.file.size<=max)));
    const sort=$('sortSelect').value;if(sort==='sizeAsc')rows.sort((a,b)=>a.file.size-b.file.size);else if(sort==='sizeDesc')rows.sort((a,b)=>b.file.size-a.file.size);else if(sort==='name')rows.sort((a,b)=>a.path.localeCompare(b.path));
    $('sizeFilterHint').textContent=valid?rows.length+' 个可见 · '+size(rows.reduce((n,x)=>n+x.file.size,0))+' · 目录显示筛选后合计':'范围无效，请检查最小/最大值（当前未应用大小条件）。';
    const sized=$('minSize').value!==''||$('maxSize').value!=='';
    $('queueOptions').classList.toggle('has-filter',sized||sort!=='original'||$('listMode').value!=='tree');
    $('queueOptionsLabel').textContent=sized?(valid?'大小筛选已应用':'大小范围无效'):'大小与排序';
    const pages=Math.max(1,Math.ceil(rows.length/200));state.page=Math.min(state.page,pages-1);
    $('queuePaging').hidden=rows.length<=200;$('queuePrev').disabled=state.page===0;$('queueNext').disabled=state.page+1>=pages;
    $('queuePage').max=String(pages);$('queuePage').value=String(state.page+1);$('queuePages').textContent='/ '+pages;
    const visible=rows.slice(state.page*200,state.page*200+200);
    if(!state.items.length) {
      $('fileList').innerHTML='<div class="empty-list"><span class="empty-symbol">⌁</span><h3>等待第一批文件</h3><p>拖入文件或载入演示，<br>这里将列出逐个检测结果。</p></div>';
    } else if(!rows.length)$('fileList').innerHTML='<div class="empty-list"><p>没有符合条件的文件</p></div>';
    else {
      const renderRow=x=>{
      const r=x.result;let tag;
      if(r)tag='<span class="tag '+badgeClass[r.status]+'">'+labels[r.status]+'</span>'+(r.matches===false&&r.status!=='mismatch'?'<span class="tag error">后缀不匹配</span>':'');
      else tag='<span class="tag '+(x.status==='error'?'error':'')+'">'+esc(({queued:'等待扫描',scanning:'扫描中…',cancelled:'已停止',error:'无法分析'})[x.status])+'</span>';
      return '<button class="file-row '+(x.id===state.selected?'selected':'')+'" data-id="'+x.id+'" title="'+esc(x.path)+' · '+x.file.size.toLocaleString()+' 字节" aria-label="查看 '+esc(x.file.name)+'" aria-pressed="'+(x.id===state.selected)+'"><span class="file-icon">'+esc(r?.type||'FILE')+'</span><span class="file-content"><strong>'+esc(x.file.name)+'</strong><span class="file-sub"><span>'+size(x.file.size)+'</span><span>'+esc(r?.type||'待识别')+'</span></span>'+tag+'</span></button>';
      };
      if($('listMode').value==='list')$('fileList').innerHTML=visible.map(renderRow).join('');
      else {
        const tree={dirs:new Map(),files:[],size:0,count:0};
        const totals=new Map();for(const item of rows){let path='';for(const name of item.path.split('/').filter(x=>x&&x!=='.'&&x!=='..').slice(0,-1)){path+=(path?'/':'')+name;const total=totals.get(path)||{size:0,count:0};total.size+=item.file.size;total.count++;totals.set(path,total);}}
        for(const item of visible){let node=tree,path='';const parts=item.path.split('/').filter(x=>x&&x!=='.'&&x!=='..');for(const name of parts.slice(0,-1)){path+=(path?'/':'')+name;if(!node.dirs.has(name))node.dirs.set(name,{dirs:new Map(),files:[],...totals.get(path),path});node=node.dirs.get(name);}node.files.push(item);}
        const renderTree=node=>Array.from(node.dirs,([name,child])=>'<details class="tree-directory" data-path="'+esc(child.path)+'" '+(state.closedDirs.has(child.path)?'':'open')+'><summary><span>'+esc(name)+'</span><small>'+child.count+' 项 · '+size(child.size)+'</small></summary><div class="tree-children">'+renderTree(child)+'</div></details>').join('')+node.files.map(renderRow).join('');
        $('fileList').innerHTML=renderTree(tree);
      }
    }
    updateStats();
  }
  function resetDetail() {$('detail').hidden=true;$('detailEmpty').hidden=false;hexToken++;window.dispatchEvent(new CustomEvent('hexscope-tab',{detail:{name:state.tab,id:null}}));}
  function selectItem(id) {state.selected=id;state.offset=0;$('rangeStart').value='';$('rangeEnd').value='';renderList();renderDetail();}
  function renderDetail() {
    const item=selected();if(!item){resetDetail();return;}
    $('detailEmpty').hidden=true;$('detail').hidden=false;
    $('detailName').textContent=item.file.name;$('detailName').title=item.file.name;$('detailType').textContent='FILE INSPECTOR / '+(item.result?.type||'UNKNOWN');
    $('detailMeta').textContent=item.file.size.toLocaleString()+' 字节 · '+size(item.file.size)+' · '+(item.path||item.file.name)+(item.result?.dimensions?' · '+item.result.dimensions.width+' × '+item.result.dimensions.height:'');
    $('detailMeta').title=$('detailMeta').textContent;
    $('correctBtn').hidden=item.result?.matches!==false;
    $('findingCount').textContent=item.result?.findings.length||0;
    if(!item.result) {
      $('overviewPanel').innerHTML='<div class="verdict"><strong>'+esc(item.status==='scanning'?'正在分析文件…':item.status==='queued'?'等待扫描':item.error||'扫描已停止')+'</strong><p>当前文件尚无检测结论。</p></div>'+(['cancelled','error'].includes(item.status)?'<button id="retryBtn" class="secondary">重新扫描未完成文件</button>':'');
      const retry=$('retryBtn');if(retry)retry.onclick=()=>{for(const x of state.items)if(['cancelled','error'].includes(x.status)){x.status='queued';x.error=null;}state.scanCursor=0;runQueue();};
      $('findings').textContent='扫描完成后显示候选文件。';$('tailExport').textContent='';
    } else {renderOverview(item);renderFindings(item);}
    showTab(state.tab);
  }
  function renderOverview(item) {
    const r=item.result,match=r.matches===null?'无法判断':r.matches?'匹配':'不匹配';
    const desc=r.status==='clean'?'在支持的容器结构和签名检查范围内未见异常。':r.status==='mismatch'?'文件签名与扩展名不同，可导出正确后缀的副本。':r.status==='suspect'?'发现额外数据或候选文件，点击「提取文件」检查证据。':r.status==='damaged'?'无法可靠确定主文件边界，请检查结构或查看原始字节。':'此格式或结构未能完成全部检查，请结合原始字节判断。';
    const ratio=r.end===null?100:(r.end/Math.max(1,r.size)*100);
    const mismatchClass=r.matches===false?'red':'';
    $('overviewPanel').innerHTML='<div class="verdict '+(r.status==='suspect'?'warn':['mismatch','damaged'].includes(r.status)?'error':'')+'"><strong>'+labels[r.status]+'</strong><p>'+desc+'</p></div>'+
      '<div class="overview-grid">'+[
        ['实际格式',r.type||'未知','mono'],['扩展名检查',(r.extension?'.'+r.extension:'无扩展名')+' / '+match,mismatchClass],['结构终点',r.end===null?'未确定':C.hex(r.end),'mono'],
        ['文件大小',size(r.size),'mono'],['尾部附加数据',r.tail?size(r.tail.size):r.end===null?'未确定':'无',r.tail?'amber':''],['候选文件',r.findings.length+' 个','mono']
      ].map(([k,v,cl])=>'<div><div class="info-label">'+esc(k)+'</div><div class="info-value '+cl+'">'+esc(v)+'</div></div>').join('')+'</div>'+
      '<div class="subhead">文件结构分布 <small>BYTE MAP</small></div><div class="map">'+(r.end===null?'<div class="map-unknown"></div>':'<div class="map-body" style="width:'+ratio+'%" title="主容器"></div>'+(r.tail?'<div class="map-tail" style="width:'+(100-ratio)+'%" title="附加数据"></div>':''))+'</div><div class="map-labels"><span>0x00000000</span><span>'+C.hex(r.size)+'</span></div>'+
      '<div class="subhead">字节熵分布 <small>0—8 BIT · '+r.entropy.toFixed(2)+' AVG*</small></div><div class="entropy" aria-label="字节熵分布图">'+r.bins.map(h=>'<i class="'+(h>7.5?'high':'')+'" style="height:'+Math.max(4,h/8*100)+'%" title="'+h.toFixed(2)+' bit"></i>').join('')+'</div><p class="muted" style="margin-top:8px">高熵也常见于正常压缩数据，不作为隐写证据。* 均值取前 '+size(r.entropySample)+'。</p>'+
      (r.notes.length?'<ul class="notes">'+r.notes.map(n=>'<li>'+esc(n)+'</li>').join(''):'')+
      (r.regions.length?'<details class="manual"><summary>查看容器结构（'+r.regions.length+' 段，最多显示 512 段）</summary><div class="entry-list">'+r.regions.map(x=>'<div class="entry"><span>'+esc(x.label)+'</span><small>'+C.hex(x.start)+' → '+C.hex(x.end)+'</small></div>').join('')+'</div></details>':'')+
      '<div class="hash">SHA-256 · '+esc(r.sha256||'当前浏览器未提供 SHA-256')+'</div>';
  }
  function renderFindings(item) {
    const r=item.result;
    $('findings').innerHTML=r.findings.length?r.findings.map((f,i)=>{
      const title=f.level==='verified'?'结构通过':f.level==='embedded'?'元数据 / 内嵌':'仅签名';
      const archive=f.entries?'<details class="manual"><summary>ZIP 成员（'+f.entryCount+' 项）</summary><div class="entry-list">'+f.entries.map(e=>'<div class="entry"><span>'+esc(e.name)+(e.flags&1?' [加密]':'')+'</span><small>'+size(e.size)+'</small></div>').join('')+(f.entryCount>500?'<p>仅显示前 500 项。</p>':'')+'</div></details>':'';
      return '<article class="candidate"><div class="candidate-head"><label class="candidate-title"><input type="checkbox" data-choice="'+i+'" aria-label="选择候选 '+(i+1)+'" '+(item.chosen.has(i)?'checked':'')+'>'+esc(f.type)+' <span class="muted">#'+String(i+1).padStart(2,'0')+'</span></label><span class="tag '+(f.level==='verified'?'good':f.level==='embedded'?'info':'warn')+'">'+title+'</span></div><p>'+esc(f.evidence)+'</p><div class="offsets">'+C.hex(f.start)+' → '+C.hex(f.end)+' · '+size(f.size)+'</div>'+(f.absoluteOffsets?'<p>导出副本将重定位 ZIP 偏移，原文件保持不变。</p>':'')+'<div class="candidate-actions"><button class="secondary" data-carve="'+i+'">'+(f.exportable?'导出 '+esc(f.type):'导出候选 .bin')+' ↓</button><button class="secondary" data-locate="'+i+'">在十六进制中定位</button>'+(f.entries?'<button class="secondary" data-unzip="'+i+'" '+(state.exporting?'disabled':'')+'>解压全部成员 ↓</button>':'')+'</div>'+archive+'</article>';
    }).join(''):'<div class="empty-list"><h3>未发现可识别的候选文件</h3><p>这不能排除 LSB、加密数据或不受支持的文件格式。</p></div>';
    $('tailExport').innerHTML=r.tail?'<div class="raw-tail"><strong>原始尾部附加数据 · '+size(r.tail.size)+'</strong><p>从容器终点 '+C.hex(r.tail.start)+' 起的全部数据；可能与上方候选重叠。适合保留未识别的数据。</p><button id="rawTailBtn" class="secondary">导出完整尾部 .bin ↓</button></div>':'';
    if($('rawTailBtn'))$('rawTailBtn').onclick=()=>download(item.file.slice(r.tail.start),item.file.name+'_tail.bin');
  }
  function showTab(name) {
    state.tab=name;
    for(const btn of document.querySelectorAll('[data-tab]')){btn.classList.toggle('active',btn.dataset.tab===name);btn.setAttribute('aria-selected',String(btn.dataset.tab===name));}
    for(const id of ['overview','preview','hex','extract','exif','strings','pixels','lab'])$(id+'Panel').hidden=id!==name;
    if(name==='hex')renderHex();
    window.dispatchEvent(new CustomEvent('hexscope-tab',{detail:{name,id:state.selected}}));
  }
  async function renderHex() {
    const item=selected();if(!item)return;
    const token=++hexToken,offset=Math.max(0,Math.min(Math.floor(state.offset/16)*16,Math.max(0,Math.ceil(item.file.size/16)*16-16)));
    state.offset=offset;
    try {
      const data=new Uint8Array(await item.file.slice(offset,offset+256).arrayBuffer());if(token!==hexToken)return;
      const lines=[];
      for(let i=0;i<data.length;i+=16) {
        let bytes='',ascii='';
        for(let j=0;j<16;j++) {
          if(i+j>=data.length){bytes+='   ';ascii+=' ';continue;}
          const b=data[i+j],extra=item.result?.tail&&offset+i+j>=item.result.tail.start;
          const val=b.toString(16).toUpperCase().padStart(2,'0');bytes+=(extra?'<span class="hx-tail">'+val+'</span>':val)+' ';
          ascii+=esc(b>=32&&b<127?String.fromCharCode(b):'.');
        }
        lines.push('<span class="hx-address">'+(offset+i).toString(16).toUpperCase().padStart(8,'0')+'</span>  '+bytes+' <span class="hx-ascii">'+ascii+'</span>');
      }
      $('hexView').innerHTML=lines.join('\n')||'空文件，没有字节。';
      $('hexRange').textContent=C.hex(offset)+' — '+C.hex(offset+data.length)+' / '+size(item.file.size);
      $('offsetInput').value=C.hex(offset);$('prevHex').disabled=offset===0;$('nextHex').disabled=offset+256>=item.file.size;
      $('boundaryBtn').disabled=item.result?.end===null||item.result?.end===undefined;
      $('rangeStart').placeholder=C.hex(offset);$('rangeEnd').placeholder=C.hex(item.file.size);
    } catch(error) {if(token===hexToken)$('hexView').textContent='读取失败：'+error.message;}
  }
  function runQueue() {
    if(state.running){pumpScan?.();return;}
    state.running=true;const generation=state.generation;let activeBytes=0;
    $('progressArea').hidden=false;
    pumpScan=()=>{
      if(generation!==state.generation)return;
      while(state.scanJobs.size<performanceSettings.scanThreads&&state.scanCursor<state.items.length){
        const item=state.items[state.scanCursor];
        if(item.status!=='queued'){state.scanCursor++;continue;}
        const weight=Math.min(item.file.size,C.MAX_FILE)*3+8*MiB;
        // Backpressure controls working buffers, never the number of queued files.
        if(state.scanJobs.size&&activeBytes+weight>performanceSettings.scanMemory)break;
        state.scanCursor++;item.status='scanning';activeBytes+=weight;
        const task=scanPool.run({kind:'analyze',file:item.file});state.scanJobs.add(task);
        scheduleQueueUI(item.id===state.selected);
        task.promise.then(response=>{
          if(generation!==state.generation)return;
          item.result=response.result;item.status='done';item.error=null;
          item.chosen=new Set(item.result.findings.map((f,i)=>f.level==='verified'?i:-1).filter(i=>i>=0));
        },error=>{if(generation===state.generation){item.status='error';item.error=error.message;}}).finally(()=>{
          if(generation!==state.generation)return;
          state.scanJobs.delete(task);activeBytes-=weight;scanPool.trim(performanceSettings.scanThreads);
          scheduleQueueUI(item.id===state.selected);pumpScan();
        });
      }
      $('progressText').textContent='并行扫描 · '+state.scanJobs.size+' / '+performanceSettings.scanThreads+' 个分析线程';
      $('progressBar').max=state.items.length;$('progressBar').value=state.scanCursor-state.scanJobs.size;
      if(!state.scanJobs.size&&state.scanCursor>=state.items.length){state.running=false;pumpScan=null;$('progressArea').hidden=true;flushQueueUI();}
    };
    pumpScan();
  }
  function stopScan() {
    state.generation++;for(const task of state.scanJobs)task.cancel();state.scanJobs.clear();scanPool.close();scanPool=new window.HexScanPool(()=>new Worker(workerURL));pumpScan=null;state.scanCursor=0;state.running=false;
    for(const x of state.items)if(['queued','scanning'].includes(x.status)){x.status='cancelled';x.error='已停止扫描。';}
    $('progressArea').hidden=true;detailDirty=true;flushQueueUI();
  }
  function addFiles(files) {
    let added=0;const wasEmpty=!state.items.length;
    for(const file of files){state.items.push({id:state.next++,file,path:(file.webkitRelativePath||file._hexPath||file.name).replace(/\\/g,'/'),status:'queued',result:null,chosen:new Set()});added++;}
    if(!state.selected&&added)state.selected=state.items[0].id;
    if(wasEmpty){detailDirty=true;flushQueueUI();}else scheduleQueueUI();
    if(added)runQueue();return added;
  }
  async function readDrop(transfer) {
    const fallback=Array.from(transfer.files),entries=Array.from(transfer.items||[]).map(x=>x.webkitGetAsEntry?.()).filter(Boolean);
    if(!entries.length){addFiles(fallback);return;}
    let files=[];
    function flush(){if(files.length){addFiles(files);files=[];}}
    async function visit(entry,parent='') {
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));Object.defineProperty(file,'_hexPath',{value:parent+file.name,configurable:true});files.push(file);}
      else if(entry.isDirectory) {
        const reader=entry.createReader();let batch;
        do{batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));for(const e of batch)await visit(e,parent+(entry.name?entry.name+'/':''));}while(batch.length);
      }
      if(files.length>=256){flush();await new Promise(resolve=>setTimeout(resolve,0));}
    }
    try{for(const entry of entries)await visit(entry);flush();}
    catch(error){flush();toast('部分拖入项读取失败：'+error.message);}
  }
  function parseOffset(value) {const s=value.trim();if(!/^(?:0x[0-9a-f]+|\d+)$/i.test(s))return NaN;const n=Number(s);return Number.isSafeInteger(n)?n:NaN;}
  async function exportCandidate(item,index) {
    const f=item.result.findings[index];
    try {
      let blob;
      if(f.absoluteOffsets)blob=C.carve(new Uint8Array(await item.file.arrayBuffer()),f);
      else blob=item.file.slice(f.start,f.end);
      download(blob,item.file.name+'_offset_'+f.start.toString(16)+'.'+(f.exportable?f.extension:'bin'));
      toast('已发起候选文件下载。');
    }catch(error){toast(error.message);}
  }
  async function exportAll() {
    const exports=collectExports();if(!exports.length)return;
    if(exports.reduce((n,x)=>n+x.f.size,0)>256*MiB){toast('本次导出超过 256 MiB，请减少勾选数量。');return;}
    state.exporting=true;updateStats();
    try {
      const used=new Set(),items=exports.map(({item,index,f})=>({file:item.file,finding:f,sha256:item.result.sha256,
        name:C.uniqueName(item.file.name+'__'+(index+1)+'_'+f.start.toString(16)+'.'+(f.exportable?f.extension:'bin'),used)}));
      const response=await job({kind:'export',items},120000).promise;
      download(response.data,'HexScope_extracted_'+new Date().toISOString().slice(0,10)+'.zip','application/zip');toast('已发起下载：'+response.count+' 个候选文件和检测清单。');
    }catch(error){toast('导出失败：'+error.message);}
    finally{state.exporting=false;updateStats();}
  }
  async function unzip(item,index) {
    if(state.exporting)return;
    state.exporting=true;updateStats();renderFindings(item);toast('正在解压并检查成员 CRC…');
    try {
      const response=await job({kind:'unzip',file:item.file,finding:item.result.findings[index]},120000).promise;
      download(response.data,item.file.name+'_members.zip','application/zip');toast('已发起下载：'+response.count+' 个解压后的成员（以 ZIP 打包）。');
    }catch(error){toast('解压失败：'+error.message);}
    finally{state.exporting=false;updateStats();if(selected()?.id===item.id)renderFindings(item);}
  }
  function report() {
    const data={tool:'HexScope CTF 4.1',createdAt:new Date().toISOString(),scope:'批量文件结构扫描；EXIF、字符串、LSB 及专项隐写需在对应标签页单独运行。未运行的模块不表示未检出。',files:state.items.map(x=>x.result?{...x.result,relativePath:x.path,metadata:x.metadata||null,lsbScan:x.lsbScan||null,stegoReports:x.stegoReports||null}:{name:x.file.name,relativePath:x.path,size:x.file.size,status:x.status,error:x.error||null})};
    download(JSON.stringify(data,null,2),'HexScope_report.json','application/json');
  }
  function demoPNG() {
    const chunk=(name,bytes)=>{const t=C.enc.encode(name),head=new Uint8Array(4),tail=new Uint8Array(4);new DataView(head.buffer).setUint32(0,bytes.length);new DataView(tail.buffer).setUint32(0,C.crc32(C.cat([t,bytes])));return C.cat([head,t,bytes,tail]);};
    const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);v.setUint32(0,16);v.setUint32(4,16);ihdr[8]=8;ihdr[9]=2;
    const raw=new Uint8Array(16*49);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=y*49+1+x*3;raw[i]=22+x*5;raw[i+1]=90+y*4;raw[i+2]=67+x*3;}
    let s1=1,s2=0;for(const b of raw){s1=(s1+b)%65521;s2=(s2+s1)%65521;}
    const zhead=new Uint8Array([120,1,1,raw.length&255,raw.length>>8,(~raw.length)&255,((~raw.length)>>8)&255]),adler=new Uint8Array(4);new DataView(adler.buffer).setUint32(0,s2*65536+s1);
    return C.cat([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',C.cat([zhead,raw,adler])),chunk('IEND',new Uint8Array())]);
  }
  function loadDemo() {
    const png=demoPNG(),zip=C.makeZip([{name:'隐藏说明.txt',data:C.enc.encode('这是 HexScope 的演示数据。此 ZIP 被附加在 PNG 的 IEND 之后。\n原始内容：Hello, HexScope!\n')},{name:'notes.json',data:C.enc.encode('{"demo":true,"hidden":"appended ZIP"}')}]);
    addFiles([new File([png],'01_正常图片.png'),new File([png,zip],'02_图片尾部附加ZIP.png'),new File([png],'03_后缀伪装.jpg'),new File([png,C.enc.encode('Sample trailing bytes. Unknown payload, not proof of steganography.')],'04_未知尾部数据.png')]);
    $('demoBtn').disabled=true;toast('已加入 4 个本地生成的演示文件。');
  }
  $('addBtn').onclick=()=>$('fileInput').click();$('folderBtn').onclick=()=>$('folderInput').click();
  for(const id of ['fileInput','folderInput'])$(id).onchange=e=>{addFiles(e.target.files);e.target.value='';};
  document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();$('dropzone').classList.add('dragging');}});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('dropzone').classList.remove('dragging');});
  document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragging');if(e.dataTransfer)readDrop(e.dataTransfer);});
  $('dropzone').addEventListener('click',e=>{if(e.target.closest('button,input'))return;$('fileInput').click();});
  $('fileList').onclick=e=>{const row=e.target.closest('[data-id]');if(row)selectItem(Number(row.dataset.id));};
  const filterChanged=()=>{state.page=0;renderList();};
  $('searchInput').oninput=filterChanged;$('filterSelect').onchange=filterChanged;
  for(const id of ['minSize','maxSize'])$(id).oninput=filterChanged;
  for(const id of ['sizeUnit','sortSelect','listMode'])$(id).onchange=filterChanged;
  $('resetSize').onclick=()=>{$('minSize').value='';$('maxSize').value='';filterChanged();};
  $('queuePrev').onclick=()=>{state.page=Math.max(0,state.page-1);renderList();$('fileList').scrollTop=0;};
  $('queueNext').onclick=()=>{state.page++;renderList();$('fileList').scrollTop=0;};
  $('queuePage').onchange=()=>{const value=Number($('queuePage').value);state.page=Number.isSafeInteger(value)?Math.max(0,value-1):0;renderList();$('fileList').scrollTop=0;};
  $('scanThreads').max=String(cpuCount);$('scanThreads').value=String(cpuCount);$('scanThreadHint').textContent='检测到 '+cpuCount+' 个逻辑处理器';
  function changeThreads(value){performanceSettings.scanThreads=Math.max(1,Math.min(cpuCount,Math.floor(Number(value)||cpuCount)));$('scanThreads').value=String(performanceSettings.scanThreads);scanPool.trim(performanceSettings.scanThreads);pumpScan?.();}
  $('scanThreads').onchange=()=>changeThreads($('scanThreads').value);$('scanFullSpeed').onclick=()=>changeThreads(cpuCount);
  $('fileList').addEventListener('toggle',e=>{if(e.target.dataset.path!==undefined){const path=e.target.dataset.path;e.target.open?state.closedDirs.delete(path):state.closedDirs.add(path);}},true);
  $('cancelBtn').onclick=()=>{stopScan();toast('已停止。已完成的结果保留，未完成项可以重新扫描。');};
  $('clearBtn').onclick=()=>{stopScan();state.items=[];state.selected=null;state.offset=0;state.page=0;state.closedDirs.clear();$('demoBtn').disabled=false;renderList();resetDetail();};
  for(const btn of document.querySelectorAll('[data-tab]'))btn.onclick=()=>showTab(btn.dataset.tab);
  $('headBtn').onclick=()=>{state.offset=0;renderHex();};$('tailBtn').onclick=()=>{state.offset=Math.max(0,Math.ceil((selected()?.file.size||0)/16)*16-256);renderHex();};
  $('boundaryBtn').onclick=()=>{state.offset=Math.max(0,(selected()?.result?.end||0)-32);renderHex();};
  $('prevHex').onclick=()=>{state.offset-=256;renderHex();};$('nextHex').onclick=()=>{state.offset+=256;renderHex();};
  $('jumpBtn').onclick=()=>{const n=parseOffset($('offsetInput').value),max=selected()?.file.size||0;if(!Number.isFinite(n)||n>=max){toast('请输入文件内的偏移，例如 256 或 0x100。');return;}state.offset=n;renderHex();};
  $('offsetInput').onkeydown=e=>{if(e.key==='Enter')$('jumpBtn').click();};
  $('rangeBtn').onclick=()=>{const item=selected();if(!item)return;const start=parseOffset($('rangeStart').value),end=parseOffset($('rangeEnd').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>item.file.size){toast('区间无效：需要 0 ≤ 开始 < 结束 ≤ 文件大小，结束位置不包含在内。');return;}download(item.file.slice(start,end),item.file.name+'_'+start.toString(16)+'-'+end.toString(16)+'.bin');};
  $('findings').onchange=e=>{if(e.target.dataset.choice!==undefined){const item=selected(),i=Number(e.target.dataset.choice);e.target.checked?item.chosen.add(i):item.chosen.delete(i);updateStats();}};
  $('findings').onclick=e=>{const btn=e.target.closest('button'),item=selected();if(!btn||!item?.result)return;if(btn.dataset.carve!==undefined)exportCandidate(item,Number(btn.dataset.carve));if(btn.dataset.locate!==undefined){state.offset=item.result.findings[Number(btn.dataset.locate)].start;showTab('hex');}if(btn.dataset.unzip!==undefined)unzip(item,Number(btn.dataset.unzip));};
  $('correctBtn').onclick=()=>{const item=selected();if(!item?.result?.suggested)return;const name=item.file.name.replace(/\.[^.]+$/,'')+'.'+item.result.suggested;download(item.file,name);toast('已发起正确后缀副本下载，内容逐字节保留。');};
  $('exportBtn').onclick=exportAll;$('reportBtn').onclick=report;$('demoBtn').onclick=loadDemo;
  $('helpBtn').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
  $('helpDialog').onclick=e=>{if(e.target===$('helpDialog')){const r=$('helpDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('helpDialog').close();}};
  updateStats();
  function showWorkspace(name) {
    const pane=$(name+'Workspace'),button=$(name==='inspection'?'inspectMode':name+'Mode');
    if(!pane||!button)throw Error('Unknown workspace: '+name);
    for(const item of document.querySelectorAll('main [id$="Workspace"]'))item.hidden=item!==pane;
    for(const item of document.querySelectorAll('.mode-nav button.mode')){item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));}
    window.dispatchEvent(new CustomEvent('hexscope-workspace',{detail:{name}}));
  }
  window.addEventListener('pagehide',()=>{state.generation++;clearTimeout(refreshTimer);scanPool.close();});
  window.HexApp={state,$,C,esc,size,selected,job,download,toast,addFiles,showTab,showWorkspace,renderList,renderDetail,performanceSettings};
})();
