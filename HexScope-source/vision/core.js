(function(root){
'use strict';
function cleanText(value,{join=false,dedupe=false,indent=false}={}){
 let lines=String(value).replace(/\r\n?/g,'\n').split('\n').map(line=>line.trimEnd());
 if(dedupe){const seen=new Set();lines=lines.filter(line=>!line.trim()||(!seen.has(line.trim())&&seen.add(line.trim())));}
 let out=lines.join('\n');if(join)out=out.split(/\n\s*\n/).map(para=>para.replace(/(?<=[\u3400-\u9fff])\n(?=[\u3400-\u9fff])/g,'').replace(/\n/g,' ')).join('\n\n');
 if(indent)out=out.split('\n').map(x=>x.trim()?'　　'+x.trim():x).join('\n');return out;
}
function wordsToRows(words){
 const good=words.filter(x=>x&&x.text&&x.bbox&&Object.values(x.bbox).every(Number.isFinite)).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0),lines=[];
 for(const word of good){const b=word.bbox,mid=(b.y0+b.y1)/2,h=Math.max(1,b.y1-b.y0);let line=lines.find(x=>Math.abs(x.y-mid)<=Math.min(x.height,h)*.5);
  if(!line){line={y:mid,height:h,words:[]};lines.push(line);}line.words.push(word);}
 const cells=lines.sort((a,b)=>a.y-b.y).map(line=>{const row=[];for(const word of line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0)){
  const last=row.at(-1);if(last&&word.bbox.x0-last.end<line.height*1.5){last.text+=' '+word.text;last.end=word.bbox.x1;}else row.push({text:word.text,start:word.bbox.x0,end:word.bbox.x1});}return row;});
 const anchors=[];for(const row of cells)for(const cell of row)if(!anchors.some(x=>Math.abs(x-cell.start)<12))anchors.push(cell.start);anchors.sort((a,b)=>a-b);
 return cells.map(cells=>{const row=Array(anchors.length).fill('');for(const c of cells){let best=0;for(let i=1;i<anchors.length;i++)if(Math.abs(anchors[i]-c.start)<Math.abs(anchors[best]-c.start))best=i;row[best]+=(row[best]?' ':'')+c.text;}return row;});
}
function csv(rows){return '\ufeff'+rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
function tiles(width,height,maxPixels=7000000,overlap=80){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>100000000)throw Error('图片尺寸无效或超过 1 亿像素。');
 const w=Math.min(width,Math.floor(Math.sqrt(maxPixels))),h=Math.min(height,Math.floor(maxPixels/w)),out=[];
 for(let y=0;;y+=Math.max(1,h-overlap)){for(let x=0;;x+=Math.max(1,w-overlap)){out.push({x,y,width:Math.min(w,width-x),height:Math.min(h,height-y)});if(x+w>=width)break;}if(y+h>=height)break;}
 return out;
}
function stitchOverlap(a,b,width,heightA,heightB,{maxOverlap=1500,minOverlap=20}={}){
 const limit=Math.min(maxOverlap,heightA-1,heightB-1),stepX=Math.max(1,Math.floor(width/200));let best={overlap:0,error:Infinity};
 for(let n=minOverlap;n<=limit;n++){let error=0,count=0,variation=0,prior=-1;
  for(let y=0;y<n;y+=Math.max(1,Math.floor(n/12)))for(let x=0;x<width;x+=stepX){const ai=((heightA-n+y)*width+x)*4,bi=(y*width+x)*4;let v=0;for(let k=0;k<3;k++){error+=Math.abs(a[ai+k]-b[bi+k]);v+=b[bi+k];count++;}if(prior>=0)variation+=Math.abs(v-prior);prior=v;}
  const score=error/count;if(variation/count>1&&score<best.error)best={overlap:n,error:score};
 }return best.error<8?best.overlap:0;
}
const api={cleanText,wordsToRows,csv,tiles,stitchOverlap};if(typeof module==='object'&&module.exports)module.exports=api;else root.HexVisionCore=api;
})(typeof window==='object'?window:globalThis);
