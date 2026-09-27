(function(){
'use strict';
const H=window.HexApp,V=window.HexVisionCore,$=H.$,canvas=$('visionCanvas'),ctx=()=>canvas.getContext('2d',{willReadFrequently:true});
const S={files:[],index:-1,page:1,pdf:null,original:null,undo:[],ignore:[],results:[],seq:0,active:new Set(),token:0,busy:false,barcode:null,capabilities:null,number:1,loaded:false};
const selected=()=>S.files[S.index],status=text=>$('visionStatus').textContent=text;
function safeName(name){return String(name||'result').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,150);}
function save(bytes,name,type='application/octet-stream'){H.download(new Blob([bytes],{type}),safeName(name));}
function active(value){S.busy=value;for(const id of ['visionOCR','visionBatch','visionDecode','visionGenerate','visionSearchable','visionExportBatch','visionCompressBatch','visionStitch','visionPDFCompress','visionCapture'])$(id).disabled=value;$('visionStop').disabled=!value;}
function check(token){if(token!==S.token)throw new DOMException('任务已停止。','AbortError');}
async function invoke(op,args,token=S.token){
 if(!window.hexscopeVision)throw Error('此功能需要 Windows 便携版内置图文引擎。');check(token);const id=++S.seq;S.active.add(id);
 try{const value=await window.hexscopeVision.run(id,op,args);check(token);return value;}finally{S.active.delete(id);}
}
function stop(){S.token++;for(const id of S.active)window.hexscopeVision?.cancel(id);S.active.clear();active(false);$('visionProgress').value=0;status('任务已停止，已完成的结果保留。');}
async function task(fn){if(S.busy)return;const token=++S.token;active(true);try{await fn(token);}catch(e){if(e.name!=='AbortError')status('处理失败：'+e.message);}finally{if(token===S.token)active(false);}}
function bind(id,fn){$(id).onclick=()=>task(fn);}
async function capabilities(){if(S.capabilities||!window.hexscopeVision)return;S.capabilities=await invoke('capabilities',{});
 $('visionLanguages').replaceChildren();for(const lang of S.capabilities.languages){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=lang.code;input.checked=['chi_sim','eng'].includes(lang.code);label.append(input,document.createTextNode(lang.name+' · '+lang.code));$('visionLanguages').append(label);}
 const select=$('visionBarcodeFormat');for(const item of S.capabilities.barcodeWrite){const option=document.createElement('option');option.value=item.id;option.textContent=item.description;select.append(option);}select.value='qrcode';
 status(`${S.capabilities.languages.length} 个语言模型 · ${S.capabilities.barcodeRead.length} 个条码识别格式 / 变体 · ${S.capabilities.barcodeWrite.length} 个条码生成入口 · 本地离线`);
}
function languages(){const values=[...$('visionLanguages').querySelectorAll('input:checked')].map(x=>x.value);if(!values.length||values.length>4)throw Error('请选择 1–4 种识别语言。');return values;}
function create(width,height){if(width<1||height<1||width*height>32000000)throw Error('图片超过 3,200 万像素或尺寸无效，请拆分为较小图片。');const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
function copy(source){const c=create(source.width,source.height);c.getContext('2d').drawImage(source,0,0);return c;}
function remember(){if(!S.loaded)throw Error('请先载入图片或 PDF。');S.modified=true;S.undo.push(copy(canvas));let total=S.undo.reduce((n,c)=>n+c.width*c.height*4,0);while(S.undo.length>1&&(S.undo.length>5||total>128*1024*1024)){const old=S.undo.shift();total-=old.width*old.height*4;}}
function display(source){canvas.width=source.width;canvas.height=source.height;ctx().drawImage(source,0,0);$('visionEmpty').hidden=true;S.loaded=true;}
function blob(c=canvas,type='image/png',quality){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('图片编码失败。')),type,quality));}
async function png(c=canvas){return new Uint8Array(await (await blob(c)).arrayBuffer());}
async function image(bytes){const u=URL.createObjectURL(new Blob([bytes]));try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('不支持或已损坏的图片。'));img.src=u;});const c=create(img.naturalWidth,img.naturalHeight);c.getContext('2d').drawImage(img,0,0);return c;}finally{URL.revokeObjectURL(u);}}
async function read(file,token){if(window.HexFileIO.size(file)>64*1024*1024)throw Error('图文单文件上限 64 MiB。');const bytes=await window.HexFileIO.read(file,0,window.HexFileIO.size(file));check(token);return bytes;}
async function closePDF(){const previous=S.pdf;S.pdf=null;if(previous)await previous.handle.destroy();}
async function load(index,token=S.token){
 if(index<0||index>=S.files.length)return;await closePDF();check(token);S.index=index;S.page=1;S.ignore=[];S.undo=[];S.number=1;
 const file=selected(),bytes=await read(file,token);check(token);S.modified=false;
 if(new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-'){
  const handle=window.HexPreviewPDF.open(bytes.slice(),{onPassword:()=>{handle.destroy();status('PDF 已加密，请在文件预览解锁或提供未加密副本。');}});
  const doc=await handle.promise;check(token);S.pdf={handle,doc,bytes};await page(1,token);
 }else{const decoded=await image(bytes);check(token);display(decoded);$('visionPage').textContent=canvas.width+' × '+canvas.height;S.original=copy(canvas);}
 $('visionFiles').value=String(index);$('visionOutput').value='';S.current=null;$('visionOutputMode').value='text';status('已载入 '+file.name+'；原文件保持不变。');
}
async function page(number,token=S.token){
 if(!S.pdf||number<1||number>S.pdf.doc.numPages)return;const p=await S.pdf.doc.getPage(number);check(token);
 const unscaled=p.getViewport({scale:1}),scale=Math.min(2,Math.sqrt(14000000/(unscaled.width*unscaled.height))),view=p.getViewport({scale}),c=create(Math.ceil(view.width),Math.ceil(view.height));
 const render=p.render({canvasContext:c.getContext('2d'),viewport:view});await render.promise;check(token);display(c);S.page=number;S.original=copy(canvas);S.undo=[];S.ignore=[];$('visionPage').textContent=`PDF ${number} / ${S.pdf.doc.numPages}`;
}
function add(files){if(S.busy){status('请等待当前任务结束，或点击停止后添加文件。');return;}
 for(const file of files){S.files.push(file);const option=document.createElement('option');option.value=String(S.files.length-1);option.textContent=file.name;$('visionFiles').append(option);}$('visionCount').textContent=String(S.files.length);if(S.index<0&&S.files.length)task(token=>load(0,token));}
