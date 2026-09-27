/* Extract encoded frame rectangles. Deliberately does not composite animation. */
(function(root){
  'use strict';
  const C=()=>root.HexCore,V=a=>new DataView(a.buffer,a.byteOffset,a.byteLength),note='导出原始局部帧，不叠加前帧、不执行 disposal / blend。位置、延时及合成规则见清单；显示完整动画需按规则合成。';
  function blocks(a,p,end){while(p<end){const n=a[p++];if(!n)return p;if(p+n>end)break;p+=n;}throw new Error('GIF 子块截断。');}
  function gif(a){
    const parsed=C().parse(a,0,'GIF');if(!parsed.verified)throw new Error('GIF 结构损坏，无法定位帧。');
    const v=V(a),width=v.getUint16(6,true),height=v.getUint16(8,true),headEnd=13+((a[10]&128)?3*(1<<((a[10]&7)+1)):0),frames=[];let p=headEnd,gce=null,loop=null;
    while(p<parsed.end){const marker=a[p];if(marker===59)break;
      if(marker===33){const label=a[p+1],end=blocks(a,p+2,parsed.end);if(label===249){if(a[p+2]!==4||end!==p+8)throw new Error('GIF GCE 长度异常。');gce={start:p,end,delayMs:v.getUint16(p+4,true)*10,disposal:(a[p+3]>>2)&7,transparent:!!(a[p+3]&1),transparentIndex:a[p+6]};if(gce.disposal>3)throw new Error('GIF disposal 保留值不支持。');}else if(label===1)gce=null;else if(label===255&&a[p+2]===11){const app=new TextDecoder().decode(a.subarray(p+3,p+14));if(['NETSCAPE2.0','ANIMEXTS1.0'].includes(app)&&end>=p+19&&a[p+14]===3&&a[p+15]===1)loop=v.getUint16(p+16,true);}p=end;continue;}
      if(marker!==44||p+10>parsed.end)throw new Error('GIF 图像块异常。');const left=v.getUint16(p+1,true),top=v.getUint16(p+3,true),w=v.getUint16(p+5,true),h=v.getUint16(p+7,true),tableEnd=p+10+((a[p+9]&128)?3*(1<<((a[p+9]&7)+1)):0),end=blocks(a,tableEnd+1,parsed.end);
      if(!w||!h||left+w>width||top+h>height||w*h>8388608)throw new Error('GIF 帧尺寸无效或超过 8 百万像素。');if(frames.length>=1000)throw new Error('动图最多 1,000 帧。');
      frames.push({index:frames.length,left,top,width:w,height:h,start:p,end,delayMs:gce?.delayMs??0,disposal:gce?.disposal??0,transparent:gce?.transparent??false,localPalette:!!(a[p+9]&128),gce});gce=null;p=end;
    }
    if(!frames.length)throw new Error('GIF 没有图像帧。');return {format:'GIF',width,height,loop,frames,headEnd,note};
  }
  function apng(a){
    const r=root.Stego.pngAudit(a),v=V(a),control=r.chunks.filter(c=>c.type==='acTL');if(r.badCRC)throw new Error('APNG 存在错误 CRC，请先检查 PNG。');if(control.length!==1||control[0].length!==8||control[0].start>r.chunks.find(c=>c.type==='IDAT').start)throw new Error('未找到有效 APNG 动画控制块。');
    const declared=v.getUint32(control[0].dataStart),loop=v.getUint32(control[0].dataStart+4),width=r.header.width,height=r.header.height,frames=[],common=r.chunks.filter(c=>['PLTE','tRNS'].includes(c.type));let sequence=0,seenIDAT=false,current=null,defaultIncluded=false;
    if(!declared||declared>1000)throw new Error('APNG 帧数必须为 1—1,000。');
    for(const c of r.chunks){const p=c.dataStart;
      if(c.type==='fcTL'){
        if(c.length!==26||v.getUint32(p)!==sequence++)throw new Error('APNG fcTL 长度或序号不连续。');if(current&&!current.parts.length)throw new Error('APNG 存在无数据帧。');
        const w=v.getUint32(p+4),h=v.getUint32(p+8),left=v.getUint32(p+12),top=v.getUint32(p+16),num=v.getUint16(p+20),den=v.getUint16(p+22)||100,disposal=a[p+24],blend=a[p+25];
        if(!w||!h||left+w>width||top+h>height||w*h>8388608||disposal>2||blend>1)throw new Error('APNG 帧矩形 / 合成参数无效，或超过 8 百万像素。');
        const usesIDAT=!seenIDAT;if(usesIDAT&&(frames.length||w!==width||h!==height||left||top))throw new Error('包含默认图像的首帧必须覆盖完整画布。');
        current={index:frames.length,width:w,height:h,left,top,delayMs:num/den*1000,delayNumerator:num,delayDenominator:den,disposal,blend,start:c.start,usesIDAT,parts:[]};frames.push(current);if(frames.length>1000)throw new Error('动图最多 1,000 帧。');if(usesIDAT)defaultIncluded=true;
      }else if(c.type==='IDAT'){seenIDAT=true;if(current){if(!current.usesIDAT)throw new Error('APNG 后续帧不得使用 IDAT。');current.parts.push({start:p,end:c.end-4});}}
      else if(c.type==='fdAT'){if(c.length<4||v.getUint32(p)!==sequence++||!seenIDAT||!current||current.usesIDAT)throw new Error('APNG fdAT 序号、顺序或长度异常。');current.parts.push({start:p+4,end:c.end-4});}
    }
    if(frames.length!==declared||frames.some(f=>!f.parts.length))throw new Error('APNG 声明帧数与数据不一致。');return {format:'APNG',width,height,loop,defaultIncluded,frames,common,header:a.slice(16,29),note:note+' PNG 帧只保留 IHDR、PLTE / tRNS、图像数据及 IEND。'};
  }
  function parse(a){const type=C().detect(a);if(type==='GIF')return gif(a);if(type==='PNG')return apng(a);throw new Error('请选择 GIF 或 APNG 动图。');}
  function row(f){const {parts,gce,usesIDAT,...rest}=f;return {...rest,compressedBytes:parts?parts.reduce((n,p)=>n+p.end-p.start,0):f.end-f.start};}
  function inspect(a){const r=parse(a);return {format:r.format,width:r.width,height:r.height,loop:r.loop,defaultIncluded:r.defaultIncluded,frames:r.frames.map(row),note:r.note};}
  function chunk(type,data){const out=new Uint8Array(data.length+12),v=V(out);v.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);v.setUint32(out.length-4,C().crc32(out,4,out.length-4));return out;}
  function frameData(a,r,f){
    if(r.format==='GIF'){const head=a.slice(0,r.headEnd),v=V(head);head.set(new TextEncoder().encode('GIF89a'));v.setUint16(6,f.width,true);v.setUint16(8,f.height,true);const image=a.slice(f.start,f.end),iv=V(image);iv.setUint16(1,0,true);iv.setUint16(3,0,true);return C().cat([head,f.gce?a.slice(f.gce.start,f.gce.end):new Uint8Array(0),image,new Uint8Array([59])]);}
    const ihdr=r.header.slice(),v=V(ihdr);v.setUint32(0,f.width);v.setUint32(4,f.height);return C().cat([a.subarray(0,8),chunk('IHDR',ihdr),...r.common.map(c=>a.subarray(c.start,c.end)),...f.parts.map(p=>chunk('IDAT',a.subarray(p.start,p.end))),chunk('IEND',new Uint8Array(0))]);
  }
  function frame(a,{index=0}={}){const r=parse(a);index=Number(index);if(!Number.isInteger(index)||index<0||index>=r.frames.length)throw new Error('帧序号超出范围。');const f=r.frames[index];return {data:frameData(a,r,f),frame:row(f),name:'frame_'+String(index+1).padStart(4,'0')+(r.format==='GIF'?'.gif':'.png'),mime:r.format==='GIF'?'image/gif':'image/png',note:r.note};}
  function exportAll(a){const r=parse(a),files=[];let total=0;for(const f of r.frames){const data=frameData(a,r,f);total+=data.length;if(total>128*1048576)throw new Error('帧导出总量超过 128 MiB，请逐帧导出。');files.push({name:'frame_'+String(f.index+1).padStart(4,'0')+(r.format==='GIF'?'.gif':'.png'),data});}files.push({name:'frames_manifest.json',data:new TextEncoder().encode(JSON.stringify({format:r.format,width:r.width,height:r.height,loop:r.loop,defaultIncluded:r.defaultIncluded,composited:false,frames:r.frames.map(row),note:r.note},null,2))});return {data:C().makeZip(files),count:r.frames.length,note:r.note};}
  const api={inspect,frame,exportAll};root.AnimationStego=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
