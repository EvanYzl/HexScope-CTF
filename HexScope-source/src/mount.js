(function(){
  'use strict';
  const H=window.HexApp,{$,esc,size,toast}=H,api=window.hexscopeDisk;
  const S={image:null,vhd:null,mounted:null,busy:false,system:false,diskBusy:false,hashBusy:false};
  const status=text=>$('mountStatus').textContent=text;
  function controls(){const locked=S.busy||S.diskBusy||S.hashBusy;for(const el of $('mountPanel').querySelectorAll('[data-mount-task]'))el.disabled=!api||locked;$('mountConvert').disabled=!api||locked||!S.image||S.mounted?.attached;$('mountSelect').disabled=!api||locked||S.mounted?.attached;$('mountAttach').disabled=!api||locked||!S.vhd||!S.vhd.partitions.length;for(const id of ['mountDetach','mountRefresh'])$(id).disabled=!api||locked||!S.vhd;$('mountExplorer').disabled=!api||locked||!S.mounted?.attached||!S.mounted?.readOnly||!S.mounted?.partitions.some(p=>p.letter);$('mountCancel').disabled=!S.busy||S.system;}
  async function busy(fn,system=false){if(!api||S.busy||S.diskBusy||S.hashBusy)return;S.busy=true;S.system=system;window.dispatchEvent(new CustomEvent('hexscope-mount-busy',{detail:true}));controls();try{await fn();}catch(e){status('操作未完成：'+e.message);toast(e.message);}finally{S.busy=false;S.system=false;window.dispatchEvent(new CustomEvent('hexscope-mount-busy',{detail:false}));controls();}}
  async function letters(){const options=await api.driveLetters();$('mountLetter').innerHTML=options.map(x=>'<option value="'+esc(x.letter)+'" '+(x.occupied?'disabled':'')+'>'+esc(x.letter)+':'+(x.occupied?' · 已占用':'')+'</option>').join('');const free=options.find(x=>!x.occupied&&x.letter==='Z')||options.find(x=>!x.occupied);if(free)$('mountLetter').value=free.letter;}
  function select(vhd){S.vhd=vhd;S.mounted=null;$('mountTarget').textContent=vhd.filename;$('mountPartitions').innerHTML=vhd.partitions.map(p=>'<option value="'+(p.offset*p.sectorSize)+'">'+esc(p.description)+' · 偏移 '+(p.offset*p.sectorSize)+' 字节</option>').join('');if(!vhd.partitions.length)$('mountPartitions').innerHTML='<option>未识别到可分配盘符的分区</option>';status('已准备固定 VHD：'+size(vhd.mediaBytes)+'。选择分区和盘符后，只读挂载。');}
  function mounted(result){S.mounted=result;const entries=result.partitions.filter(x=>x.letter).map(x=>x.letter+':').join('、');status(result.attached?'Windows 已确认只读挂载'+(entries?' · 盘符 '+entries:'，尚无盘符')+'。关闭软件不会自动卸载，请使用「卸载」按钮。':'Windows 已确认卸载；VHD 转换文件保留。');}
  $('mountConvert').onclick=()=>busy(async()=>{status('正在将镜像解码为固定 VHD；原镜像只读…');$('mountProgress').value=0;const result=await api.convertVhd({imageId:S.image.id});if(result){select(result);$('mountProgress').value=1;await letters();}else status('已取消选择转换位置。');});
  $('mountSelect').onclick=()=>busy(async()=>{const result=await api.selectVhd();if(result){select(result);await letters();}});
  $('mountAttach').onclick=()=>busy(async()=>{status('等待 Windows 管理员授权；将只读挂载所选 VHD 并分配盘符…');S.mounted=null;const result=await api.mountVhd({vhdId:S.vhd.id,offsetBytes:Number($('mountPartitions').value),letter:$('mountLetter').value});mounted(result);},true);
  $('mountDetach').onclick=()=>busy(async()=>{status('等待 Windows 管理员授权以卸载 VHD…');mounted(await api.unmountVhd({vhdId:S.vhd.id}));await letters();},true);
  $('mountRefresh').onclick=()=>busy(async()=>{mounted(await api.mountStatus({vhdId:S.vhd.id}));await letters();},true);
  $('mountExplorer').onclick=()=>busy(async()=>{const part=S.mounted.partitions.find(x=>x.letter===$('mountLetter').value)||S.mounted.partitions.find(x=>x.letter);await api.openMounted({vhdId:S.vhd.id,letter:part.letter});status('已请求资源管理器打开 '+part.letter+':。');},true);
  $('mountCancel').onclick=()=>{api.cancel().catch(e=>toast(e.message));status('正在停止转换，未完成的 VHD 不会作为可挂载结果。');};
  api?.onProgress(value=>{if(value.phase!=='vhd'||!S.busy)return;$('mountProgress').value=value.total?value.bytes/value.total:0;status('正在转换 · '+size(value.bytes)+' / '+size(value.total)+(value.bytesPerSecond?' · '+size(value.bytesPerSecond)+'/s':''));});
  window.addEventListener('hexscope-disk-state',e=>{S.image=e.detail.image;S.diskBusy=e.detail.busy;$('mountSpace').textContent=S.image?'当前镜像解码容量 '+size(S.image.mediaBytes||0)+'；转换约需同等可用空间，另加 512 字节 VHD 文件尾。':'先打开 E01 / RAW 镜像，再转换；也可以选择已保存的固定 VHD。';controls();});
  window.addEventListener('hexscope-hash-busy',e=>{S.hashBusy=e.detail;controls();});
  if(!api)$('mountUnavailable').hidden=false;controls();
})();