function setOutput(result){$('visionOutputMode').value='text';$('visionOutput').value=result.text||'';S.current=result;}
function resultFor(text,extra={}){return {name:selected()?.name||'image.png',page:S.page,text,createdAt:new Date().toISOString(),...extra};}
async function recognize(token,{force=false,textOnlyPDF=false}={}){
 if(!S.loaded)throw Error('请先载入文件。');
 if(S.pdf&&!force&&!S.ignore.length&&!S.modified){const content=await (await S.pdf.doc.getPage(S.page)).getTextContent();check(token);let text='';for(const item of content.items)if(item.str)text+=item.str+(item.hasEOL?'\n':' ');
  if(text.trim().length>8){const p=await S.pdf.doc.getPage(S.page),view=p.getViewport({scale:canvas.width/p.getViewport({scale:1}).width});
   const words=content.items.filter(i=>i.str).map(i=>{const [x,y]=view.convertToViewportPoint(i.transform[4],i.transform[5]);return {text:i.str,confidence:100,bbox:{x0:x,y0:y-i.height*view.scale,x1:x+i.width*view.scale,y1:y}};});
   const r=resultFor(text,{source:'PDF 文本层',confidence:null,words});setOutput(r);return r;}}
 const working=copy(canvas),w=working.getContext('2d');w.fillStyle='white';for(const r of S.ignore)w.fillRect(r.x,r.y,r.width,r.height);
 const chunks=V.tiles(working.width,working.height),parts=[];
 for(let i=0;i<chunks.length;i++){
  check(token);const tile=chunks[i],c=create(tile.width,tile.height);c.getContext('2d').drawImage(working,tile.x,tile.y,tile.width,tile.height,0,0,tile.width,tile.height);
  status(`识别 ${selected()?.name||'图片'} · 第 ${S.page} 页 · 区块 ${i+1}/${chunks.length}`);
  const result=await invoke('ocr',{bytes:await png(c),languages:languages(),psm:Number($('visionLayout').value),deskew:$('visionDeskew').checked,pdf:chunks.length===1,textOnlyPDF},token);
  for(const word of result.words){word.bbox.x0+=tile.x;word.bbox.x1+=tile.x;word.bbox.y0+=tile.y;word.bbox.y1+=tile.y;}parts.push(result);
 }
 const words=[];for(const part of parts)for(const word of part.words)if(!words.some(x=>x.text===word.text&&Math.abs(x.bbox.x0-word.bbox.x0)<15&&Math.abs(x.bbox.y0-word.bbox.y0)<15))words.push(word);
 const r=resultFor(parts.map(x=>x.text).join('\n'),{source:'OCR / CPU',confidence:parts.reduce((n,x)=>n+x.confidence,0)/parts.length,words,
  width:canvas.width,height:canvas.height,pdf:parts.length===1?parts[0].pdf:null,rotation:parts[0].rotation});
 if(parts.length>1)r.text=V.cleanText(r.text,{dedupe:true});setOutput(r);return r;
}
function edited(){const r=S.current||resultFor('');if($('visionOutputMode').value==='table')return {...r,rows:$('visionOutput').value.split(/\r?\n/).map(x=>x.split('\t'))};return {...r,text:$('visionOutput').value};}
function publicResult(r){const {pdf,...safe}=r;return safe;}
async function exportResult(r,format,token){
 const rows=r.rows||V.wordsToRows(r.words||[]);if(format==='docx')return invoke('docx',{text:r.text,title:r.name,rows:r.rows},token);
 if(format==='xlsx')return invoke('xlsx',{rows:rows.length?rows:[[r.text]]},token);
 if(format==='csv')return new TextEncoder().encode(V.csv(rows.length?rows:[[r.text]]));
 return new TextEncoder().encode(format==='json'?JSON.stringify(publicResult(r),null,2):r.text);
}
async function zipResults(entries,name){let total=0;for(const data of Object.values(entries)){total+=data.length;if(total>256*1024*1024)throw Error('本次导出超过 256 MiB，请分批导出。');}save(window.fflate.zipSync(entries,{level:6}),name,'application/zip');}
bind('visionOCR',async token=>{await capabilities();const r=await recognize(token);S.results.push(r);status(r.source+' 完成'+(r.confidence===null?'':' · 平均置信度 '+r.confidence.toFixed(1)+'，请校对识别结果。'));});
bind('visionBatch',async token=>{await capabilities();if(!S.files.length)throw Error('请先添加文件。');S.results=[];const failures=[];
 for(let i=0;i<S.files.length;i++){try{await load(i,token);const count=S.pdf?.doc.numPages||1;for(let p=1;p<=count;p++){check(token);if(S.pdf)await page(p,token);S.results.push(await recognize(token));}}catch(e){check(token);failures.push({name:S.files[i].name,error:e.message});}}
 S.failures=failures;status(`批量完成：${S.results.length} 页，失败 ${failures.length} 个文件。导出 ZIP 包含清单。`);
});
bind('visionDecode',async token=>{if(!S.loaded)throw Error('请先载入图片。');const data=await invoke('barcode-read',{bytes:await png()},token);setOutput(resultFor(data.map(x=>x.format+': '+x.text).join('\n'),{barcodes:data.map(x=>({...x,bytes:Array.from(x.bytes)}))}));status(`识别到 ${data.length} 个条码；已保留原始字节与坐标。`);});
bind('visionGenerate',async token=>{await capabilities();const format=$('visionBarcodeFormat').value,value=$('visionBarcodeText').value,entry=S.capabilities.barcodeWrite.find(x=>x.id===format);const bytes=await invoke('barcode-create',{format,text:value,useExample:value===entry?.example,options:format==='maxicode'?{mode:4}:{}},token);S.barcode=bytes;await generated(bytes,'barcode.png',token);status('条码已生成，可保存或送入文件分析。');});
async function generated(bytes,name,token){const file=new File([bytes],name,{type:'image/png'});S.files.push(file);const option=document.createElement('option');option.value=String(S.files.length-1);option.textContent=file.name;$('visionFiles').append(option);$('visionCount').textContent=String(S.files.length);await load(S.files.length-1,token);}
$('visionBarcodeExample').onclick=()=>{const entry=S.capabilities?.barcodeWrite.find(x=>x.id===$('visionBarcodeFormat').value);if(entry)$('visionBarcodeText').value=entry.example||'';};
$('visionBarcodeSave').onclick=()=>{if(S.barcode)save(S.barcode,'barcode.png','image/png');else status('请先生成条码。');};
bind('visionExport',async token=>{const r=edited(),format=$('visionExportFormat').value;save(await exportResult(r,format,token),r.name+'.'+format);status('识别结果已导出。');});
bind('visionExportBatch',async token=>{if(!S.results.length)throw Error('请先运行批量识别。');const entries={},format=$('visionExportFormat').value;
 for(let i=0;i<S.results.length;i++){check(token);const r=S.results[i];entries[String(i+1).padStart(4,'0')+'_'+safeName(r.name)+'.page'+r.page+'.'+format]=await exportResult(r,format,token);}
 entries['manifest.json']=new TextEncoder().encode(JSON.stringify({results:S.results.map(publicResult),failures:S.failures||[]},null,2));await zipResults(entries,'HexScope-OCR-results.zip');status('批量识别结果与清单已导出。');});
