(function(){
  'use strict';
  const H=window.HexApp,{$,esc,size,selected,job,download,toast}=H,T=window.CTF;
  let extraFile=null,pixelData=null,pixelName='',codecResult=null,stringResult=null,conversionHistory=[],metaJob=null;
  const formats={utf8:'UTF-8 文本',base64:'Base64',base64url:'Base64URL',base32:'Base32',hex:'Hex 十六进制',binary:'二进制字节',decimal:'十进制字节',url:'URL 百分号',unicode:'Unicode / \\x 转义',html:'HTML 实体',morse:'摩斯码'};
  for(const id of ['codecFrom','codecTo'])$(id).innerHTML=Object.entries(formats).map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('');$('codecTo').value='base64';
  const valueText=v=>typeof v==='string'?v:JSON.stringify(v);
  function mode(codec){H.showWorkspace(codec?'codec':'inspection');}
  $('inspectMode').onclick=()=>mode(false);$('codecMode').onclick=()=>mode(true);
  function resetExtra(item){if(extraFile===item?.id)return;extraFile=item?.id;pixelData=null;stringResult=null;$('pixelCanvas').hidden=true;$('pixelPlaceholder').hidden=false;$('planeSave').disabled=true;$('lsbSave').disabled=true;$('lsbReanalyze').disabled=true;$('pixelStatus').textContent='';$('lsbPreview').textContent='';$('lsbHits').textContent='';$('stringResults').textContent='';$('stringExport').disabled=true;$('stringStatus').textContent='点击「提取字符串」开始。';$('exifSearch').value='';$('gpsSummary').textContent='';$('exifTable').textContent='';}
  window.addEventListener('hexscope-tab',async e=>{const item=selected();resetExtra(item);if(e.detail.name==='exif'&&item?.result)loadMetadata(item);else if(e.detail.name==='exif')$('exifStatus').textContent='等待文件头分析完成后读取元数据。';});
  function showMetadata(item){
    if(selected()?.id!==item.id)return;const data=item.metadata;
    $('exifStatus').textContent=data?.error?'读取失败：'+data.error:data?.note||'未找到可识别的 EXIF 信息。';
    $('exifExport').disabled=!data||!!data.error;$('metadataBlocks').disabled=!item.result?.regions.some(r=>r.kind==='metadata');
    const gps=data?.gps;$('gpsSummary').innerHTML=gps?'<div class="gps-card"><div><div class="eyebrow">GPS · METADATA COORDINATES</div><strong>'+gps.latitude.toFixed(7)+', '+gps.longitude.toFixed(7)+'</strong><p>'+T.dms(gps.latitude,true)+' · '+T.dms(gps.longitude,false)+'</p><small>纬度 / 经度 · 坐标来自文件元数据，可被修改；未验证实际拍摄位置。</small></div></div>':'<div class="gps-empty">没有可用的 GPS 经纬度。缺失 GPS 不代表经纬度为 0。</div>';
    const fields=($('exifRaw').checked?data?.rawFields:data?.fields)||[],needle=$('exifSearch').value.toLowerCase(),filtered=fields.filter(f=>(f.key+' '+valueText(f.value)).toLowerCase().includes(needle));
    $('exifTable').innerHTML='<div class="subhead">'+filtered.length+' / '+fields.length+' 个字段</div><table class="data-table"><thead><tr><th>标签 / 分组</th><th>值</th></tr></thead><tbody>'+filtered.map(f=>'<tr><td>'+esc(f.key)+'</td><td>'+esc(valueText(f.value))+'</td></tr>').join('')+'</tbody></table>';
  }
  async function loadMetadata(item){
    if(item.metadata){showMetadata(item);return;}if(metaJob?.id===item.id)return;
    $('exifStatus').textContent='正在读取 EXIF / GPS / XMP / IPTC / ICC…';$('exifExport').disabled=true;
    const task=job({kind:'metadata',file:item.file,type:item.result?.container||null});metaJob={id:item.id,task};
    try{item.metadata=(await task.promise).result;}catch(error){item.metadata={error:error.message,fields:[],rawFields:[],gps:null};}finally{if(metaJob?.task===task)metaJob=null;showMetadata(item);}
  }
  $('exifSearch').oninput=()=>{const item=selected();if(item)showMetadata(item);};$('exifRaw').onchange=$('exifSearch').oninput;
  $('exifExport').onclick=()=>{const item=selected();if(item?.metadata)download(JSON.stringify({file:item.path,metadata:item.metadata},null,2),item.file.name+'_EXIF.json','application/json');};
  $('metadataBlocks').onclick=async()=>{const item=selected();if(!item?.result)return;try{const files=[];for(const r of item.result.regions.filter(r=>r.kind==='metadata'))files.push({name:r.label+'_'+r.start.toString(16)+'.bin',data:await H.readFile(item.file,r.start,r.end)});download(H.C.makeZip(files),item.file.name+'_metadata_blocks.zip','application/zip');}catch(e){toast(e.message);}};
  $('stringScan').onclick=async()=>{const item=selected();if(!item)return;$('stringScan').disabled=true;$('stringStatus').textContent='正在扫描字符串…';try{const result=(await job({kind:'strings',file:item.file,options:{min:Number($('stringMin').value),encoding:$('stringEncoding').value,needle:$('stringNeedle').value}}).promise).result;if(selected()?.id!==item.id)return;stringResult=result;$('stringStatus').textContent=result.rows.length+' 条 · 已扫描 '+size(result.scanned)+(result.truncated?' · 达到结果展示上限（3,000 条 / 2 MiB），请使用关键词缩小范围':'');$('stringExport').disabled=false;$('stringResults').innerHTML=result.rows.map((r,i)=>'<div class="string-row"><button class="offset-link" data-string-offset="'+r.offset+'">'+H.C.hex(r.offset)+'</button><code>'+esc(r.text)+'</code><button class="quiet" data-string-codec="'+i+'">解码 ↗</button></div>').join('')||'<p class="muted">未找到满足条件的字符串。</p>';}catch(e){$('stringStatus').textContent='扫描失败：'+e.message;}finally{$('stringScan').disabled=false;}};
  $('stringResults').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.stringOffset!==undefined){H.state.offset=Number(b.dataset.stringOffset);H.showTab('hex');}if(b.dataset.stringCodec!==undefined&&stringResult){$('codecInput').value=stringResult.rows[Number(b.dataset.stringCodec)].text;$('codecFrom').value='utf8';$('codecTo').value='base64';$('codecOperation').value='none';mode(true);}};
  $('stringExport').onclick=()=>{const item=selected();if(item&&stringResult)download(JSON.stringify({file:item.path,...stringResult},null,2),item.file.name+'_strings.json','application/json');};
  function pixelOptions(){return {channels:$('lsbChannels').value,bits:Number($('lsbBits').value),packing:$('lsbPacking').value,order:$('lsbOrder').value,skip:Number($('lsbSkip').value)};}
  async function pixelJob(modeName){
    const item=selected();if(!item)return;for(const id of ['planeRun','lsbRun','lsbAuto'])$(id).disabled=true;$('pixelStatus').textContent='正在读取原始像素…';
    try{const options=modeName==='plane'?{channel:$('planeChannel').value,bit:Number($('planeBit').value)}:pixelOptions(),r=(await job({kind:'pixel',file:item.file,mode:modeName,options},120000).promise).result;if(selected()?.id!==item.id)return;
      $('pixelStatus').textContent=(r.width?r.width+' × '+r.height+' · ':'')+r.note;
      if(modeName==='plane') {const canvas=$('pixelCanvas');canvas.width=r.width;canvas.height=r.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data),r.width,r.height),0,0);canvas.hidden=false;$('pixelPlaceholder').hidden=true;$('planeSave').disabled=false;}
      else if(modeName==='lsb'){pixelData=r.data;pixelName=item.file.name+'_'+options.channels+'_'+options.bits+'bit_'+options.packing+'_'+options.order+'_'+options.skip+'.bin';$('lsbSave').disabled=false;$('lsbReanalyze').disabled=false;$('lsbPreview').textContent='提取 '+size(r.data.length)+' · 文件头识别：'+(r.type||'未知')+'\n\nHEX（前 128 字节）\n'+T.encode('hex',r.data.subarray(0,128))+'\n\nUTF-8 预览（前 2,048 字节，非文本用替代字符显示）\n'+new TextDecoder().decode(r.data.subarray(0,2048));}
      else {item.lsbScan={scope:'逐行 XY，8 通道组合 × 1/2 低位 × 两种装字节顺序，前 256 KiB',hits:r.hits};$('lsbHits').innerHTML='<div class="subhead">'+r.hits.length+' 个组合有签名 / flag 线索；仅是候选。</div>'+r.hits.map((h,i)=>'<div class="candidate"><strong>'+esc(h.params.channels)+' / '+h.params.bits+' bit / '+esc(h.params.packing)+'</strong><p>'+esc(h.type||'无已知文件头')+'</p>'+h.flags.map(f=>'<p class="mono">'+H.C.hex(f.offset)+' · '+esc(f.text)+'</p>').join('')+'<button class="secondary" data-lsb-hit="'+i+'">采用此组合并提取</button></div>').join('');if(!r.hits.length)$('lsbHits').innerHTML+='<p class="muted">未命中这些常见组合；不能据此排除隐写。可手动尝试其他位数、起始位和逐列读取。</p>';}
    }catch(e){$('pixelStatus').textContent='处理失败：'+e.message;}finally{for(const id of ['planeRun','lsbRun','lsbAuto'])$(id).disabled=false;}
  }
  $('planeRun').onclick=()=>pixelJob('plane');$('lsbRun').onclick=()=>pixelJob('lsb');$('lsbAuto').onclick=()=>pixelJob('auto');
  $('planeSave').onclick=()=>{const item=selected();if(item)$('pixelCanvas').toBlob(blob=>{if(blob)download(blob,item.file.name+'_plane.png','image/png');});};
  $('lsbSave').onclick=()=>{if(pixelData)download(pixelData,pixelName);};
  $('lsbReanalyze').onclick=()=>{if(pixelData){H.addFiles([new File([pixelData],pixelName)]);toast('已将 LSB 字节加入文件队列。');}};
  $('lsbHits').onclick=e=>{const b=e.target.closest('[data-lsb-hit]'),item=selected();if(!b||!item?.lsbScan)return;const p=item.lsbScan.hits[Number(b.dataset.lsbHit)].params;for(const [k,id]of Object.entries({channels:'lsbChannels',bits:'lsbBits',packing:'lsbPacking',order:'lsbOrder',skip:'lsbSkip'}))$(id).value=String(p[k]);pixelJob('lsb');};
  $('codecRun').onclick=async()=>{
    $('codecRun').disabled=true;$('codecStatus').textContent='正在转换…';
    const options={text:$('codecInput').value,from:$('codecFrom').value,to:$('codecTo').value,operation:$('codecOperation').value,key:$('codecKey').value,shift:Number($('codecShift').value)};
    try{const result=(await job({kind:'convert',options},120000).promise).result;codecResult=result;$('codecOutput').value=result.text.length>2*1024*1024?result.text.slice(0,2*1024*1024):result.text;$('codecStatus').textContent=size(result.inputBytes)+' → '+size(result.outputBytes)+(result.text.length>2*1024*1024?' · 文本预览截断，保存输出文本可得完整结果。 ':' · ')+result.note;for(const id of ['codecNext','codecTextSave','codecBytesSave'])$(id).disabled=false;conversionHistory.unshift(formats[options.from]+' → '+options.operation+' → '+formats[options.to]+' · '+size(result.outputBytes));conversionHistory=conversionHistory.slice(0,20);$('codecHistory').innerHTML=conversionHistory.map(s=>'<li>'+esc(s)+'</li>').join('');}
    catch(e){codecResult=null;$('codecOutput').value='';$('codecStatus').textContent='转换失败：'+e.message;for(const id of ['codecNext','codecTextSave','codecBytesSave'])$(id).disabled=true;}
    finally{$('codecRun').disabled=false;}
  };
  function invalidateCodec(){codecResult=null;$('codecOutput').value='';for(const id of ['codecNext','codecTextSave','codecBytesSave'])$(id).disabled=true;}
  $('codecSwap').onclick=()=>{const from=$('codecFrom').value;$('codecFrom').value=$('codecTo').value;$('codecTo').value=from;$('codecInput').value=codecResult?.text||$('codecOutput').value;$('codecOperation').value='none';invalidateCodec();};
  $('codecOperation').onchange=()=>{const operation=$('codecOperation').value;if(['md5','sha1','sha256','sha512','crc32','rot13','rot47','caesar','caesar-all','atbash','inflate'].includes(operation))$('codecTo').value='utf8';if(['gzip','zlib'].includes(operation))$('codecTo').value='base64';invalidateCodec();};
  for(const id of ['codecInput','codecKey','codecShift'])$(id).addEventListener('input',invalidateCodec);
  for(const id of ['codecFrom','codecTo'])$(id).addEventListener('change',invalidateCodec);
  $('codecNext').onclick=()=>{if(codecResult){$('codecInput').value=codecResult.text;$('codecFrom').value=$('codecTo').value;$('codecTo').value='utf8';$('codecOperation').value='none';}};
  $('codecTextSave').onclick=()=>{if(codecResult)download(codecResult.text,'HexScope_conversion.txt','text/plain;charset=utf-8');};$('codecBytesSave').onclick=()=>{if(codecResult)download(codecResult.data,'HexScope_conversion.bin');};
  $('codecFileBtn').onclick=()=>$('codecFile').click();$('codecFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('编码工作台载入文件上限 1 MiB；较大文件请在十六进制页先切片。');$('codecInput').value=T.encode('hex',new Uint8Array(await file.arrayBuffer()));$('codecFrom').value='hex';$('codecTo').value='base64';$('codecOperation').value='none';$('codecStatus').textContent='已载入 '+file.name+' · '+size(file.size);}catch(e){toast(e.message);}finally{e.target.value='';}};
})();
