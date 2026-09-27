/* Focused CTF checks. Every mutation returns a new byte array. */
(function(root){
  'use strict';
  const C=()=>root.HexCore,T=()=>root.CTF,MiB=1048576;
  const view=a=>new DataView(a.buffer,a.byteOffset,a.byteLength);
  const text=(a,p,n)=>new TextDecoder().decode(a.subarray(p,p+n));
  const integer=(v,min,max,label)=>{v=Number(v);if(!Number.isInteger(v)||v<min||v>max)throw new Error(label+'必须为 '+min+'—'+max+' 的整数。');return v;};
  function packBits(bits,{packing='msb',skip=0}={}) {
    skip=integer(skip,0,32*MiB,'跳过位数');if(!['msb','lsb'].includes(packing))throw new Error('未知装字节顺序。');
    const out=[];let total=0,n=0,value=0,preview='';
    for(const bit of bits){if(bit!==0&&bit!==1)throw new Error('位流只能包含 0/1。');if(total<512)preview+=bit;total++;if(total<=skip)continue;if(packing==='msb')value=(value<<1)|bit;else value|=bit<<n;if(++n===8){out.push(value);n=0;value=0;}if(total>32*MiB)throw new Error('提取位流超过 32 Mi bits 上限。');}
    return {data:new Uint8Array(out),totalBits:total,skippedBits:Math.min(total,skip),remainder:n,bitPreview:preview};
  }
  function pngChunks(a) {
    if(C().detect(a)!=='PNG')throw new Error('请选择 PNG 文件。');const v=view(a),chunks=[];let p=8,ended=false;
    while(p+12<=a.length){const length=v.getUint32(p),type=text(a,p+4,4),end=p+length+12;if(end>a.length||!/^[A-Za-z]{4}$/.test(type))throw new Error('PNG 块长度或名称损坏，偏移 '+C().hex(p)+'。');if(chunks.length>=10000)throw new Error('PNG 超过 10,000 个数据块。');const stored=v.getUint32(end-4),actual=C().crc32(a,p+4,end-4);chunks.push({index:chunks.length,type,start:p,dataStart:p+8,length,end,stored,actual,crcOK:stored===actual});p=end;if(type==='IEND'){if(length)throw new Error('IEND 长度必须为 0。');ended=true;break;}}
    if(!ended)throw new Error('PNG 缺少完整 IEND，无法安全定位数据块。');
    if(chunks[0]?.type!=='IHDR'||chunks[0].length!==13||chunks.filter(c=>c.type==='IHDR').length!==1)throw new Error('PNG IHDR 结构异常。');
    if(!chunks.some(c=>c.type==='IDAT'))throw new Error('PNG 缺少 IDAT 图像数据。');
    return {chunks,end:p,tail:a.length-p,header:{width:v.getUint32(16),height:v.getUint32(20),depth:a[24],color:a[25],compression:a[26],filter:a[27],interlace:a[28]},badCRC:chunks.filter(c=>!c.crcOK).length};
  }
  function pngRaw(a,audit) {return T().inflate(C().cat(audit.chunks.filter(c=>c.type==='IDAT').map(c=>a.subarray(c.dataStart,c.end-4))),'zlib',64*MiB);}
  function pngStride(h,width) {
    const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]},channels={0:1,2:3,3:1,4:2,6:4}[h.color];
    if(h.compression||h.filter||h.interlace||!depths[h.color]?.includes(h.depth))return null;
    return Math.ceil(width*h.depth*channels/8);
  }
  function scanlineCheck(raw,h,width,height) {
    const stride=pngStride(h,width);if(stride===null)return null;
    if((stride+1)*height!==raw.length)return false;for(let p=0;p<raw.length;p+=stride+1)if(raw[p]>4)return false;return true;
  }
  function pngAudit(a){const r=pngChunks(a);r.note='CRC 校验覆盖块类型与数据。错误 CRC 可能源于改尺寸或数据损坏；单独重算 CRC 不能还原丢失内容。';return r;}
  function pngSearch(a,{field='height',max=65535}={}) {
    max=integer(max,1,1000000,'搜索上限');if(!['height','width'].includes(field))throw new Error('只支持单独恢复宽度或高度。');
    const r=pngChunks(a),h=r.header,ihdr=a.slice(12,29),v=view(ihdr),stored=r.chunks[0].stored,offset=field==='height'?8:4,candidates=[];
    let raw=null,rawError=null;try{raw=pngRaw(a,r);}catch(e){rawError=e.message;}
    for(let n=1;n<=max;n++){v.setUint32(offset,n);if(C().crc32(ihdr)===stored){const width=field==='width'?n:h.width,height=field==='height'?n:h.height;candidates.push({width,height,crcMatches:true,scanlines:raw?scanlineCheck(raw,h,width,height):null});}}
    let inferredHeight=null;
    if(raw){const stride=pngStride(h,h.width);if(stride!==null&&h.width>0&&raw.length%(stride+1)===0){const height=raw.length/(stride+1);if(height>0&&height<=1000000&&scanlineCheck(raw,h,h.width,height))inferredHeight=height;}}
    return {...r,field,max,candidates,inferredHeight,inflatedBytes:raw?.length??null,rawError,note:'CRC 搜索假设只有所选尺寸字段变化、原 CRC 保留。行长度推测仅适用于非交错 PNG，不证明原始尺寸；候选均需查看副本验证。'};
  }
  function pngRepair(a,{mode='crc',width,height}={}) {
    const r=pngChunks(a),out=a.slice(),v=view(out);
    if(mode==='crc'){for(const c of r.chunks)v.setUint32(c.end-4,c.actual);return {data:out,changed:r.badCRC,note:'只重算数据块 CRC；保留当前内容与尺寸。'};}
    if(mode!=='dimensions')throw new Error('未知 PNG 修复模式。');
    width=integer(width,1,1000000,'宽度');height=integer(height,1,1000000,'高度');
    const raw=pngRaw(a,r),valid=scanlineCheck(raw,r.header,width,height);
    if(valid!==true)throw new Error(valid===null?'尺寸恢复目前仅支持非交错 PNG。':'新尺寸与 IDAT 解压长度 / 行过滤器不匹配，未生成副本。');
    v.setUint32(16,width);v.setUint32(20,height);v.setUint32(29,C().crc32(out,12,29));
    return {data:out,changed:1,width,height,note:'修改副本 IHDR 宽高与其 CRC；尺寸已通过解压长度和行过滤器检查。其他块保持原样。'};
  }
  function pngChunk(a,index){const r=pngChunks(a),c=r.chunks[integer(index,0,r.chunks.length-1,'块索引')];return {data:a.slice(c.dataStart,c.end-4),name:c.type+'_'+c.start.toString(16)+'.bin',note:'只导出块数据，不包括长度、类型和 CRC。'};}
  function pngPalette(a,{bits=1,packing='msb',skip=0}={}) {
    const r=pngChunks(a),p=r.chunks.find(c=>c.type==='PLTE');if(!p)throw new Error('此 PNG 没有 PLTE 调色板。');if(p.length%3||p.length>768||!p.length)throw new Error('PLTE 长度异常。');bits=integer(bits,1,8,'低位数');
    const palette=a.subarray(p.dataStart,p.end-4),rows=[];for(let i=0;i<palette.length;i+=3)rows.push({index:i/3,r:palette[i],g:palette[i+1],b:palette[i+2]});
    function* stream(){for(const x of palette)for(let b=0;b<bits;b++)yield (x>>>b)&1;}
    return {...packBits(stream(),{packing,skip}),rows,raw:palette.slice(),note:'按 PLTE 原始索引顺序读取 R/G/B 低位，包含可能未使用的颜色；结果仅是候选字节。'};
  }
  function zipAudit(a) {
    const v=view(a);let e=-1;
    for(let p=a.length-22;p>=Math.max(0,a.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===a.length){e=p;break;}
    if(e<0)throw new Error('未找到标准 ZIP 结束目录。请先提取独立 ZIP；ZIP64、多卷和带尾部垃圾的包暂不支持。');
    const count=v.getUint16(e+10,true),cdSize=v.getUint32(e+12,true),relative=v.getUint32(e+16,true),cd=e-cdSize,base=cd-relative;
    if(v.getUint16(e+4,true)||v.getUint16(e+6,true)||count!==v.getUint16(e+8,true)||count===65535||cdSize===0xffffffff||relative===0xffffffff||base<0||cd<0||count>1000)throw new Error('只支持最多 1,000 成员的普通单卷 ZIP，目录偏移必须有效。');
    const copy=a.slice(),cv=view(copy),entries=[];let p=cd,minLocal=Infinity,total=0;
    for(let i=0;i<count;i++){
      if(p+46>e||v.getUint32(p,true)!==0x02014b50)throw new Error('ZIP 中央目录损坏。');
      const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),size=v.getUint32(p+24,true),packed=v.getUint32(p+20,true),nl=v.getUint16(p+28,true),xl=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),local=base+v.getUint32(p+42,true);
      if(p+46+nl+xl+cl>e||local<0||local+30>cd||v.getUint32(local,true)!==0x04034b50)throw new Error('ZIP 本地文件头偏移损坏。');
      const localFlags=v.getUint16(local+6,true),encrypted=!!((flags|localFlags)&1),entry={name:text(a,p+46,nl),flags,localFlags,method,size,packed,central:p,local,encrypted,flagMismatch:flags!==localFlags,verified:false,status:'尚未验证'};
      entries.push(entry);minLocal=Math.min(minLocal,local);total+=size;
      // Normalize ONLY encryption bit 0. Any other mismatch remains a failure.
      cv.setUint16(p+8,flags&~1,true);cv.setUint16(local+6,localFlags&~1,true);p+=46+nl+xl+cl;
    }
    if(p!==e)throw new Error('ZIP 中央目录长度与成员数量不一致。');
    const flagged=entries.filter(x=>x.encrypted).length,r={entries,flagged,canRepair:false,comment:text(a,e+22,a.length-e-22),note:''};
    if(!count){r.note='空 ZIP，没有加密标志。';return r;}
    if(entries.some(x=>(x.flags|x.localFlags)&0x2040)){r.note='含强加密或目录遮蔽标志，本工具不修改。';return r;}
    if(total>128*MiB||entries.some(x=>x.size>32*MiB)){r.note='验证解压超过单成员 32 MiB / 合计 128 MiB 限制。';return r;}
    const parsed=C().parseZip(copy,minLocal);
    if(!parsed.verified||parsed.end!==a.length||parsed.entries.length!==entries.length){for(const x of entries)x.status='结构 / 存储内容校验失败';r.note='清除 bit 0 后结构或内容 CRC 仍不合法；可能真实加密或已损坏，不生成修复副本。';return r;}
    for(let i=0;i<entries.length;i++){
      const dst=entries[i],src=parsed.entries[i];
      try{const data=copy.subarray(src.dataStart,src.dataEnd);let out;if(src.method===0)out=data;else if(src.method===8)out=T().inflate(data,'deflate',Math.min(32*MiB,src.size));else throw new Error('不支持压缩方法 '+src.method);if(out.length!==src.size||C().crc32(out)!==src.crc)throw new Error('解压长度或 CRC 不符');dst.verified=true;dst.status=dst.encrypted?'伪加密已验证（无需密码且 CRC 正确）':'内容 CRC 通过';}
      catch(error){dst.status='无法按明文验证：'+error.message;}
    }
    r.canRepair=flagged>0&&entries.every(x=>x.verified);r.note=r.canRepair?'所有成员均无需密码解压且 CRC 正确，可以清除本地头和中央目录的 bit 0，导出副本。':flagged?'存在未通过验证的成员，不自动清除加密标志。':'没有加密 bit 0；不需要伪加密修复。';return r;
  }
  function zipRepair(a){const r=zipAudit(a);if(!r.canRepair)throw new Error(r.note);const data=a.slice(),v=view(data);for(const e of r.entries){v.setUint16(e.local+6,e.localFlags&~1,true);v.setUint16(e.central+8,e.flags&~1,true);}return {data,changed:r.flagged,note:r.note};}
  const invisible={0x200b:'ZERO WIDTH SPACE',0x200c:'ZERO WIDTH NON-JOINER',0x200d:'ZERO WIDTH JOINER',0x2060:'WORD JOINER',0xfeff:'BOM / ZERO WIDTH NO-BREAK SPACE',0x180e:'MONGOLIAN VOWEL SEPARATOR',0x2061:'FUNCTION APPLICATION',0x2062:'INVISIBLE TIMES',0x2063:'INVISIBLE SEPARATOR',0x2064:'INVISIBLE PLUS',0x00ad:'SOFT HYPHEN',0x202a:'BIDI LRE',0x202b:'BIDI RLE',0x202c:'BIDI PDF',0x202d:'BIDI LRO',0x202e:'BIDI RLO',0x2066:'BIDI LRI',0x2067:'BIDI RLI',0x2068:'BIDI FSI',0x2069:'BIDI PDI'};
  function textLimit(s){if(s.length>4*MiB)throw new Error('文本隐写输入最多 4 Mi 字符。');}
  function textAudit(s) {
    textLimit(s);const counts=new Map();let preview='',offset=0,spaces=0,tabs=0;
    for(const ch of s){const cp=ch.codePointAt(0);if(ch===' ')spaces++;if(ch==='\t')tabs++;if(invisible[cp]){let item=counts.get(cp);if(!item){item={codepoint:'U+'+cp.toString(16).toUpperCase().padStart(4,'0'),hex:cp.toString(16),name:invisible[cp],count:0,offsets:[]};counts.set(cp,item);}item.count++;if(item.offsets.length<24)item.offsets.push(offset);}if(offset<8192)preview+=invisible[cp]?'⟦U+'+cp.toString(16).toUpperCase()+'⟧':ch==='\t'?'⇥':ch===' '?'·':ch;offset+=ch.length;}
    return {characters:s.length,spaces,tabs,rows:[...counts.values()],preview,truncated:s.length>8192,note:'位置是 JavaScript UTF-16 字符索引；这些字符也可用于正常排版。高亮出现不等于存在隐写。'};
  }
  function charFromHex(s){if(!/^[0-9a-f]{1,6}$/i.test(s))throw new Error('字符码填写十六进制，如 200B、200C、0020、0009。');const n=parseInt(s,16);if(n>0x10ffff||(n>=0xd800&&n<=0xdfff))throw new Error('无效 Unicode 码点。');return String.fromCodePoint(n);}
  function textBits(s,{zero='200b',one='200c',scope='all',packing='msb',skip=0}={}) {
    textLimit(s);const z=charFromHex(zero),o=charFromHex(one);if(z===o)throw new Error('0 和 1 的字符不能相同。');if(!['all','line-end'].includes(scope))throw new Error('未知提取范围。');
    if(scope==='line-end'){
      // Walk backward once per line; a greedy unanchored regex can take
      // quadratic time on long runs of spaces followed by visible text.
      const tails=[];for(const line of s.split(/\r?\n/)){let p=line.length;while(p>0&&(line[p-1]===' '||line[p-1]==='\t'))p--;if(p<line.length)tails.push(line.slice(p));}s=tails.join('');
    }
    function* bits(){for(const ch of s)if(ch===z)yield 0;else if(ch===o)yield 1;}
    return {...packBits(bits(),{packing,skip}),note:'只读取指定的两种字符，其余忽略；不足 8 位的末尾丢弃。行尾模式只检查行尾的空格 / Tab。'};
  }
  function base64Padding(s,options={}) {
    textLimit(s);const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',rows=[],bits=[];let validLines=0,skippedLines=0,nonzero=0,coverBytes=0;
    const lines=s.split(/\r?\n/);if(lines.length>200000)throw new Error('Base64 填充位分析最多 200,000 行。');
    for(let i=0;i<lines.length;i++){
      const value=lines[i].replace(/[ \t]/g,'');if(!value)continue;
      if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)){skippedLines++;continue;}
      validLines++;const pad=value.endsWith('==')?2:value.endsWith('=')?1:0;coverBytes+=value.length/4*3-pad;if(!pad)continue;
      const n=pad===2?4:2,index=value.length-pad-1,v=alphabet.indexOf(value[index]),payload=v&((1<<n)-1),bitString=payload.toString(2).padStart(n,'0');if(payload)nonzero++;
      for(const b of bitString)bits.push(Number(b));if(rows.length<300)rows.push({line:i+1,pad,hiddenBits:bitString,nonzero:payload!==0});
    }
    return {...packBits(bits,options),validLines,skippedLines,nonzero,coverBytes,rows,note:'每行一个独立 Base64 值：== 取最后有效字符低 4 位，= 取低 2 位，按高位到低位拼接。规范编码这些位应为 0；非零只是线索。'};
  }
  function textCandidates(s) {
    textLimit(s);if(s.length>MiB)throw new Error('自动编码候选检查最多 1 Mi 字符。');const rows=[],t=s.trim();
    const formats=[['base64',/^[A-Za-z0-9+/\s]+=*$/.test(t)&&t.replace(/\s/g,'').length>=8],['base64url',/^[A-Za-z0-9_\s-]+=*$/.test(t)&&/[_-]/.test(t)],['base32',/^[A-Z2-7\s]+=*$/i.test(t)&&t.length>=8],['hex',/^(?:[\da-f]{2}[\s,:_-]*)+$/i.test(t)&&t.length>=4],['binary',/^[01\s]+$/.test(t)&&t.length>=8],['url',/%[\da-f]{2}/i.test(t)],['unicode',/\\[ux][\da-f{]/i.test(t)],['morse',/^[.\-/\s]+$/.test(t)&&t.length>=2]];
    for(const [format,possible]of formats)if(possible)try{const data=T().decode(format,t);let utf8=true;try{new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{utf8=false;}rows.push({format,length:data.length,utf8,type:C().detect(data),preview:new TextDecoder().decode(data.subarray(0,2048)),hex:T().encode('hex',data.subarray(0,64))});}catch{}
    return {rows,note:'仅测试单层、可严格解码的候选格式；格式匹配不代表确实使用了这种编码。'};
  }
  function imageOperation(a,b,{operation='parity',gain=1,channels='rgb',bits=1,packing='msb',skip=0}={}) {
    const left=T().pixels(a);let right=null;if(['xor','difference','mask'].includes(operation)){if(!b)throw new Error('请先选择第二张图片。');right=T().pixels(b);if(right.width!==left.width||right.height!==left.height)throw new Error('两张图片宽高必须一致；不自动缩放，以免改变像素数据。');}
    if(operation==='border'){
      const map={r:0,g:1,b:2,a:3};if(!/^[rgba]{1,4}$/.test(channels)||new Set(channels).size!==channels.length)throw new Error('通道可使用 r/g/b/a，最多 4 个且不重复。');bits=integer(bits,1,8,'每通道低位');
      function* positions(){const w=left.width,h=left.height;for(let x=0;x<w;x++)yield x;for(let y=1;y<h;y++)yield y*w+w-1;if(h>1)for(let x=w-2;x>=0;x--)yield (h-1)*w+x;if(w>1)for(let y=h-2;y>0;y--)yield y*w;}
      function* stream(){for(const i of positions())for(const ch of channels)for(let k=0;k<bits;k++)yield (left.rgba[i*4+map[ch]]>>>k)&1;}
      return {...packBits(stream(),{packing,skip}),note:'从左上角顺时针读取最外层边框，不重复角像素；通道内从最低位向上读取。'};
    }
    if(!['parity','xor','difference','mask'].includes(operation))throw new Error('未知图像操作。');gain=integer(gain,1,64,'差异增益');const data=new Uint8Array(left.rgba.length);
    for(let p=0;p<data.length;p+=4){if(operation==='parity')data[p]=data[p+1]=data[p+2]=((left.rgba[p]+left.rgba[p+1]+left.rgba[p+2])&1)*255;else if(operation==='mask')data[p]=data[p+1]=data[p+2]=(left.rgba[p]!==right.rgba[p]||left.rgba[p+1]!==right.rgba[p+1]||left.rgba[p+2]!==right.rgba[p+2]||left.rgba[p+3]!==right.rgba[p+3])?255:0;else for(let ch=0;ch<3;ch++)data[p+ch]=operation==='xor'?left.rgba[p+ch]^right.rgba[p+ch]:Math.min(255,Math.abs(left.rgba[p+ch]-right.rgba[p+ch])*gain);data[p+3]=255;}
    return {data,width:left.width,height:left.height,image:true,note:operation==='parity'?'RGB 三通道之和的奇偶性：奇数白、偶数黑。':operation==='mask'?'任一 RGBA 通道不同为白色，相同为黑色。':'逐像素 RGB 运算，输出不透明；仅支持原始 PNG / BMP 像素解析范围。'};
  }
  const api={packBits,pngAudit,pngSearch,pngRepair,pngChunk,pngPalette,zipAudit,zipRepair,textAudit,textBits,base64Padding,textCandidates,imageOperation};
  root.Stego=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