bind('visionSearchable',async token=>{await capabilities();if(!S.loaded)throw Error('请先载入文件。');const original=S.pdf?.bytes?.slice(),count=S.pdf?.doc.numPages||1,pdfs=[];
 for(let i=1;i<=count;i++){if(S.pdf)await page(i,token);const r=await recognize(token,{force:true,textOnlyPDF:!!original});if(!r.pdf)throw Error('此长图需分块；请先裁剪为单页后生成可搜索 PDF。');pdfs.push(r.pdf);}
 const bytes=await invoke(original?'pdf-overlay':'pdf-merge',{original,pages:pdfs},token);save(bytes,(selected()?.name||'image')+'.searchable.pdf','application/pdf');status('可搜索 PDF 副本已生成；识别文本仍需校对。');});
bind('visionPDFCompress',async token=>{if(!S.pdf)throw Error('请先载入 PDF。');const pages=[],count=S.pdf.doc.numPages;
 for(let i=1;i<=count;i++){check(token);await page(i,token);const p=await S.pdf.doc.getPage(i),view=p.getViewport({scale:1});pages.push({bytes:new Uint8Array(await(await blob(canvas,'image/jpeg',Number($('visionQuality').value))).arrayBuffer()),width:view.width,height:view.height});status(`PDF 图像压缩：${i}/${count} 页`);}
 const result=await invoke('pdf-raster',{pages},token);save(result,selected().name+'.compressed.pdf','application/pdf');status('已生成 PDF 图像副本（'+H.size(result.length)+'）；文字层、批注与表单未保留，原件未改变。');});
