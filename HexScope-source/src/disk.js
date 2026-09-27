(function(){
  'use strict';
  const H=window.HexApp,{$,esc,size,toast}=H,api=window.hexscopeDisk;
  const S={image:null,offset:0,sectorSize:512,directory:null,rows:[],all:new Map(),lists:new Map(),parents:new Map(),selected:new Set(),page:0,busy:false,externalBusy:false,indexed:false,statusChecked:false,cancelRequested:false};
  let maxThreads=H.performanceSettings.cpuCount,transferThreads=maxThreads,batchBytes=256*1024*1024;
  function transferSettings(limits){
    if(limits){const full=transferThreads===maxThreads;maxThreads=Math.max(1,limits.threads);transferThreads=full?maxThreads:Math.min(transferThreads,maxThreads);batchBytes=limits.batchBytes;}
    $('diskThreads').max=String(maxThreads);$('diskThreads').value=String(transferThreads);$('diskThreadHint').textContent='最多 '+maxThreads+' 路并行读取 · 推送与扫描同时进行';
  }
  transferSettings();
  $('diskThreads').onchange=()=>{transferThreads=Math.max(1,Math.min(maxThreads,Math.floor(Number($('diskThreads').value)||maxThreads)));transferSettings();};
  $('diskFullSpeed').onclick=()=>{transferThreads=maxThreads;transferSettings();};
  function mode(){H.showWorkspace('disk');}
  const status=message=>$('diskStatus').textContent=message;
  function controls(){const locked=S.busy||S.externalBusy||S.mountBusy;for(const element of $('diskWorkspace').querySelectorAll('[data-disk-task]'))element.disabled=!api||locked;for(const id of ['diskClose','diskLoad','diskInfo','diskIndex','diskHashImage','diskPushFiltered'])$(id).disabled=!api||locked||!S.image;for(const id of ['diskAnalyze','diskExport'])$(id).disabled=!api||locked||!S.selected.size;$('diskHashEntry').disabled=!api||locked||S.selected.size!==1||S.all.get([...S.selected][0])?.directory;$('diskCancel').disabled=!S.busy;$('diskSelected').textContent='已选 '+S.selected.size+' 项';window.dispatchEvent(new CustomEvent('hexscope-disk-state',{detail:{image:S.image,busy:S.busy}}));}
  async function busy(fn){if(!api){toast('请使用完整 Windows 便携版打开镜像。');return;}if(S.busy||S.externalBusy||S.mountBusy)return;S.busy=true;S.cancelRequested=false;controls();try{await fn();}catch(error){status('操作未完成：'+error.message);toast(error.message);}finally{S.busy=false;controls();}}
  window.addEventListener('hexscope-mount-busy',e=>{S.mountBusy=e.detail;controls();});
  window.addEventListener('hexscope-hash-busy',e=>{S.externalBusy=e.detail;controls();});
  const context=()=>({imageId:S.image.id,offset:S.offset,sectorSize:S.sectorSize});
  function remember(result,parent){for(const row of result.entries){S.all.set(row.id,row);S.parents.set(row.id,parent?.id||null);}S.lists.set(parent?.id||'root',result.entries);}
  async function loadDirectory(directory=null,recursive=false){
    status(recursive?'正在建立分区目录索引…':'正在读取目录…');
    const result=await api.list({...context(),directoryId:directory?.id,recursive});
    if(!recursive)remember(result,directory);else for(const row of result.entries)S.all.set(row.id,row);
    S.directory=directory;S.rows=result.entries;S.indexed=recursive;S.selected.clear();S.page=0;
    $('diskPath').textContent=recursive?'整个分区 / 递归索引':directory?.path||'/';
    render();renderTree();status('读取 '+result.entries.length+' 项'+(result.skipped?'；'+result.skipped+' 条记录无法解析':'')+(result.warning?'；组件提示：'+result.warning:'')+(recursive?'。递归不自动遍历已删除目录。':'。'));
  }
  function renderTree(){
    let count=0;const draw=(parent,depth)=>{if(depth>32)return '';return (S.lists.get(parent)||[]).filter(x=>x.directory).map(row=>{if(++count>1500)return '';const loaded=S.lists.has(row.id);return '<div class="disk-tree-node" style="padding-left:'+Math.min(depth*12,180)+'px"><button data-disk-task data-disk-dir="'+row.id+'" '+(S.busy?'disabled':'')+' title="'+esc(row.path)+'">'+(loaded?'▾':'▸')+' '+esc(row.name)+(row.deleted?' · 已删除':'')+'</button></div>'+draw(row.id,depth+1);}).join('');};
    $('diskTree').innerHTML='<button class="disk-root" data-disk-root>⌂ 根目录</button>'+draw('root',1)+(count>1500?'<p>目录树显示前 1,500 项，请使用右侧目录浏览。</p>':'');
  }
  function filtered(){
    const needle=$('diskSearch').value.toLowerCase(),unit=Number($('diskUnit').value),min=$('diskMin').value===''?0:Number($('diskMin').value)*unit,max=$('diskMax').value===''?Infinity:Number($('diskMax').value)*unit,deleted=$('diskDeleted').value;
    const invalid=!Number.isFinite(min)||min<0||Number.isNaN(max)||max<0||min>max;
    const rows=invalid?[]:S.rows.filter(row=>row.path.toLowerCase().includes(needle)&&(deleted==='all'||row.deleted===(deleted==='deleted'))&&((row.directory&&min===0&&max===Infinity)||(!row.directory&&row.size>=min&&row.size<=max)));
    const sort=$('diskSort').value;rows.sort((a,b)=>sort==='sizeDown'?b.size-a.size:sort==='sizeUp'?a.size-b.size:Number(b.directory)-Number(a.directory)||a.path.localeCompare(b.path,'zh-CN'));
    $('diskCount').textContent=invalid?'大小区间无效':rows.length+' / '+S.rows.length+' 项';return rows;
  }
  function render(){
    const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/200));S.page=Math.min(S.page,pages-1);const visible=rows.slice(S.page*200,S.page*200+200);
    $('diskRows').innerHTML=visible.map(row=>'<tr class="'+(row.deleted?'disk-deleted':'')+'"><td><input type="checkbox" data-disk-task data-disk-select="'+row.id+'" '+(S.selected.has(row.id)?'checked':'')+' '+(S.busy?'disabled':'')+' aria-label="选择 '+esc(row.name)+'"></td><td><button class="disk-name" '+(row.directory?'data-disk-dir':'data-disk-detail')+'="'+row.id+'">'+(row.directory?'▸ ':'')+esc(S.indexed?row.path:row.name)+'</button><small>'+esc(row.inode)+'</small></td><td title="'+row.size+' 字节">'+(row.directory?'目录':size(row.size))+'</td><td>'+(row.deleted?'已删除':row.name.includes(':')?'数据流':'未删除')+'</td><td><button class="quiet" data-disk-detail="'+row.id+'">详情</button></td></tr>').join('')||'<tr><td colspan="5" class="disk-no-results">没有匹配条目。</td></tr>';
    $('diskPage').textContent=(S.page+1)+' / '+pages;$('diskPrev').disabled=S.page===0;$('diskNext').disabled=S.page+1>=pages;$('diskCheckPage').checked=visible.length>0&&visible.every(x=>S.selected.has(x.id));controls();
  }
  function resetPartition(){S.offset=Number($('diskOffset').value);S.sectorSize=Number($('diskSector').value);if(!Number.isSafeInteger(S.offset)||S.offset<0)throw Error('请输入非负整数起始扇区。');S.all.clear();S.lists.clear();S.parents.clear();S.selected.clear();S.rows=[];S.directory=null;S.indexed=false;$('diskDetails').textContent='';render();renderTree();}
  async function opened(image){if(!image)return;S.image=image;$('diskTransferBox').hidden=true;$('diskContent').hidden=false;$('diskName').textContent=image.name;$('diskSummary').textContent='容器文件 '+size(image.containerBytes)+' · '+(image.segmentCount||1)+' 个分卷 · '+image.partitions.length+' 个分区入口';$('diskImageInfo').textContent=image.info+'\n'+(image.layout||image.layoutError||'未检测到分区表');$('diskPartition').innerHTML=image.partitions.map((part,index)=>'<option value="'+index+'">'+esc(part.description)+' · 起始 '+part.offset+'</option>').join('');const first=image.partitions[0];$('diskOffset').value=first.offset;$('diskSector').value=first.sectorSize;resetPartition();await loadDirectory();}
  $('diskMode').onclick=()=>{mode();if(api&&!S.statusChecked)busy(async()=>{const result=await api.status();S.statusChecked=true;if(result.analysisLimits)transferSettings(result.analysisLimits);$('diskEngine').textContent=result.version+' · libewf '+result.libewf+' · 只读浏览与提取';});};
  $('diskOpen').onclick=()=>busy(async()=>{status('正在打开镜像…');const result=await api.open();if(result)await opened(result);else status(S.image?'已取消打开，保留当前镜像。':'尚未打开镜像。');});
  $('diskClose').onclick=()=>busy(async()=>{await api.close();S.image=null;S.rows=[];S.all.clear();S.lists.clear();S.selected.clear();$('diskContent').hidden=true;status('镜像已关闭。');});
  $('diskCancel').onclick=()=>{S.cancelRequested=true;api?.cancel().catch(error=>toast(error.message));status('正在停止任务…');};
  $('diskPartition').onchange=()=>busy(async()=>{const part=S.image.partitions[Number($('diskPartition').value)];$('diskOffset').value=part.offset;$('diskSector').value=part.sectorSize;resetPartition();await loadDirectory();});
  $('diskLoad').onclick=()=>busy(async()=>{resetPartition();await loadDirectory();});
  $('diskIndex').onclick=()=>busy(()=>loadDirectory(null,true));
  $('diskUp').onclick=()=>busy(()=>loadDirectory(S.all.get(S.parents.get(S.directory?.id))||null));
  $('diskInfo').onclick=()=>busy(async()=>{$('diskDetails').textContent=await api.details(context());$('diskDetailsBox').open=true;status('文件系统详情已读取。');});
  $('diskHashImage').onclick=()=>window.HexHash.useImage(S.image);
  $('diskHashEntry').onclick=()=>window.HexHash.useEntry(S.all.get([...S.selected][0]),S.image);
  function click(e){const dir=e.target.closest('[data-disk-dir]'),detail=e.target.closest('[data-disk-detail]');if(e.target.closest('[data-disk-root]'))busy(()=>loadDirectory());else if(dir)busy(()=>loadDirectory(S.all.get(dir.dataset.diskDir)));else if(detail)busy(async()=>{const row=S.all.get(detail.dataset.diskDetail);$('diskDetails').textContent=await api.details({...context(),entryId:row.id});$('diskDetailsBox').open=true;status('已读取 '+row.path+' 的元数据。');});}
  $('diskTree').onclick=click;$('diskRows').onclick=click;
  $('diskRows').onchange=e=>{const id=e.target.dataset.diskSelect;if(!id)return;e.target.checked?S.selected.add(id):S.selected.delete(id);controls();};
  $('diskCheckPage').onchange=()=>{const rows=filtered().slice(S.page*200,S.page*200+200);for(const row of rows)$('diskCheckPage').checked?S.selected.add(row.id):S.selected.delete(row.id);render();};
  for(const id of ['diskSearch','diskMin','diskMax'])$(id).oninput=()=>{S.page=0;render();};for(const id of ['diskDeleted','diskSort','diskUnit'])$(id).onchange=()=>{S.page=0;render();};
  $('diskResetFilter').onclick=()=>{for(const id of ['diskSearch','diskMin','diskMax'])$(id).value='';$('diskDeleted').value='all';S.page=0;render();};
  $('diskPrev').onclick=()=>{S.page--;render();};$('diskNext').onclick=()=>{S.page++;render();};
  $('diskExport').onclick=()=>busy(async()=>{status('正在提取选中项…');const result=await api.exportFiles({...context(),entryIds:[...S.selected]});if(!result){status('已取消选择导出位置。');return;}status((result.cancelled?'任务已停止；':'')+'已导出 '+result.count+' 个文件（'+size(result.bytes)+'），失败 '+result.errors.length+' 项。位置：'+result.directory+'；详情见 manifest.json。');});
  async function pushAnalysis(ids){
    status('正在整理文件与目录…');const plan=await api.planAnalysis({...context(),entryIds:ids}),failures=[...plan.skipped];let done=0,attempted=0;
    if(plan.limits)transferSettings(plan.limits);const threads=transferThreads;let nextYield=performance.now()+40;
    try{
      while(attempted<plan.entries.length&&!S.cancelRequested){
        const batch=[];let bytes=0;
        while(attempted<plan.entries.length&&batch.length<threads){const row=plan.entries[attempted];if(batch.length&&bytes+row.size>batchBytes)break;batch.push(row);bytes+=row.size;attempted++;}
        status('正在并行送入文件分析 · 已加入 '+done+' / '+plan.entries.length+' 项 · '+batch.length+' 路读取');
        try{
          const response=await api.analyzeBatch({entryIds:batch.map(row=>row.id),threads}),results=new Map(response.results.map(result=>[result.entryId,result])),files=[];
          for(const row of batch){
            const result=results.get(row.id);
            if(!result?.ok){failures.push({path:row.path,size:row.size,reason:result?.error||'读取未返回完整结果'});continue;}
            const file=new File([result.bytes],result.name);Object.defineProperty(file,'_hexPath',{value:result.path});
            if(result.snapshot)Object.defineProperty(file,'_hexSnapshot',{value:result.snapshot});files.push(file);
          }
          done+=H.addFiles(files);if(response.cancelled)S.cancelRequested=true;
        }catch(error){for(const row of batch)failures.push({path:row.path,size:row.size,reason:error.message});}
        // IPC already yields; force an extra event-loop turn only when a run of
        // very small batches could otherwise delay paints or cancellation.
        if(performance.now()>=nextYield){await new Promise(resolve=>setTimeout(resolve,0));nextYield=performance.now()+40;}
      }
    }
    finally{const report={source:S.image.name,createdAt:new Date().toISOString(),added:done,planned:plan.entries.length,threads,cancelled:S.cancelRequested,skipped:failures,notProcessed:plan.entries.slice(attempted).map(x=>({path:x.path,size:x.size})),note:plan.note};$('diskTransferInfo').textContent=JSON.stringify(report,null,2);$('diskTransferBox').hidden=false;$('diskTransferBox').open=failures.length>0||S.cancelRequested;$('diskTransferSave').onclick=()=>H.download(JSON.stringify(report,null,2),'HexScope_transfer.json','application/json');const message=(S.cancelRequested?'已停止；':'')+'已送入 '+done+' 个文件，跳过 / 失败 '+failures.length+' 项；明细见镜像工作台的推送记录。';status(message);toast(message);if(done)$('inspectMode').click();}
  }
  $('diskAnalyze').onclick=()=>busy(()=>pushAnalysis([...S.selected]));
  $('diskPushFiltered').onclick=()=>busy(()=>pushAnalysis(filtered().map(row=>row.id)));
  api?.onProgress(value=>{if(value.phase==='export')status('正在导出 '+value.done+' / '+value.total+' 项 · '+size(value.bytes||0)+(value.name?' · '+value.name:''));});
  document.addEventListener('drop',e=>{
    if(!$('hashWorkspace').hidden)return;
    const files=Array.from(e.dataTransfer?.files||[]),images=files.filter(x=>/\.(e01|ex01|dd|raw|img|001|vhdx?|vmdk|aff)$/i.test(x.name));
    if(!images.length)return;e.preventDefault();e.stopImmediatePropagation();$('dropzone').classList.remove('dragging');mode();busy(async()=>{if(images.length>1)toast('一次打开一个镜像，已选择第一个；E01 后续分卷会由组件读取。');await opened(await api.openDropped(images[0]));});
  },true);
  if(!api){$('diskUnavailable').hidden=false;$('diskEngine').textContent='镜像引擎仅在 Windows 便携版中可用。';}controls();
})();
