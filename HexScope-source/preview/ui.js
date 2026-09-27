(function(){
'use strict';
const H=window.HexApp,P=window.HexPreviewCore,$=H.$;
const stage=$('previewStage'),tools=$('previewTools'),status=$('previewStatus'),note=$('previewNote');
const S={id:null,file:null,token:0,serial:0,worker:null,pending:new Map(),reads:new Set(),urls:new Set(),pdf:null,render:null,timer:null,password:null};
function el(tag,text,attrs={}){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;}
function button(text,fn){const node=el('button',text,{class:'secondary',type:'button'});node.onclick=fn;tools.append(node);return node;}
function select(label,items,fn){const node=el('select',undefined,{'aria-label':label});for(const [value,text]of items)node.append(el('option',text,{value}));node.onchange=()=>fn(node.value);const wrapper=el('label',label+' ');wrapper.append(node);tools.append(wrapper);return node;}
function url(blob){const value=URL.createObjectURL(blob);S.urls.add(value);return value;}
function terminate(){if(S.worker){S.worker.terminate();S.worker=null;}for(const request of S.pending.values()){clearTimeout(request.timer);request.reject(Error('预览已停止。'));}S.pending.clear();}
function cleanup(reset=true){
 ++S.token;clearTimeout(S.timer);S.timer=null;S.password=null;$('previewPassword').value='';$('previewPasswordForm').hidden=true;
 for(const requestId of S.reads)window.hexscopeFiles?.cancelPreview(requestId).catch(()=>{});S.reads.clear();
 S.render?.cancel();S.render=null;S.pdf?.destroy().catch(()=>{});S.pdf=null;terminate();
 for(const media of stage.querySelectorAll('audio,video')){media.pause();media.removeAttribute('src');media.load();}
 for(const image of stage.querySelectorAll('img')){image.onload=null;image.onerror=null;image.removeAttribute('src');}
 for(const value of S.urls)URL.revokeObjectURL(value);S.urls.clear();
 stage.replaceChildren();stage.className='preview-stage';tools.replaceChildren();$('previewStop').disabled=true;
 if(reset){S.id=null;S.file=null;}
}
function stop(message='预览已停止，可点击重新载入。'){cleanup(false);status.textContent=message;note.textContent='文件原件未改变。';}
function failure(error,token){if(token!==S.token)return;stop('无法预览：'+String(error.message||error));}
function bounded(token,milliseconds=30000){clearTimeout(S.timer);S.timer=setTimeout(()=>{if(token===S.token)stop('预览超过 '+milliseconds/1000+' 秒，已停止。可改用十六进制、提取文件，或稍后重新载入。');},milliseconds);$('previewStop').disabled=false;}
function ready(token,message){if(token!==S.token)return false;clearTimeout(S.timer);S.timer=null;$('previewStop').disabled=true;status.textContent=message;return true;}
function fileReader(file,token){
 // Cache only this preview's bytes. Encoding changes and small-file format
 // detection reuse the same snapshot; no second copy is added to the queue.
 let cached=null;
 return async(end,step='读取文件内容')=>{
  if(token!==S.token)throw Error('预览已停止。');
  const length=Math.min(file.size,end);if(cached&&cached.length>=length)return cached.subarray(0,length);
  const requestId=++S.serial;let data;
  try{
   if(window.hexscopeFiles?.readPreview){S.reads.add(requestId);data=await window.hexscopeFiles.readPreview(file,{offset:0,length,requestId});}
   if(token!==S.token)throw Error('预览已停止。');
   if(data==null)data=await file.slice(0,length).arrayBuffer();
   if(token!==S.token)throw Error('预览已停止。');
   cached=new Uint8Array(data);return cached;
  }catch(error){
   let message=String(error.message||error);
   if(['NotReadableError','NotFoundError','SecurityError'].includes(error.name)||/requested file could not be read/i.test(message))
    message='原文件引用已无法读取。请确认文件仍在原位置、所在磁盘已连接或挂载，然后重新选择或拖入文件；镜像提取文件可重新推送到文件分析。';
   throw Error(step+'失败：'+message);
  }finally{S.reads.delete(requestId);}
 };
}
function request(data){
 if(!S.worker){
  S.worker=new Worker(url(new Blob([$('previewWorkerSource').textContent],{type:'text/javascript'})));
  S.worker.onmessage=({data})=>{const task=S.pending.get(data.id);if(!task)return;S.pending.delete(data.id);clearTimeout(task.timer);data.ok?task.resolve(data.result):task.reject(Error(data.error));};
  S.worker.onerror=e=>{for(const task of S.pending.values())task.reject(Error(e.message||'后台预览失败'));terminate();};
 }
 const id=++S.serial;
 return new Promise((resolve,reject)=>{S.pending.set(id,{resolve,reject,timer:setTimeout(()=>{S.pending.delete(id);reject(Error('后台解析超过 30 秒。'));terminate();},30000)});S.worker.postMessage({...data,id});});
}
function safeDocument(html){
 const template=document.createElement('template');template.innerHTML=html;
 const output=el('article',undefined,{class:'preview-document'}),allowed=new Set('p h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th b strong em i u s ol ul li blockquote pre code small span sub sup br hr img'.split(' ')),drop=new Set('script style iframe frame object embed link meta base form input button textarea select svg math audio video'.split(' '));let count=0;
 function copy(source,dest,depth){
  if(depth>80)throw Error('DOCX 内容层级超过预览限制。');
  for(const child of source.childNodes){
   if(++count>50000)throw Error('DOCX 节点数量超过预览限制。');
   if(child.nodeType===3){dest.append(document.createTextNode(child.textContent));continue;}
   if(child.nodeType!==1)continue;const tag=child.localName;if(drop.has(tag))continue;
   if(!allowed.has(tag)){copy(child,dest,depth+1);continue;}
   if(tag==='img'){
    const src=child.getAttribute('src')||'';
    if(!/^data:image\/(png|jpeg|gif|bmp|webp|avif|x-icon);base64,[A-Za-z0-9+/=]+$/.test(src)||src.length>12*1024*1024){dest.append(el('span','[未显示的内嵌图片]'));continue;}
    const img=el('img',undefined,{src,alt:child.getAttribute('alt')||'文档内嵌图片',loading:'lazy'});img.onerror=()=>img.replaceWith(el('span','[内嵌图片无法显示]'));dest.append(img);continue;
   }
   const node=el(tag);if(tag==='td'||tag==='th')for(const name of ['colspan','rowspan']){const n=Number(child.getAttribute(name));if(Number.isInteger(n)&&n>1&&n<=1000)node.setAttribute(name,String(n));}
   copy(child,node,depth+1);dest.append(node);
  }
 }
 copy(template.content,output,0);return output;
}
function renderWord(result,token){
 stage.append(safeDocument(result.html));note.textContent=result.note;
 if(result.messages.length||result.omittedImages){const details=el('details');details.append(el('summary','转换提示'),el('pre',result.messages.join('\n')+(result.omittedImages?'\n略过图片：'+result.omittedImages:'')));stage.append(details);}
 ready(token,'DOCX 正文已载入。');terminate();
}
function renderSheet(result,token,query=''){
 if(token!==S.token)return;tools.replaceChildren();stage.replaceChildren();
 const picker=select('工作表',result.sheets.map((x,i)=>[String(i),x.name+(x.hidden?'（隐藏）':'')]),value=>refresh({sheet:Number(value),page:0,query:''}));picker.value=String(result.sheet);
 button('← 上一页',()=>refresh({page:result.page-1})).disabled=result.page===0;
 tools.append(el('span',`${result.page+1} / ${result.pages} 页 · ${result.matchedRows} 行`));
 button('下一页 →',()=>refresh({page:result.page+1})).disabled=result.page+1>=result.pages;
 const search=el('input',undefined,{type:'search',placeholder:'搜索当前表已载入的单元格 / 公式','aria-label':'搜索工作表'});search.value=query;tools.append(search);button('搜索',()=>refresh({page:0,query:search.value}));search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();refresh({page:0,query:search.value});}};
 const cellInfo=el('div','点击单元格可查看缓存值和公式文本。',{class:'preview-cell',role:'status'});tools.append(cellInfo);
 const table=el('table',undefined,{class:'preview-sheet'}),thead=el('thead'),header=el('tr');header.append(el('th','行'));for(const name of result.columns)header.append(el('th',name));thead.append(header);table.append(thead);
 const body=el('tbody');for(const row of result.rows){const tr=el('tr',undefined,{'data-hidden':row.hidden});tr.append(el('th',row.number+(row.hidden?'*':''),{scope:'row'}));row.cells.forEach((cell,i)=>{const td=el('td',cell.text,{tabindex:'0','data-hidden':cell.hidden});const show=()=>{cellInfo.textContent=`${result.columns[i]}${row.number} · 值：${cell.text}`+(cell.formula?'\n公式：='+cell.formula:'')+(row.hidden||cell.hidden?'\n原工作簿中此行 / 列隐藏，预览仍显示。':'');};td.onclick=show;td.onfocus=show;tr.append(td);});body.append(tr);}table.append(body);stage.append(table);
 note.textContent=result.note;ready(token,`工作表「${result.sheets[result.sheet].name}」：${result.totalRows} 行 × ${result.totalColumns} 列。`+(result.limited?'已截断超出预览上限的内容。':''));
 async function refresh(changes){
  const local=++S.serial;S.sheetSerial=local;for(const node of tools.querySelectorAll('button,select,input'))node.disabled=true;bounded(token);status.textContent='正在读取工作表…';
  try{const next=await request({action:'sheet',sheet:result.sheet,page:result.page,query,...changes});if(token===S.token&&local===S.sheetSerial)renderSheet(next,token,changes.query??query);}catch(error){failure(error,token);}
 }
}
async function renderText(file,read,token,encoding='auto'){
 const serial=++S.serial;S.textSerial=serial;
 const bytes=await read(P.LIMITS.text+4);if(token!==S.token||serial!==S.textSerial)return;
 const result=P.text(bytes,encoding);tools.replaceChildren();stage.replaceChildren();
 const picker=select('文本编码',[['auto','自动（UTF / GB18030）'],['utf-8','UTF-8'],['gb18030','GB18030 / GBK'],['utf-16le','UTF-16 LE'],['utf-16be','UTF-16 BE'],['windows-1252','Windows-1252']],value=>renderText(file,read,token,value).catch(e=>failure(e,token)));picker.value=encoding;
 stage.append(el('pre',result.text));note.textContent='按纯文本显示，不执行 HTML、SVG、脚本或文档中的链接。';ready(token,'文本已载入 · '+result.encoding+(file.size>P.LIMITS.text?' · 仅预览前 2 MiB':'')+'。');
}
function renderArchive(result,token){
 const table=el('table',undefined,{class:'preview-sheet'}),head=el('tr');for(const text of ['成员路径','原始大小','压缩大小'])head.append(el('th',text));table.append(head);
 for(const entry of result.entries){const tr=el('tr');for(const text of [entry.name+(entry.encrypted?' [加密]':''),H.size(entry.size),H.size(entry.packed)])tr.append(el('td',text));table.append(tr);}stage.append(table);note.textContent='容器目录预览。解压和导出请使用「提取文件」标签。';ready(token,'ZIP 容器：'+result.entries.length+' 个成员。');terminate();
}
async function renderImage(file,read,kind,header,token){
 if(file.size>P.LIMITS.image)throw Error('图片预览文件上限 32 MiB。');
 const dimensions=P.dimensions(header);if(dimensions&&dimensions[0]*dimensions[1]>P.LIMITS.pixels)throw Error('图片超过 1,600 万像素预览上限。');
 const bytes=await read(file.size);if(token!==S.token)return;
 const wrap=el('div',undefined,{class:'preview-image-wrap'}),img=el('img',undefined,{alt:file.name});let scale=1,rotation=0;
 stage.classList.add('preview-image-stage');wrap.append(img);stage.append(wrap);bounded(token,20000);
 function apply(){const width=img.naturalWidth*scale,height=img.naturalHeight*scale;wrap.style.width=(rotation%180?height:width)+'px';wrap.style.height=(rotation%180?width:height)+'px';img.style.width=width+'px';img.style.height=height+'px';img.style.transform=`rotate(${rotation}deg)`;}
 button('适合宽度',()=>{scale=Math.min(1,Math.max(200,stage.clientWidth-40)/(rotation%180?img.naturalHeight:img.naturalWidth));apply();});button('100%',()=>{scale=1;apply();});button('缩小',()=>{scale=Math.max(.1,scale/1.25);apply();});button('放大',()=>{scale=Math.min(4,scale*1.25);apply();});button('旋转 90°',()=>{rotation=(rotation+90)%360;apply();});
 img.onload=()=>{if(token!==S.token)return;if(img.naturalWidth*img.naturalHeight>P.LIMITS.pixels){failure(Error('图片超过 1,600 万像素预览上限。'),token);return;}scale=Math.min(1,Math.max(200,stage.clientWidth-40)/img.naturalWidth);apply();ready(token,`${kind.label} · ${img.naturalWidth} × ${img.naturalHeight} 像素 · ${H.size(file.size)}`);};
 img.onerror=()=>failure(Error('图片数据损坏或当前运行时不支持这种图像。'),token);
 img.src=url(new Blob([bytes],{type:kind.mime}));note.textContent='棋盘格表示透明区域；旋转与缩放仅影响预览，原始像素分析在「像素 / LSB」标签。动图按浏览器原生行为播放。';
}
async function renderMedia(file,read,kind,token){
 const snapshot=file.size<=128*1024*1024?new Blob([await read(file.size)],{type:kind.mime}):file.slice(0,file.size,kind.mime);
 if(token!==S.token)return;
 const media=el(kind.kind,undefined,{controls:'',preload:'metadata'});media.onloadedmetadata=()=>ready(token,kind.label+' · '+(Number.isFinite(media.duration)?media.duration.toFixed(1)+' 秒':'时长未知'));media.onerror=()=>failure(Error('音视频无法解码或文件引用已失效，请重新导入文件；当前运行时可能不支持该编码。'),token);media.src=url(snapshot);stage.append(media);note.textContent='使用随包浏览器的音视频解码器；不自动播放。容器扩展名相同的文件可能采用不同编码，不保证每种编码都能播放。'+(file.size>128*1024*1024?'大于 128 MiB 的音视频按原文件流式读取，播放期间请保持磁盘连接。':'');ready(token,'音视频已载入，点击播放。');
}
async function renderPDF(bytes,token){
 let pdf,pageNumber=1,scale=1,rotation=0,drawId=0;
 const session=window.HexPreviewPDF.open(bytes,{onPassword(update,reason){
  if(token!==S.token)return;clearTimeout(S.timer);S.password=value=>{bounded(token);update(value);};$('previewPasswordForm').hidden=false;status.textContent=reason===2?'PDF 密码不正确，请重新输入。':'此 PDF 需要密码才能预览。';$('previewPassword').focus();
 }});S.pdf=session;
 pdf=await session.promise;if(token!==S.token)return;$('previewPasswordForm').hidden=true;$('previewPassword').value='';S.password=null;
 const prev=button('← 上一页',()=>{pageNumber--;draw();}),pageInput=el('input',undefined,{type:'number',min:'1',max:pdf.numPages,value:'1','aria-label':'PDF 页码'});tools.append(pageInput,el('span','/ '+pdf.numPages+' 页'));
 pageInput.onchange=()=>{const n=Number(pageInput.value);if(Number.isInteger(n)&&n>=1&&n<=pdf.numPages){pageNumber=n;draw();}else pageInput.value=pageNumber;};
 const next=button('下一页 →',()=>{pageNumber++;draw();});button('缩小',()=>{scale=Math.max(.25,scale/1.25);draw();});button('放大',()=>{scale=Math.min(3,scale*1.25);draw();});button('旋转 90°',()=>{rotation=(rotation+90)%360;draw();});
 note.textContent='只读页面与文本预览；不执行文档脚本，不打开外部链接，不运行附件、表单或宏。扫描件可能没有可复制文本；当前未内置 OCR。';
 async function draw(){
  const serial=++drawId;S.render?.cancel();S.render=null;bounded(token,20000);status.textContent='正在绘制 PDF 页面…';prev.disabled=pageNumber<=1;next.disabled=pageNumber>=pdf.numPages;pageInput.value=pageNumber;
  try{
   const page=await pdf.getPage(pageNumber);if(token!==S.token||serial!==drawId)return;
   const viewport=page.getViewport({scale,rotation:(page.rotate+rotation)%360});if(viewport.width*viewport.height>P.LIMITS.pixels)throw Error('PDF 页面画布超过 1,600 万像素上限，请重新载入后缩小。');
   const canvas=el('canvas',undefined,{class:'preview-pdf-page','aria-label':'PDF 第 '+pageNumber+' 页'});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);stage.replaceChildren(canvas);
   const task=page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:0});S.render=task;await task.promise;if(token!==S.token||serial!==drawId)return;S.render=null;
   const reader=page.streamTextContent().getReader(),parts=[];let length=0,limited=false;
   try{while(true){const {done,value}=await reader.read();if(done)break;if(token!==S.token||serial!==drawId){await reader.cancel();return;}for(const item of value.items){if(!('str'in item))continue;const part=(item.str+(item.hasEOL?'\n':' ')).slice(0,P.LIMITS.text-length);parts.push(part);length+=part.length;if(length>=P.LIMITS.text){limited=true;break;}}if(limited){await reader.cancel();break;}}}finally{reader.releaseLock();}
   if(token!==S.token||serial!==drawId)return;
   const text=parts.join(''),details=el('details',undefined,{class:'preview-pdf-text'});details.append(el('summary','本页文本（可选择复制'+(limited?'，已截断':'')+'）'),el('pre',text||'本页没有可提取文本。'));stage.append(details);ready(token,`PDF 第 ${pageNumber} / ${pdf.numPages} 页 · ${Math.round(scale*100)}%`);page.cleanup();
  }catch(error){if(error.name!=='RenderingCancelledException'&&serial===drawId)failure(error,token);}
 }
 await draw();
}
async function load(item,force=false){
 if(!item){cleanup();return;}if(!force&&S.id===item.id)return;cleanup();S.id=item.id;S.file=item.file;const token=S.token,file=item.file,read=fileReader(file,token);
 $('previewFormat').textContent='';status.textContent='正在识别并载入文件…';note.textContent='本机只读解析中。';bounded(token);
 try{
  const header=await read(65536,'读取文件头');if(token!==S.token)return;const kind=P.classify(header,file.name);$('previewFormat').textContent=kind.label;
  if(kind.kind==='unsupported'){stage.append(el('p',kind.note,{class:'preview-empty'}));note.textContent='可使用其他文件分析标签继续检查。';ready(token,'此格式尚无内容预览。');return;}
  if(kind.kind==='text'){await renderText(file,read,token);return;}
  if(kind.kind==='image'){await renderImage(file,read,kind,header,token);return;}
  if(['audio','video'].includes(kind.kind)){await renderMedia(file,read,kind,token);return;}
  if(file.size>(kind.kind==='pdf'?P.LIMITS.pdf:P.LIMITS.office))throw Error(kind.kind==='pdf'?'PDF 预览文件上限 64 MiB。':'Office / ZIP 预览文件上限 32 MiB。');
  const bytes=await read(file.size);if(token!==S.token)return;
  if(kind.kind==='pdf'){await renderPDF(bytes,token);return;}
  const result=await request({action:'open',kind:kind.kind,name:file.name,bytes});if(token!==S.token)return;
  if(result.kind==='docx')renderWord(result,token);else if(result.kind==='spreadsheet')renderSheet(result,token);else if(result.kind==='archive')renderArchive(result,token);
 }catch(error){failure(error,token);}
}
$('previewReload').onclick=()=>load(H.selected(),true);$('previewStop').onclick=()=>stop();
$('previewPasswordForm').onsubmit=e=>{e.preventDefault();if(S.password){const value=$('previewPassword').value;$('previewPassword').value='';$('previewPasswordForm').hidden=true;S.password(value);S.password=null;}};
window.addEventListener('hexscope-tab',({detail})=>{if(detail.name==='preview'&&detail.id&&!$('inspectionWorkspace').hidden)load(H.selected());else if(S.id!==null)cleanup();});
window.addEventListener('hexscope-workspace',({detail})=>{if(detail.name!=='inspection')cleanup();else if(H.state.tab==='preview')load(H.selected());});
window.addEventListener('pagehide',()=>cleanup());
window.HexPreview={load,stop,cleanup,safeDocument,state:S};
})();
