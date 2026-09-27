/* HexScope CTF 2.0 — binary inspection core. Offsets are [start, end). */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const MAX_FILE = 128 * 1024 * 1024;
  const MAX_HITS = 256;
  const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(a, start = 0, end = a.length) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ a[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function cat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  function eq(a, p, bytes) { return p >= 0 && p + bytes.length <= a.length && bytes.every((v, i) => a[p + i] === v); }
  function str(a, p, n) { return String.fromCharCode(...a.subarray(p, p + n)); }
  function u16(a, p) { return a[p] | a[p + 1] << 8; }
  function b16(a, p) { return a[p] * 256 + a[p + 1]; }
  function u32(a, p) { return (a[p] | a[p + 1] << 8 | a[p + 2] << 16 | a[p + 3] << 24) >>> 0; }
  function b32(a, p) { return (a[p] * 16777216 + a[p + 1] * 65536 + a[p + 2] * 256 + a[p + 3]) >>> 0; }
  function u64(a, p) { const n = u32(a, p) + u32(a, p + 4) * 4294967296; return Number.isSafeInteger(n) ? n : NaN; }
  function hex(n) { return '0x' + n.toString(16).toUpperCase().padStart(8, '0'); }
  const FORMATS = {
    PNG: { exts: ['png', 'apng'], mime: 'image/png', image: true },
    JPEG: { exts: ['jpg', 'jpeg', 'jpe', 'jfif', 'mpo'], mime: 'image/jpeg', image: true },
    GIF: { exts: ['gif'], mime: 'image/gif', image: true },
    WEBP: { exts: ['webp'], mime: 'image/webp', image: true },
    BMP: { exts: ['bmp', 'dib'], mime: 'image/bmp', image: true },
    TIFF: { exts: ['tif', 'tiff'], mime: 'image/tiff', image: true },
    ICO: { exts: ['ico', 'cur'], mime: 'image/x-icon', image: true },
    AVIF: { exts: ['avif'], mime: 'image/avif', image: true },
    HEIF: { exts: ['heic', 'heif', 'hif'], mime: 'image/heif', image: true },
    ZIP: { exts: ['zip', 'zipx'], mime: 'application/zip' },
    DOCX: { exts: ['docx', 'docm', 'dotx', 'dotm'], mime: 'application/zip' },
    XLSX: { exts: ['xlsx', 'xlsm', 'xltx', 'xltm', 'xlsb'], mime: 'application/zip' },
    PPTX: { exts: ['pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm'], mime: 'application/zip' },
    EPUB: { exts: ['epub'], mime: 'application/zip' },
    APK: { exts: ['apk'], mime: 'application/zip' },
    JAR: { exts: ['jar', 'war'], mime: 'application/zip' },
    RAR: { exts: ['rar'], mime: 'application/vnd.rar' },
    '7Z': { exts: ['7z'], mime: 'application/x-7z-compressed' },
    GZIP: { exts: ['gz', 'gzip', 'tgz'], mime: 'application/gzip' },
    PDF: { exts: ['pdf'], mime: 'application/pdf' },
    WAV: { exts: ['wav'], mime: 'audio/wav' },
    AVI: { exts: ['avi'], mime: 'video/x-msvideo' },
    MP4: { exts: ['mp4', 'm4v', 'mov', 'm4a'], mime: 'video/mp4' },
    OGG: { exts: ['ogg', 'oga', 'ogv', 'opus'], mime: 'application/ogg' },
    FLAC: { exts: ['flac'], mime: 'audio/flac' },
    MP3: { exts: ['mp3'], mime: 'audio/mpeg' },
    EXE: { exts: ['exe', 'dll', 'sys', 'scr'], mime: 'application/octet-stream' },
    ELF: { exts: ['elf', 'so', 'bin', ''], mime: 'application/octet-stream' },
    OLE: { exts: ['doc', 'xls', 'ppt', 'msi', 'msg', 'vsd'], mime: 'application/octet-stream' }
  };
  function detect(a, p = 0) {
    if (eq(a, p, [137,80,78,71,13,10,26,10])) return 'PNG';
    if (eq(a, p, [255,216,255])) return 'JPEG';
    if (a[p] === 71 && ['GIF87a','GIF89a'].includes(str(a,p,6))) return 'GIF';
    if (eq(a,p,[66,77])) return 'BMP';
    if (eq(a,p,[80,75,3,4]) || eq(a,p,[80,75,5,6])) return 'ZIP';
    if (eq(a,p,[55,122,188,175,39,28])) return '7Z';
    if (eq(a,p,[82,97,114,33,26,7,0]) || eq(a,p,[82,97,114,33,26,7,1,0])) return 'RAR';
    if (eq(a,p,[31,139,8])) return 'GZIP';
    if (a[p] === 37 && /^%PDF-[12]\.\d/.test(str(a,p,8))) return 'PDF';
    if (a[p] === 82 && str(a,p,4) === 'RIFF') {
      return ({WEBP:'WEBP', WAVE:'WAV', 'AVI ':'AVI'})[str(a,p+8,4)] || null;
    }
    if (eq(a,p,[73,73,42,0]) || eq(a,p,[77,77,0,42]) || eq(a,p,[73,73,43,0]) || eq(a,p,[77,77,0,43])) return 'TIFF';
    if (eq(a,p,[0,0,1,0]) || eq(a,p,[0,0,2,0])) return 'ICO';
    if (a[p+4] === 102 && str(a,p+4,4) === 'ftyp' && u32(a,p) !== 0 && p+16<=a.length) {
      const brand = str(a,p+8,4);
      if (['avif','avis'].includes(brand)) return 'AVIF';
      if (['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)) return 'HEIF';
      return 'MP4';
    }
    if (eq(a,p,[79,103,103,83,0])) return 'OGG';
    if (str(a,p,4)==='fLaC') return 'FLAC';
    if (str(a,p,3)==='ID3') return 'MP3';
    if (eq(a,p,[127,69,76,70])) return 'ELF';
    if (eq(a,p,[208,207,17,224,161,177,26,225])) return 'OLE';
    if (eq(a,p,[77,90]) && p+64<=a.length) {
      const pe = p+u32(a,p+60);
      if (eq(a,pe,[80,69,0,0])) return 'EXE';
    }
    return null;
  }
  function parse(a, start, type, bound = a.length) {
    const warnings = [], regions = [];
    const bad = message => ({ end: null, verified: false, warnings: [message], regions });
    const ok = (end, extra = {}) => ({ end, verified: !warnings.length, warnings, regions, ...extra });
    const region = (s,e,label,kind='body') => { if (regions.length<512) regions.push({start:s,end:e,label,kind}); };
    if (type === 'PNG') {
      let p = start+8, idat = false, first = true, width=0, height=0;
      region(start,p,'PNG 签名','header');
      for (let n=0; n<100000 && p+12<=bound; n++) {
        const len=b32(a,p), t=str(a,p+4,4), end=p+len+12;
        if (!/^[A-Za-z]{4}$/.test(t) || end>bound) return bad('PNG 数据块长度或类型无效，无法确定文件尾。');
        if (first && (t!=='IHDR' || len!==13)) return bad('PNG 缺少合法 IHDR。');
        if (first) {width=b32(a,p+8);height=b32(a,p+12); if(!width||!height) return bad('PNG 尺寸无效。');}
        first=false;
        if (crc32(a,p+4,end-4)!==b32(a,end-4) && warnings.length<10) warnings.push(t+' 的 CRC 校验失败。');
        const meta = !['IHDR','IDAT','IEND','PLTE','tRNS','acTL','fcTL','fdAT'].includes(t);
        region(p,end,t,meta?'metadata':'body');
        if(t==='IDAT') idat=true;
        if(t==='IEND') {
          if(len!==0 || !idat) return bad('PNG 的 IEND/IDAT 结构不完整。');
          return ok(end,{width,height});
        }
        p=end;
      }
      return bad('PNG 未找到完整 IEND，可能已截断或超过结构数量限制。');
    }
    if(type==='JPEG') {
      let p=start+2, entropy=false, frame=false, scan=false, width=0, height=0, mpo=false;
      region(start,p,'SOI','header');
      for(let n=0;n<100000 && p<bound;n++) {
        if(entropy) {
          const begin=p;
          while(p<bound) {
            if(a[p]!==255) {p++;continue;}
            let q=p+1; while(q<bound && a[q]===255)q++;
            if(q>=bound) return bad('JPEG 扫描数据截断。');
            if(a[q]===0 || (a[q]>=208&&a[q]<=215)) {p=q+1;continue;}
            break;
          }
          region(begin,p,'压缩图像数据');
          entropy=false;
        }
        if(p>=bound||a[p]!==255) return bad('JPEG 标记边界无效。');
        const begin=p; while(p<bound&&a[p]===255)p++;
        const marker=a[p++];
        if(marker===217) return frame&&scan?ok(p,{width,height,mpo}):bad('JPEG 缺少图像帧或扫描段。');
        if(marker===216 || marker===0 || marker===undefined) return bad('JPEG 出现异常标记。');
        if(marker===1 || (marker>=208&&marker<=215)) continue;
        if(p+2>bound) return bad('JPEG 段长度截断。');
        const len=b16(a,p), end=p+len;
        if(len<2 || end>bound) return bad('JPEG 段越过文件边界。');
        const meta=(marker>=224&&marker<=239)||marker===254;
        region(begin,end,marker===254?'COM':marker>=224&&marker<=239?'APP'+(marker-224):'FF'+marker.toString(16).toUpperCase(),meta?'metadata':'body');
        if(marker===226 && str(a,p+2,4)==='MPF\0')mpo=true;
        if(marker>=192&&marker<=207&&![196,200,204].includes(marker)) {
          if(len<8) return bad('JPEG 图像帧长度无效。');
          frame=true;height=b16(a,p+3);width=b16(a,p+5);
          if(!width) return bad('JPEG 图像宽度无效。');
        }
        if(marker===218) {if(len<6)return bad('JPEG SOS 长度无效。');scan=true;entropy=true;}
        if(marker===220&&scan) entropy=true;
        p=end;
      }
      return bad('JPEG 未找到有效 EOI，可能已截断或结构过于复杂。');
    }
    if(type==='GIF') {
      if(start+13>bound || !u16(a,start+6)||!u16(a,start+8))return bad('GIF 逻辑屏幕描述符无效。');
      let p=start+13, frames=0;
      if(a[start+10]&128)p+=3*(2**((a[start+10]&7)+1));
      region(start,p,'GIF 文件头与全局调色板','header');
      function blocks() {
        while(p<bound) {const len=a[p++];if(!len)return true;if(p+len>bound)return false;p+=len;}return false;
      }
      for(let n=0;n<100000&&p<bound;n++) {
        const begin=p, tag=a[p++];
        if(tag===59) return frames?ok(p,{width:u16(a,start+6),height:u16(a,start+8)}):bad('GIF 不包含图像帧。');
        if(tag===33) {if(p>=bound)return bad('GIF 扩展截断。');p++;if(!blocks())return bad('GIF 扩展数据截断。');region(begin,p,'GIF 扩展','metadata');}
        else if(tag===44) {
          if(p+9>bound)return bad('GIF 图像描述符截断。');
          const packed=a[p+8];p+=9;
          if(packed&128)p+=3*(2**((packed&7)+1));
          if(p>=bound||a[p]<2||a[p]>8)return bad('GIF LZW 最小码长无效。');
          p++;if(!blocks())return bad('GIF 图像数据截断。');frames++;region(begin,p,'GIF 图像帧');
        } else return bad('GIF 出现未知块。');
      }
      return bad('GIF 未找到结构中的结束标记。');
    }
    if(['WEBP','WAV','AVI'].includes(type)) {
      if(start+12>bound)return bad('RIFF 文件头截断。');
      const end=start+8+u32(a,start+4);
      if(end>bound||end<start+12)return bad('RIFF 声明的长度无效。');
      let p=start+12, content=false;
      region(start,p,'RIFF '+type,'header');
      while(p+8<=end) {
        const name=str(a,p,4),len=u32(a,p+4),next=p+8+len+(len&1);
        if(next>end)return bad('RIFF 数据块超出容器长度。');
        if(type!=='WEBP'||['VP8 ','VP8L','ANMF'].includes(name))content=true;
        region(p,next,name,['EXIF','XMP ','ICCP'].includes(name)?'metadata':'body');p=next;
      }
      if(p!==end||!content)return bad('RIFF 数据块不完整或缺少图像数据。');
      return ok(end);
    }
    if(type==='BMP') {
      if(start+26>bound)return bad('BMP 文件头截断。');
      const size=u32(a,start+2),dib=u32(a,start+14),pixels=u32(a,start+10);
      if(![12,16,40,52,56,64,108,124].includes(dib)||size<14+dib||pixels<14+dib||pixels>=size||start+size>bound) return bad('BMP 大小、DIB 或像素偏移无效。');
      if(dib>=40) {
        const width=u32(a,start+18),height=Math.abs(u32(a,start+22)|0),bpp=u16(a,start+28),compression=u32(a,start+30);
        if(!width||width>0x7fffffff||!height||u16(a,start+26)!==1||![1,4,8,16,24,32].includes(bpp))return bad('BMP 尺寸或位深无效。');
        if(compression===0 && pixels+Math.ceil(width*bpp/32)*4*height>size)return bad('BMP 像素数据不足。');
      }
      region(start,start+pixels,'BMP 文件头','header');region(start+pixels,start+size,'BMP 像素及声明数据');
      return ok(start+size);
    }
    if(type==='ZIP') return parseZip(a,start,bound);
    if(type==='7Z') {
      if(start+32>bound)return bad('7z 起始头截断。');
      if(crc32(a,start+12,start+32)!==u32(a,start+8))return bad('7z 起始头 CRC 无效。');
      const next=start+32+u64(a,start+12),end=next+u64(a,start+20);
      if(!Number.isSafeInteger(end)||next<start+32||end>bound)return bad('7z Next Header 超出边界。');
      if(crc32(a,next,end)!==u32(a,start+28))return bad('7z Next Header CRC 无效。');
      region(start,end,'7z 头部及数据');return ok(end);
    }
    // These signatures do not by themselves provide reliable carving boundaries.
    return {end:null,verified:false,regions:[],warnings:[],unsupported:true};
  }
  const zipEndsCache=new WeakMap();
  function zipEnds(a) {
    if(zipEndsCache.has(a))return zipEndsCache.get(a);
    const ends=[];for(let e=0;e+22<=a.length;e++)if(a[e]===80&&eq(a,e,[80,75,5,6])) {
      ends.push(e);if(ends.length>4096)break;
    }
    zipEndsCache.set(a,ends);return ends;
  }
  function parseZip(a,start,bound=a.length) {
    const fail={end:null,verified:false,regions:[],warnings:['ZIP 目录未通过校验（可能截断、ZIP64、多卷或非常规布局）。']};
    let attempts=0;
    for(const e of zipEnds(a)) {
      if(e<start||e+22>bound)continue;
      if(++attempts>4096)return fail;
      const count=u16(a,e+10),cdSize=u32(a,e+12),cdRel=u32(a,e+16),end=e+22+u16(a,e+20);
      if(end>bound || u16(a,e+4)||u16(a,e+6)||count!==u16(a,e+8)||count===65535||cdSize===0xffffffff||cdRel===0xffffffff)continue;
      const cd=e-cdSize;
      // Standard appended archives use offsets relative to their own first byte.
      // SFX-style archives may use absolute offsets. Accept only these two bases.
      const base=cd-cdRel;
      if(cd<start||(base!==start&&base!==0))continue;
      if(!count) {
        if(e===start&&cdSize===0&&cdRel===0)return {end,eocd:e,centralOffset:cd,verified:true,regions:[],warnings:[],entries:[],zipBase:base};
        continue;
      }
      let p=cd,valid=true,minLocal=Infinity,entries=[],spans=[];
      for(let i=0;i<count;i++) {
        if(p+46>e||!eq(a,p,[80,75,1,2])){valid=false;break;}
        const flags=u16(a,p+8),method=u16(a,p+10),crc=u32(a,p+16),packed=u32(a,p+20),size=u32(a,p+24);
        const nl=u16(a,p+28),xl=u16(a,p+30),cl=u16(a,p+32),local=base+u32(a,p+42);
        if(p+46+nl+xl+cl>e||u16(a,p+34)||packed===0xffffffff||size===0xffffffff||local<start||local+30>cd||!eq(a,local,[80,75,3,4])) {valid=false;break;}
        const lnl=u16(a,local+26),lxl=u16(a,local+28),dataStart=local+30+lnl+lxl,dataEnd=dataStart+packed;
        if(dataEnd>cd||lnl!==nl||u16(a,local+8)!==method||u16(a,local+6)!==flags) {valid=false;break;}
        let nameEqual=true;for(let j=0;j<nl;j++)if(a[local+30+j]!==a[p+46+j]){nameEqual=false;break;}
        if(!nameEqual){valid=false;break;}
        if(!(flags&8) && (u32(a,local+14)!==crc||u32(a,local+18)!==packed||u32(a,local+22)!==size)) {valid=false;break;}
        if(method===0&&!(flags&1)&&(packed!==size||crc32(a,dataStart,dataEnd)!==crc)) {valid=false;break;}
        let spanEnd=dataEnd;
        if(flags&8) {
          let d=dataEnd;if(eq(a,d,[80,75,7,8]))d+=4;
          if(d+12>cd||u32(a,d)!==crc||u32(a,d+4)!==packed||u32(a,d+8)!==size){valid=false;break;}
          spanEnd=d+12;
        }
        minLocal=Math.min(minLocal,local);spans.push([local,spanEnd]);
        const name=dec.decode(a.subarray(p+46,p+46+nl));
        entries.push({name,flags,method,crc,size,packed,dataStart,dataEnd,local,utf8:!!(flags&2048)});
        p+=46+nl+xl+cl;
      }
      if(!valid||p!==e||minLocal!==start)continue;
      spans.sort((x,y)=>x[0]-y[0]);
      if(spans.some((s,i)=>i>0&&s[0]<spans[i-1][1]))continue;
      return {end,eocd:e,centralOffset:cd,verified:true,regions:[{start,end:cd,label:'ZIP 成员',kind:'body'},{start:cd,end,label:'ZIP 中央目录',kind:'body'}],warnings:[],entries,zipBase:base,absoluteOffsets:base===0&&start!==0};
    }
    return fail;
  }
  function zipKind(entries) {
    const names=new Set(entries.map(e=>e.name));
    if(names.has('[Content_Types].xml')) {
      if(names.has('word/document.xml'))return 'DOCX';
      if(names.has('xl/workbook.xml')||names.has('xl/workbook.bin'))return 'XLSX';
      if(names.has('ppt/presentation.xml'))return 'PPTX';
    }
    if(names.has('META-INF/container.xml')&&names.has('mimetype'))return 'EPUB';
    if(names.has('AndroidManifest.xml'))return 'APK';
    if(names.has('META-INF/MANIFEST.MF'))return 'JAR';
    return 'ZIP';
  }
  function entropy(a,start=0,end=a.length) {
    if(end<=start)return 0;
    const counts=new Uint32Array(256);for(let i=start;i<end;i++)counts[a[i]]++;
    let h=0;for(const c of counts)if(c){const p=c/(end-start);h-=p*Math.log2(p);}return h;
  }
  function analyze(a,name='file') {
    if(!(a instanceof Uint8Array))a=new Uint8Array(a);
    if(a.length>MAX_FILE)throw new Error('单文件上限 128 MiB，请先分批或使用桌面取证工具。');
    const type=detect(a),parsed=type?parse(a,0,type):{end:null,regions:[],warnings:[],unsupported:true};
    const actual=type==='ZIP'&&parsed.entries?zipKind(parsed.entries):type;
    const dot=name.lastIndexOf('.'),ext=dot>0?name.slice(dot+1).toLowerCase():'';
    const extensions=actual?FORMATS[actual].exts:[];
    // Generic .zip is valid for ZIP-based document packages too.
    const matches=actual?extensions.includes(ext)||(type==='ZIP'&&['zip','zipx'].includes(ext)):null;
    const findings=[],notes=[...parsed.warnings];
    if(parsed.mpo)notes.push('含 MPF 多图像元数据：后续 JPEG 可能属于合法 MPO，不代表隐写。');
    if(parsed.unsupported)notes.push('该格式仅识别文件头；未实现可靠的文件尾结构解析。');
    if(!type)notes.push(a.length?'未识别文件签名；无法判断扩展名是否匹配。':'文件为空。');
    const tail=parsed.end!==null&&parsed.end<a.length?{start:parsed.end,end:a.length,size:a.length-parsed.end}:null;
    if(tail)notes.push('在解析出的容器终点之后发现 '+tail.size+' 字节；附加数据也可能来自合法扩展。');
    let examined=0,hitLimit=false,attemptLimit=false;
    const ranges=[];
    if(tail)ranges.push({start:tail.start,end:a.length,context:'tail'});
    if(parsed.end!==null && FORMATS[type]?.image) {
      for(const r of parsed.regions)if(r.kind==='metadata')ranges.push({start:r.start,end:r.end,context:'metadata',label:r.label});
    } else if(parsed.end===null) ranges.push({start:1,end:a.length,context:'unknown'});
    ranges.sort((x,y)=>x.start-y.start);
    for(const range of ranges) {
      for(let p=range.start;p<range.end-3;p++) {
        // The first-byte gate keeps a full scan linear for ordinary images.
        if(![137,255,71,66,80,55,82,31,37].includes(a[p]))continue;
        const t=detect(a,p);
        if(!['PNG','JPEG','GIF','BMP','WEBP','ZIP','7Z','RAR','GZIP','PDF','WAV','AVI'].includes(t))continue;
        if(++examined>8192){attemptLimit=true;break;}
        const info=parse(a,p,t,range.end);
        const valid=info.end!==null&&info.verified;
        // Partial PNG/JPEG/BMP signatures are common in arbitrary data. Retain
        // them only at the exact start of the trailer; never call them files.
        if(!valid && !(range.context==='tail'&&p===range.start) && !['RAR','GZIP','PDF','7Z'].includes(t))continue;
        const end=valid?info.end:range.end;
        const fmt=t==='ZIP'&&info.entries?zipKind(info.entries):t;
        const level=valid?(range.context==='tail'&&!parsed.mpo&&parsed.verified?'verified':'embedded'):'signature';
        findings.push({type:fmt,start:p,end,size:end-p,level,context:range.context,contextLabel:range.label||'',
          evidence: valid ? (range.context==='metadata'?'位于 '+range.label+' 元数据中，可能为正常预览图。':'文件结构及边界通过检查；不证明隐写意图。') : '仅发现文件签名；边界未确认，导出范围到当前区域末尾。',
          warnings:info.warnings,entries:info.entries?info.entries.slice(0,500):undefined,
          entryCount:info.entries?.length,zipBase:info.zipBase,absoluteOffsets:info.absoluteOffsets,
          exportable:valid,extension:FORMATS[fmt]?.exts[0]||'bin'});
        if(findings.length>=MAX_HITS){hitLimit=true;break;}
        if(valid)p=end-1; // Do not duplicate members of an already detected archive.
      }
      if(hitLimit||attemptLimit)break;
    }
    if(hitLimit)notes.push('达到 256 条候选上限，剩余区域未扫描。');
    if(attemptLimit)notes.push('达到 8192 次签名验证上限，剩余区域未扫描。');
    let status='clean';
    if(!a.length||(!parsed.unsupported&&parsed.end===null))status='damaged';
    else if(tail||findings.some(f=>f.context!=='metadata'))status='suspect';
    else if(!matches&&actual)status='mismatch';
    else if(!type||parsed.unsupported||notes.length)status='limited';
    const bins=[];
    for(let i=0;i<96;i++) {
      const s=Math.floor(i*a.length/96),e=Math.floor((i+1)*a.length/96);
      bins.push(entropy(a,s,Math.min(e,s+16384)));
    }
    return {name,size:a.length,type:actual,container:type,extension:ext,matches,suggested:extensions[0]||null,
      end:parsed.end,boundaryVerified:!!parsed.verified,status,tail,findings,notes,regions:parsed.regions,
      dimensions:parsed.width?{width:parsed.width,height:parsed.height}:null,
      entropy:entropy(a,0,Math.min(a.length,1048576)),entropySample:Math.min(a.length,1048576),bins,
      complete:!(hitLimit||attemptLimit),head:Array.from(a.subarray(0,32)),foot:Array.from(a.subarray(Math.max(0,a.length-32))),
      archiveEntries:parsed.entries?.slice(0,500),archiveCount:parsed.entries?.length};
  }
  function safeName(name) {
    let s=String(name).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,100);
    if(!s)s='file';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))s='_'+s;return s;
  }
  function uniqueName(name,used) {
    const clean=safeName(name);let out=clean,i=2;
    while(used.has(out.toLowerCase())){const dot=clean.lastIndexOf('.');out=dot>0?clean.slice(0,dot)+'_'+i+clean.slice(dot):clean+'_'+i;i++;}
    used.add(out.toLowerCase());return out;
  }
  function makeZip(files) {
    if(files.length>65534)throw new Error('ZIP 条目太多。');
    const parts=[],central=[],used=new Set();let offset=0;
    for(const f of files) {
      const name=enc.encode(uniqueName(f.name,used)),data=f.data instanceof Uint8Array?f.data:new Uint8Array(f.data);
      if(offset+data.length>512*1024*1024)throw new Error('单次导出上限 512 MiB，请减少选择。');
      const crc=crc32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,2048,true);v.setUint16(12,33,true);
      v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);
      const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,2048,true);cv.setUint16(14,33,true);
      cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);
      parts.push(local,data);central.push(c);offset+=local.length+data.length;
    }
    const cd=cat(central),end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,cd.length,true);v.setUint32(16,offset,true);
    return cat([...parts,cd,end]);
  }
  async function inflateEntry(data,entry,limit=32*1024*1024) {
    if(entry.flags&1)throw new Error('此 ZIP 成员已加密，请导出压缩包后输入密码解压。');
    if(entry.size>limit)throw new Error('解压后的单成员超过 32 MiB 限制，请导出原压缩包。');
    if(entry.method===0) {
      if(data.length!==entry.size||crc32(data)!==entry.crc)throw new Error('ZIP 长度或 CRC 校验失败。');return data;
    }
    if(entry.method!==8)throw new Error('此压缩方法不受支持，请导出原压缩包。');
    if(typeof DecompressionStream==='undefined')throw new Error('浏览器不支持解压，请使用新版 Edge / Chrome 或导出原压缩包。');
    let stream;try {stream=new DecompressionStream('deflate-raw');}catch{throw new Error('浏览器不支持 Deflate 解压，请导出原压缩包。');}
    const reader=new Blob([data]).stream().pipeThrough(stream).getReader(),parts=[];let total=0;
    try {
      while(true) {const {value,done}=await reader.read();if(done)break;total+=value.length;
        if(total>limit||total>entry.size){await reader.cancel();throw new Error('解压大小与声明不符或超过限制。');}parts.push(value);}
    } finally {reader.releaseLock();}
    const out=cat(parts);if(out.length!==entry.size||crc32(out)!==entry.crc)throw new Error('ZIP 长度或 CRC 校验失败。');return out;
  }
  function carve(a,f) {
    const data=a.slice(f.start,f.end);
    if(f.absoluteOffsets) {
      // Rebase SFX-style ZIP offsets in the exported copy; source is untouched.
      const info=parseZip(a,f.start,f.end),v=new DataView(data.buffer);
      const e=info.eocd;
      if(!info.verified||e<f.start)throw new Error('无法重新定位 ZIP 中央目录。');
      let p=info.centralOffset;
      while(p<e) {v.setUint32(p-f.start+42,u32(a,p+42)-f.start,true);p+=46+u16(a,p+28)+u16(a,p+30)+u16(a,p+32);}
      v.setUint32(e-f.start+16,u32(a,e+16)-f.start,true);
    }
    return data;
  }
  const api={MAX_FILE,FORMATS,analyze,detect,parse,parseZip,makeZip,inflateEntry,carve,crc32,cat,safeName,uniqueName,hex,enc};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.HexCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
