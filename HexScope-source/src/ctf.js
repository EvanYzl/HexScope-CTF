/* CTF utilities: byte-preserving conversions, metadata, strings and pixel analysis. */
(function(root){
  'use strict';
  const enc=new TextEncoder(),dec=new TextDecoder(),C=()=>root.HexCore;
  const b64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',b32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const MORSE={A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..',0:'-----',1:'.----',2:'..---',3:'...--',4:'....-',5:'.....',6:'-....',7:'--...',8:'---..',9:'----.','.':'.-.-.-',',':'--..--','?':'..--..','!':'-.-.--','/':'-..-.','-':'-....-','@':'.--.-.','(':'-.--.',')':'-.--.-',':':'---...','=':'-...-','+':'.-.-.','_':'..--.-'};
  function baseEncode(a,alphabet,bits,pad) {let acc=0,n=0,s='';for(const v of a){acc=(acc<<8)|v;n+=8;while(n>=bits){n-=bits;s+=alphabet[(acc>>>n)&((1<<bits)-1)];}}if(n)s+=alphabet[(acc<<(bits-n))&((1<<bits)-1)];while(pad&&s.length%pad)s+='=';return s;}
  function baseDecode(s,alphabet,bits,pad) {
    s=s.replace(/\s/g,'');const first=s.indexOf('='),raw=first<0?s:s.slice(0,first);
    if(first>=0 && (!/^=+$/.test(s.slice(first))||s.length%pad))throw new Error('Base 编码填充位置不正确。');
    let acc=0,n=0,out=[];for(const ch of raw){const v=alphabet.indexOf(ch);if(v<0)throw new Error('Base 编码含非法字符。');acc=(acc<<bits)|v;n+=bits;if(n>=8){n-=8;out.push((acc>>>n)&255);}}
    const a=new Uint8Array(out),canonical=baseEncode(a,alphabet,bits,pad);
    if(canonical.replace(/=+$/,'')!==raw || (first>=0&&canonical!==s))throw new Error('Base 编码长度或末尾位不合法。');return a;
  }
  function decode(format,text) {
    if(text.length>4*1024*1024)throw new Error('文本输入上限 4 MiB 字符，请缩小范围。');
    let s=text.trim();
    if(format==='utf8')return enc.encode(text);
    if(format==='hex') {s=s.replace(/(?:0x|\\x)/gi,'').replace(/[\s,:_-]/g,'');if(s.length%2||!/^[\da-f]*$/i.test(s))throw new Error('十六进制需要成对字节，例如 66 6C 61 67。');return Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));}
    if(format==='base64')return baseDecode(s,b64,6,4);
    if(format==='base64url') {if(/[+/]/.test(s))throw new Error('Base64URL 请使用 - 和 _。');return baseDecode(s.replace(/-/g,'+').replace(/_/g,'/'),b64,6,4);}
    if(format==='base32')return baseDecode(s.toUpperCase(),b32,5,8);
    if(format==='binary') {s=s.replace(/\s/g,'');if(s.length%8||!/^[01]*$/.test(s))throw new Error('二进制应每 8 位组成一个字节。');return Uint8Array.from(s.match(/.{8}/g)||[],x=>parseInt(x,2));}
    if(format==='decimal') {const tokens=s?s.split(/[\s,;]+/):[];if(tokens.some(v=>!/^\d+$/.test(v)||Number(v)>255))throw new Error('十进制字节需在 0—255 之间。');return Uint8Array.from(tokens,Number);}
    if(format==='url')return enc.encode(decodeURIComponent(text));
    if(format==='unicode')return enc.encode(text.replace(/\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})|\\x([\da-f]{2})|\\([nrt\\])/gi,(m,cp,u,x,c)=>cp?String.fromCodePoint(parseInt(cp,16)):u||x?String.fromCharCode(parseInt(u||x,16)):({n:'\n',r:'\r',t:'\t','\\':'\\'})[c]));
    if(format==='html')return enc.encode(text.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/gi,(m,x,n,k)=>x||n?String.fromCodePoint(parseInt(x||n,x?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[k.toLowerCase()]));
    if(format==='morse') {const map=Object.fromEntries(Object.entries(MORSE).map(([k,v])=>[v,k]));return enc.encode(s.split(/\s*\/\s*/).map(word=>word.split(/\s+/).filter(Boolean).map(code=>{if(!map[code])throw new Error('无法识别摩斯码：'+code);return map[code];}).join('')).join(' '));}
    throw new Error('未知输入格式。');
  }
  function encode(format,a) {
    if(format==='utf8')return dec.decode(a);
    if(format==='hex')return Array.from(a,x=>x.toString(16).padStart(2,'0')).join(' ');
    if(format==='base64')return baseEncode(a,b64,6,4);
    if(format==='base64url')return baseEncode(a,b64,6,0).replace(/\+/g,'-').replace(/\//g,'_');
    if(format==='base32')return baseEncode(a,b32,5,8);
    if(format==='binary')return Array.from(a,x=>x.toString(2).padStart(8,'0')).join(' ');
    if(format==='decimal')return Array.from(a).join(' ');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(a);
    if(format==='url')return encodeURIComponent(text);
    if(format==='unicode')return text.split('').map(ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0')).join('');
    if(format==='html')return Array.from(text,ch=>'&#'+ch.codePointAt(0)+';').join('');
    if(format==='morse')return text.toUpperCase().split(/\s+/).map(word=>Array.from(word,ch=>{if(!MORSE[ch])throw new Error('摩斯码不支持字符：'+ch);return MORSE[ch];}).join(' ')).join(' / ');
    throw new Error('未知输出格式。');
  }
  function md5(a) {
    const n=Math.ceil((a.length+9)/64)*64,data=new Uint8Array(n);data.set(a);data[a.length]=128;const dv=new DataView(data.buffer);dv.setUint32(n-8,a.length*8,true);dv.setUint32(n-4,Math.floor(a.length/536870912),true);
    let h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476];const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21],ks=Array.from({length:64},(_,i)=>(Math.abs(Math.sin(i+1))*4294967296)>>>0);
    for(let p=0;p<n;p+=64){let [a0,b,c,d]=h;for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|(~b&d);g=i;}else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}else if(i<48){f=b^c^d;g=(3*i+5)%16;}else{f=c^(b|~d);g=7*i%16;}const temp=d,x=(a0+f+ks[i]+dv.getUint32(p+g*4,true))|0,s=shifts[Math.floor(i/16)*4+i%4];d=c;c=b;b=(b+((x<<s)|(x>>>(32-s))))|0;a0=temp;}h=[(h[0]+a0)|0,(h[1]+b)|0,(h[2]+c)|0,(h[3]+d)|0];}
    return h.map(v=>[0,8,16,24].map(s=>((v>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
  }
  function inflate(a,format='auto',limit=16*1024*1024) {
    const F=root.fflate;if(!F)throw new Error('压缩库未加载。');
    if(format==='auto')format=a[0]===31&&a[1]===139?'gzip':a.length>=2&&((a[0]<<8)+a[1])%31===0?'zlib':'deflate';
    const Klass={gzip:F.Gunzip,zlib:F.Unzlib,deflate:F.Inflate}[format];if(!Klass)throw new Error('未知压缩格式。');
    let total=0,parts=[];const stream=new Klass((data)=>{total+=data.length;if(total>limit)throw new Error('解压数据超过 '+Math.round(limit/1048576)+' MiB 限制。');parts.push(data);});
    if(!a.length)throw new Error('压缩数据为空。');
    for(let p=0;p<a.length;p+=1024)stream.push(a.subarray(p,p+1024),p+1024>=a.length);
    const out=C().cat(parts);
    if(format==='zlib'){let x=1,y=0;for(const v of out){x=(x+v)%65521;y=(y+x)%65521;}if(a.length<6||new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(a.length-4)!==((y*65536+x)>>>0))throw new Error('Zlib Adler-32 校验失败。');}
    if(format==='gzip'){const dv=new DataView(a.buffer,a.byteOffset,a.byteLength);if(a.length<18||dv.getUint32(a.length-8,true)!==C().crc32(out)||dv.getUint32(a.length-4,true)!==out.length)throw new Error('GZIP CRC/长度校验失败，或含多个成员。');}
    return out;
  }
  async function convert({text,from='utf8',to='base64',operation='none',key='',shift=13}) {
    let a=decode(from,text),note='';
    if(operation==='xor'){const k=key.startsWith('hex:')?decode('hex',key.slice(4)):enc.encode(key);if(!k.length)throw new Error('XOR 密钥不能为空；十六进制密钥使用 hex: 前缀。');a=Uint8Array.from(a,(v,i)=>v^k[i%k.length]);}
    else if(operation==='reverse')a=a.slice().reverse();
    else if(['rot13','rot47','caesar','atbash','caesar-all'].includes(operation)) {
      const s=new TextDecoder('utf-8',{fatal:true}).decode(a),rotate=n=>s.replace(/[a-z]/gi,ch=>{const base=ch<='Z'?65:97;return String.fromCharCode((ch.charCodeAt(0)-base+n%26+26)%26+base);});
      if(operation==='rot13')a=enc.encode(rotate(13));
      else if(operation==='caesar'){if(!Number.isInteger(Number(shift)))throw new Error('Caesar 位移需为整数。');a=enc.encode(rotate(Number(shift)));}
      else if(operation==='caesar-all')a=enc.encode(Array.from({length:26},(_,i)=>String(i).padStart(2,'0')+'  '+rotate(i)).join('\n'));
      else if(operation==='rot47')a=enc.encode(s.replace(/[!-~]/g,ch=>String.fromCharCode(33+(ch.charCodeAt(0)-33+47)%94)));
      else a=enc.encode(s.replace(/[a-z]/gi,ch=>String.fromCharCode((ch<='Z'?90:122)-(ch.charCodeAt(0)-(ch<='Z'?65:97)))));
    } else if(operation==='md5')a=enc.encode(md5(a));
    else if(operation.startsWith('sha')) {const alg={sha1:'SHA-1',sha256:'SHA-256',sha512:'SHA-512'}[operation];if(!alg)throw new Error('未知摘要算法。');a=enc.encode(Array.from(new Uint8Array(await crypto.subtle.digest(alg,a)),v=>v.toString(16).padStart(2,'0')).join(''));}
    else if(operation==='crc32')a=enc.encode(C().crc32(a).toString(16).padStart(8,'0'));
    else if(operation==='inflate')a=inflate(a);
    else if(operation==='gzip')a=root.fflate.gzipSync(a,{mtime:0});
    else if(operation==='zlib')a=root.fflate.zlibSync(a);
    else if(operation!=='none')throw new Error('未知操作。');
    if(to==='utf8')try{new TextDecoder('utf-8',{fatal:true}).decode(a);}catch{note='包含非 UTF-8 字节，文本用替代字符预览；下载原始字节可无损保存，或改用 Hex 输出。';}
    const output=encode(to,a);return {text:output,data:a,note,inputBytes:decode(from,text).length,outputBytes:a.length};
  }
  function strings(a,{min=4,encoding='ascii',needle='',limit=3000}={}) {
    min=Number(min);if(!Number.isInteger(min)||min<2||min>256)throw new Error('最短字符串长度为 2—256。');
    if(!['ascii','utf16le','utf16be'].includes(encoding))throw new Error('未知字符串编码。');
    if(needle.length>256)throw new Error('字符串关键词最多 256 字符。');
    const rows=[],filter=needle.toLowerCase();let truncated=false,scanned=0,totalChars=0;
    const add=(start,end,s)=>{if(s.length>=min&&(!filter||s.toLowerCase().includes(filter))){if(rows.length>=limit||totalChars+s.length>2*1024*1024){truncated=true;return false;}rows.push({offset:start,end,text:s,length:s.length,encoding});totalChars+=s.length;}return true;};
    const step=encoding.startsWith('utf16')?2:1;
    // UTF-16 ASCII runs are checked at both byte alignments.
    for(let alignment=0;alignment<step;alignment++) {
      let start=-1,s='';
      for(let i=alignment;i+step<=a.length;i+=step){scanned=Math.max(scanned,i+step);const v=step===1?a[i]:encoding==='utf16le'?a[i]+a[i+1]*256:a[i]*256+a[i+1];
        if(v>=32&&v<=126){if(start<0)start=i;s+=String.fromCharCode(v);if(s.length===16384){if(!add(start,i+step,s))return {rows,truncated,scanned};const overlap=Math.max(min-1,filter.length-1);s=s.slice(-overlap);start=i+step-overlap*step;}}else {if(start>=0&&!add(start,i,s))return {rows,truncated,scanned};start=-1;s='';}}
      if(start>=0&&!add(start,a.length,s))break;
    }
    rows.sort((a,b)=>a.offset-b.offset);return {rows,truncated,scanned};
  }
  function flatten(value,prefix='',rows=[],depth=0) {
    if(depth>12)return rows;
    if(value&&typeof value==='object'&&!Array.isArray(value)&&!ArrayBuffer.isView(value)) {for(const [k,v]of Object.entries(value))flatten(v,prefix?prefix+'.'+k:k,rows,depth+1);}
    else {let raw=value;if(ArrayBuffer.isView(value))raw={binaryLength:value.byteLength,hexPreview:Array.from(new Uint8Array(value.buffer,value.byteOffset,Math.min(value.byteLength,256)),x=>x.toString(16).padStart(2,'0')).join(' '),previewOnly:true};else if(Array.isArray(value)&&value.length>1024)raw={length:value.length,preview:value.slice(0,1024),previewOnly:true};rows.push({key:prefix,value:raw});}
    return rows;
  }
  async function metadata(a,type) {
    if(!root.exifr)throw new Error('EXIF 解析库未加载。');
    const opts={tiff:true,ifd0:true,ifd1:true,exif:true,gps:true,interop:true,xmp:true,icc:true,iptc:true,jfif:true,ihdr:true,makerNote:true,userComment:true,mergeOutput:false,reviveValues:false,sanitize:false,silentErrors:false,skip:[]};
    let input=a;
    if(type==='WEBP') {let p=12;input=null;while(p+8<=a.length){const n=new DataView(a.buffer,a.byteOffset+p+4,4).getUint32(0,true);if(p+8+n>a.length)break;if(String.fromCharCode(...a.subarray(p,p+4))==='EXIF'){input=a.subarray(p+8,p+8+n);if(String.fromCharCode(...input.subarray(0,6))==='Exif\0\0')input=input.subarray(6);break;}p+=8+n+(n&1);}if(!input)return {fields:[],rawFields:[],gps:null,note:'此 WebP 未找到 EXIF 块；XMP 等区块可在结构列表中另行导出。'};}
    if(!['JPEG','PNG','TIFF','AVIF','HEIF','WEBP'].includes(type))return {fields:[],rawFields:[],gps:null,note:'此格式不在 EXIF 解析范围内。'};
    const data=await root.exifr.parse(input,opts)||{},raw=await root.exifr.parse(input,{...opts,translateKeys:false,translateValues:false})||{};
    let gps=null;try{const g=await root.exifr.gps(input);if(g&&Number.isFinite(g.latitude)&&Math.abs(g.latitude)<=90&&Number.isFinite(g.longitude)&&Math.abs(g.longitude)<=180)gps={latitude:g.latitude,longitude:g.longitude};}catch{}
    return {fields:flatten(data),rawFields:flatten(raw),gps,note:'exifr 7.1.3 · 标准及已知 EXIF / GPS / XMP / IPTC / ICC 字段。专有 MakerNote 二进制内容只做预览；原始元数据块可另行导出。'};
  }
  function dms(value,isLatitude=true) {const sec=Math.round(Math.abs(value)*3600*10000)/10000,d=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return d+'° '+m+'′ '+s.toFixed(4)+'″ '+(isLatitude?(value<0?'S':'N'):(value<0?'W':'E'));}
  function pixels(a) {
    const type=C().detect(a),dv=new DataView(a.buffer,a.byteOffset,a.byteLength);let width,height,rgba;
    if(type==='PNG') {
      const parsed=C().parse(a,0,'PNG');if(!parsed.verified)throw new Error('PNG 结构或 CRC 无效，像素解析已停止。');
      width=dv.getUint32(16);height=dv.getUint32(20);const depth=a[24],color=a[25],channels={0:1,2:3,3:1,4:2,6:4}[color];
      if(depth!==8||!channels||a[26]||a[27]||a[28])throw new Error('当前原始像素解析支持 8 位、非交错 PNG。请勿重存图片后再取证，以免改变隐写数据。');
      if(width*height>8*1024*1024)throw new Error('像素分析上限 8 百万像素。');
      const idat=[];let palette=null,alpha=null,animated=false;
      for(let p=8;p+12<=parsed.end;){const n=dv.getUint32(p),t=String.fromCharCode(...a.subarray(p+4,p+8));if(t==='IDAT')idat.push(a.subarray(p+8,p+8+n));if(t==='PLTE')palette=a.subarray(p+8,p+8+n);if(t==='tRNS')alpha=a.subarray(p+8,p+8+n);if(t==='acTL')animated=true;p+=n+12;}
      const stride=width*channels,raw=inflate(C().cat(idat),'zlib',(stride+1)*height),samples=new Uint8Array(stride*height);
      if(raw.length!==(stride+1)*height)throw new Error('PNG 解压长度与尺寸不一致。');
      for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw new Error('PNG 行过滤器无效。');for(let x=0;x<stride;x++){const i=y*stride+x,aa=x>=channels?samples[i-channels]:0,b=y?samples[i-stride]:0,c=y&&x>=channels?samples[i-stride-channels]:0;let v=0;if(filter===1)v=aa;else if(filter===2)v=b;else if(filter===3)v=(aa+b)>>1;else if(filter===4){const p=aa+b-c,pa=Math.abs(p-aa),pb=Math.abs(p-b),pc=Math.abs(p-c);v=pa<=pb&&pa<=pc?aa:pb<=pc?b:c;}samples[i]=(raw[y*(stride+1)+1+x]+v)&255;}}
      rgba=new Uint8Array(width*height*4);
      for(let i=0,p=0;i<samples.length;i+=channels,p+=4){let r,g,b,al=255;
        if(color===0||color===4){r=g=b=samples[i];if(color===4)al=samples[i+1];else if(alpha&&alpha.length>=2&&r===(alpha[0]*256+alpha[1]))al=0;}
        else if(color===2||color===6){r=samples[i];g=samples[i+1];b=samples[i+2];if(color===6)al=samples[i+3];else if(alpha?.length===6&&r===alpha[1]&&g===alpha[3]&&b===alpha[5])al=0;}
        else {const index=samples[i];if(!palette||index*3+2>=palette.length)throw new Error('PNG 调色板索引无效。');r=palette[index*3];g=palette[index*3+1];b=palette[index*3+2];al=alpha?.[index]??255;}
        rgba.set([r,g,b,al],p);
      }
      return {width,height,rgba,note:(animated?'APNG 仅分析默认图像。':'')+'读取未经过浏览器颜色管理的原始 8 位样本；调色板 PNG 使用展开后的 RGB，透明像素颜色保留。'};
    }
    if(type==='BMP') {
      const parsed=C().parse(a,0,'BMP');if(!parsed.verified||dv.getUint32(14,true)<40||dv.getUint32(30,true)!==0)throw new Error('只支持未压缩的 24/32 位 BMP。');
      width=dv.getInt32(18,true);const signedHeight=dv.getInt32(22,true);height=Math.abs(signedHeight);const bits=dv.getUint16(28,true),offset=dv.getUint32(10,true),stride=Math.ceil(width*bits/32)*4;
      if(![24,32].includes(bits)||width*height>8*1024*1024)throw new Error('只支持不超过 8 百万像素的 24/32 位 BMP。');
      rgba=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const pos=offset+(signedHeight>0?height-1-y:y)*stride+x*(bits/8),p=(y*width+x)*4;rgba.set([a[pos+2],a[pos+1],a[pos],bits===32?a[pos+3]:255],p);}return {width,height,rgba,note:'原始 BMP 通道，行顺序归一化为从上到下。32 位 BMP 的第 4 字节按原值保留。'};
    }
    throw new Error('原始像素 / LSB 检查目前支持 PNG 和 BMP，不对 JPEG 压缩系数作推断。');
  }
  function lsb(image,{channels='rgb',bits=1,packing='msb',order='xy',skip=0,maxBytes=Infinity}={}) {
    bits=Number(bits);skip=Number(skip);if(!/^[rgba]{1,4}$/.test(channels)||new Set(channels).size!==channels.length||![1,2,4,8].includes(bits)||!['msb','lsb'].includes(packing)||!['xy','yx'].includes(order)||!Number.isSafeInteger(skip)||skip<0)throw new Error('LSB 参数无效。');
    const ids=Array.from(channels,ch=>'rgba'.indexOf(ch)),{width,height,rgba}=image,available=width*height*ids.length*bits;
    if(skip>=available)throw new Error('起始位偏移超出像素流。');
    const out=new Uint8Array(Math.min(Math.floor((available-skip)/8),maxBytes));let bitIndex=0,written=0;
    outer:for(let n=0;n<width*height;n++){const pixel=order==='xy'?n:(n%height)*width+Math.floor(n/height);for(const ch of ids)for(let b=0;b<bits;b++){if(bitIndex++<skip)continue;if(written>=out.length*8)break outer;out[written>>3]|=((rgba[pixel*4+ch]>>b)&1)<<(packing==='msb'?7-(written&7):(written&7));written++;}}
    return out;
  }
  function plane(image,{channel='rgb',bit=0}={}) {bit=Number(bit);if(!['rgb','r','g','b','a','original','invert'].includes(channel)||!Number.isInteger(bit)||bit<0||bit>7)throw new Error('位平面参数无效。');const out=image.rgba.slice();for(let p=0;p<out.length;p+=4){for(let i=0;i<3;i++)out[p+i]=channel==='original'?out[p+i]:channel==='invert'?255-out[p+i]:((image.rgba[p+(channel==='rgb'?i:'rgba'.indexOf(channel))]>>bit)&1)*255;out[p+3]=255;}return out;}
  function autoLSB(image) {
    const hits=[];
    for(const channels of ['r','g','b','a','rgb','bgr','rgba','bgra'])for(const bits of [1,2])for(const packing of ['msb','lsb']) {
      const params={channels,bits,packing,order:'xy',skip:0,maxBytes:262144},a=lsb(image,params),type=C().detect(a),text=new TextDecoder('latin1').decode(a);
      const flags=Array.from(text.matchAll(/(?:flag|ctf|[A-Za-z0-9_]{2,20}ctf)\{[\x20-\x7e]{1,180}?\}/gi),m=>({offset:m.index,text:m[0]})).slice(0,8);
      if(type||flags.length)hits.push({params,type,flags,bytesScanned:a.length});
    }
    return hits;
  }
  const api={decode,encode,convert,strings,metadata,flatten,dms,pixels,lsb,plane,autoLSB,md5,inflate};
  root.CTF=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