async function capture(token,ocr=false){if(!window.hexscopeVision?.capture)throw Error('截图需要 Windows 便携版。');const bytes=await window.hexscopeVision.capture('capture');check(token);await generated(bytes,'截图_'+new Date().toISOString().replace(/[:.]/g,'-')+'.png',token);H.showWorkspace('vision');if(ocr){await capabilities();S.results.push(await recognize(token));}else status('截图已载入。选择「裁剪」可限定区域，也可标注、识别或置顶贴图。');}
bind('visionCapture',token=>capture(token));bind('visionPin',async()=>{if(!S.loaded||!window.hexscopeVision?.capture)throw Error('请在便携版中先载入图片。');await window.hexscopeVision.capture('pin',{bytes:await png()});status('图片已置顶显示，关闭贴图窗口即可取消。');});
$('visionShortcuts').onchange=async()=>{try{if(!window.hexscopeVision?.capture)throw Error('快捷键需要 Windows 便携版。');await window.hexscopeVision.capture('shortcuts',{enabled:$('visionShortcuts').checked});status($('visionShortcuts').checked?'已启用 F7 截图、F8 截图并识别。':'全局截图快捷键已关闭。');}catch(e){$('visionShortcuts').checked=false;status(e.message);}};
window.hexscopeVision?.onShortcut?.(({ocr})=>{if(!S.busy)task(token=>capture(token,ocr));});
bind('visionFromFile',async token=>{const file=H.selected()?.file;if(!file)throw Error('请先在文件分析队列选中图片或 PDF。');S.files.push(file);const option=document.createElement('option');option.value=String(S.files.length-1);option.textContent=file.name;$('visionFiles').append(option);$('visionCount').textContent=String(S.files.length);await load(S.files.length-1,token);});
$('visionPick').onclick=()=>$('visionInput').click();$('visionInput').onchange=()=>{add([...$('visionInput').files]);$('visionInput').value='';};
$('visionFiles').onchange=()=>{if(!S.busy)task(token=>load(Number($('visionFiles').value),token));};
$('visionClear').onclick=()=>{stop();closePDF();S.files=[];S.results=[];S.index=-1;S.current=null;S.loaded=false;S.original=null;S.undo=[];S.ignore=[];$('visionFiles').replaceChildren();$('visionCount').textContent='0';canvas.width=canvas.height=1;$('visionEmpty').hidden=false;$('visionOutput').value='';};
bind('visionPrev',token=>page(S.page-1,token));bind('visionNext',token=>page(S.page+1,token));$('visionStop').onclick=stop;
$('visionLanguageSearch').oninput=()=>{const q=$('visionLanguageSearch').value.toLowerCase();for(const label of $('visionLanguages').children)label.hidden=!label.textContent.toLowerCase().includes(q);};
for(const [id,key]of [['visionJoin','join'],['visionDedupe','dedupe'],['visionIndent','indent']])$(id).onclick=()=>{$('visionOutput').value=V.cleanText($('visionOutput').value,{[key]:true});};
$('visionOutputMode').onchange=()=>{if(!S.current)return;const r=S.current;$('visionOutput').value=$('visionOutputMode').value==='table'?(r.rows||V.wordsToRows(r.words||[])).map(x=>x.join('\t')).join('\n'):r.text;};
$('visionCodec').onclick=()=>{const input=$('codecInput');if(input){input.value=$('visionOutput').value;H.showWorkspace('codec');}};
bind('visionImageSave',async()=>save(await png(),(selected()?.name||'image')+'.edited.png','image/png'));
bind('visionToAnalysis',async()=>{const file=new File([await png()],'图文结果.png',{type:'image/png'});H.addFiles([file]);H.showWorkspace('inspection');});
bind('visionCompress',async()=>save(new Uint8Array(await (await blob(canvas,'image/jpeg',Number($('visionQuality').value))).arrayBuffer()),(selected()?.name||'image')+'.jpg','image/jpeg'));
bind('visionCompressBatch',async token=>{if(!S.files.length)throw Error('请先添加图片。');const entries={},errors=[];for(let i=0;i<S.files.length;i++){check(token);try{const c=await image(await read(S.files[i],token));entries[String(i+1).padStart(4,'0')+'_'+safeName(S.files[i].name)+'.jpg']=new Uint8Array(await(await blob(c,'image/jpeg',Number($('visionQuality').value))).arrayBuffer());}catch(e){check(token);errors.push({name:S.files[i].name,error:e.message});}}
 entries['manifest.json']=new TextEncoder().encode(JSON.stringify({quality:Number($('visionQuality').value),errors},null,2));await zipResults(entries,'HexScope-compressed-images.zip');});
bind('visionStitch',async token=>{if(S.files.length<2)throw Error('请添加至少两张同宽图片，按队列顺序排列。');let c=await image(await read(S.files[0],token));for(let i=1;i<S.files.length;i++){
 const next=await image(await read(S.files[i],token));check(token);if(c.width!==next.width)throw Error('拼接图片需要相同宽度。');const a=c.getContext('2d').getImageData(0,Math.max(0,c.height-1501),c.width,Math.min(1501,c.height)),b=next.getContext('2d').getImageData(0,0,next.width,Math.min(1501,next.height));
 const overlap=V.stitchOverlap(a.data,b.data,c.width,a.height,b.height),joined=create(c.width,c.height+next.height-overlap);joined.getContext('2d').drawImage(c,0,0);joined.getContext('2d').drawImage(next,0,c.height-overlap);c=joined;}
 await generated(await png(c),'stitched.png',token);status('长图已拼接，可识别或保存。自动重叠匹配需人工检查。');});
const edit=fn=>{if(S.busy)return;try{remember();fn();S.ignore=[];}catch(e){status(e.message);}};
$('visionUndo').onclick=()=>{if(S.busy)return;const c=S.undo.pop();if(c)display(c);S.ignore=[];};$('visionReset').onclick=()=>{if(S.busy||!S.original)return;display(S.original);S.ignore=[];S.undo=[];};
$('visionRotate').onclick=()=>edit(()=>{const old=copy(canvas);canvas.width=old.height;canvas.height=old.width;ctx().translate(canvas.width,0);ctx().rotate(Math.PI/2);ctx().drawImage(old,0,0);ctx().setTransform(1,0,0,1,0,0);});
$('visionFlip').onclick=()=>edit(()=>{const old=copy(canvas);ctx().clearRect(0,0,canvas.width,canvas.height);ctx().save();ctx().translate(canvas.width,0);ctx().scale(-1,1);ctx().drawImage(old,0,0);ctx().restore();});
$('visionEnhance').onclick=()=>edit(()=>{const data=ctx().getImageData(0,0,canvas.width,canvas.height),mode=$('visionFilter').value;for(let i=0;i<data.data.length;i+=4){const d=data.data,g=.299*d[i]+.587*d[i+1]+.114*d[i+2];for(let k=0;k<3;k++)d[i+k]=mode==='gray'?g:mode==='binary'?(g>150?255:0):mode==='invert'?255-d[i+k]:mode==='contrast'?(d[i+k]-128)*1.6+128:d[i+k];}ctx().putImageData(data,0,0);});
$('visionMark').onclick=()=>edit(()=>{const value=$('visionWatermark').value;if(!value)throw Error('请输入水印文字。');const c=ctx(),size=Math.max(16,canvas.width/24);c.save();c.globalAlpha=Number($('visionOpacity').value);c.fillStyle=$('visionColor').value;c.font=size+'px sans-serif';c.textAlign='center';const tile=$('visionTileMark').checked;
 for(let y=tile?size*2:canvas.height/2;y<canvas.height;y+=tile?size*5:canvas.height)for(let x=tile?size*4:canvas.width/2;x<canvas.width;x+=tile?size*10:canvas.width){c.save();c.translate(x,y);c.rotate(Number($('visionAngle').value)*Math.PI/180);c.fillText(value,0,0);c.restore();}c.restore();});
let gesture=null;
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};}
$('visionTool').onchange=()=>canvas.dataset.tool=$('visionTool').value;
canvas.onpointerdown=e=>{if(!S.loaded||S.busy||e.button!==0)return;const tool=$('visionTool').value,p=point(e);if(tool==='view')return;
 if(tool==='picker'){const rgb=[...ctx().getImageData(Math.min(canvas.width-1,Math.floor(p.x)),Math.min(canvas.height-1,Math.floor(p.y)),1,1).data].slice(0,3);$('visionColorValue').textContent='#'+rgb.map(x=>x.toString(16).padStart(2,'0')).join('')+' · RGB '+rgb.join(',');return;}
 remember();gesture={tool,start:p,points:[p],base:copy(canvas)};canvas.setPointerCapture(e.pointerId);e.preventDefault();};
function draw(end){const g=gesture;if(!g)return;display(g.base);const c=ctx(),a=g.start,x=Math.min(a.x,end.x),y=Math.min(a.y,end.y),w=Math.abs(end.x-a.x),h=Math.abs(end.y-a.y),line=Math.max(2,canvas.width/350);c.save();c.strokeStyle=c.fillStyle=$('visionColor').value;c.lineWidth=line;c.lineCap='round';
 if(['rect','crop','ignore'].includes(g.tool)){if(g.tool!=='rect')c.setLineDash([line*2,line]);c.strokeRect(x,y,w,h);}else if(g.tool==='ellipse'){c.beginPath();c.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);c.stroke();}
 else if(['pen','highlight'].includes(g.tool)){if(g.tool==='highlight'){c.globalAlpha=.3;c.lineWidth=line*8;}c.beginPath();g.points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();}
 else if(g.tool==='arrow'){const angle=Math.atan2(end.y-a.y,end.x-a.x),len=line*6;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(end.x,end.y);for(const t of [-.5,.5]){c.moveTo(end.x,end.y);c.lineTo(end.x-len*Math.cos(angle+t),end.y-len*Math.sin(angle+t));}c.stroke();}
 else if(g.tool==='mosaic'&&w>1&&h>1){const small=create(Math.max(1,Math.ceil(w/15)),Math.max(1,Math.ceil(h/15)));small.getContext('2d').drawImage(g.base,x,y,w,h,0,0,small.width,small.height);c.imageSmoothingEnabled=false;c.drawImage(small,x,y,w,h);}
 else if(g.tool==='text'||g.tool==='number'){c.font=Math.max(20,canvas.width/30)+'px sans-serif';c.fillText(g.tool==='number'?String(S.number):$('visionLabel').value,a.x,a.y);}
 c.restore();return {x:Math.floor(x),y:Math.floor(y),width:Math.floor(w),height:Math.floor(h)};}
canvas.onpointermove=e=>{if(gesture){const p=point(e);gesture.points.push(p);draw(p);}};
canvas.onpointerup=e=>{if(!gesture)return;const g=gesture,r=draw(point(e));if(g.tool==='crop'&&r.width>1&&r.height>1){const c=create(r.width,r.height);c.getContext('2d').drawImage(g.base,r.x,r.y,r.width,r.height,0,0,r.width,r.height);display(c);S.ignore=[];}else if(g.tool==='ignore'){display(g.base);if(r.width&&r.height){S.ignore.push(r);status('已忽略 '+S.ignore.length+' 个区域；只影响 OCR。');}}else if(g.tool==='number')S.number++;gesture=null;};
canvas.onpointercancel=()=>{if(gesture){display(gesture.base);gesture=null;}};
const drop=$('visionDrop');drop.ondragover=e=>{e.preventDefault();e.stopPropagation();drop.classList.add('is-dragging');};drop.ondragleave=()=>drop.classList.remove('is-dragging');drop.ondrop=e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('is-dragging');add([...e.dataTransfer.files]);};
const nav=document.createElement('button');nav.id='visionMode';nav.className='mode';nav.type='button';nav.textContent='图文识别';nav.onclick=()=>H.showWorkspace('vision');document.querySelector('.mode-nav').insertBefore(nav,document.querySelector('.mode-nav>span'));
window.addEventListener('hexscope-workspace',e=>{if(e.detail.name==='vision'){if(!window.hexscopeVision){status('请使用 Windows 便携版运行 OCR、条码和文档导出；图片处理在此页面同样可用。');$('visionLanguages').textContent='离线引擎随便携包内置';}else capabilities().catch(e=>status(e.message));}});
window.hexscopeVision?.onProgress(p=>{if(S.active.has(p.id))$('visionProgress').value=p.progress||0;});
window.addEventListener('pagehide',()=>{stop();closePDF();});window.HexVision={add,load,recognize,stop,capabilities,state:S};
})();
