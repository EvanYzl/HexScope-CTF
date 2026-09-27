/* PCM WAV analysis without browser audio decoding or resampling. */
(function(root){
  'use strict';
  const int=(v,min,max,name)=>{v=Number(v);if(!Number.isInteger(v)||v<min||v>max)throw new Error(name+'须为 '+min+'—'+max+' 的整数。');return v;};
  const word=(a,p)=>String.fromCharCode(...a.subarray(p,p+4));
  function wav(a) {
    if(a.length<12||word(a,0)!=='RIFF'||word(a,8)!=='WAVE')throw new Error('请选择小端 RIFF / WAVE 文件；不支持 MP3、RF64 或 RIFX。');
    const v=new DataView(a.buffer,a.byteOffset,a.byteLength),end=v.getUint32(4,true)+8,chunks=[];let p=12,fmt=null,data=null;
    if(end>a.length||end<12)throw new Error('WAV 声明长度超出文件。');
    while(p+8<=end){const type=word(a,p),size=v.getUint32(p+4,true),next=p+8+size+(size&1);if(next>end)throw new Error('WAV 数据块截断或缺少对齐字节。');chunks.push({type,start:p,size});if(chunks.length>10000)throw new Error('WAV 超过 10,000 个块。');if(type==='fmt '){if(fmt)throw new Error('WAV 出现重复 fmt 块。');if(size<16)throw new Error('WAV fmt 块太短。');fmt={start:p+8,size};}if(type==='data'){if(data)throw new Error('暂不支持多个 data 块，请使用单一 PCM 数据流。');data={start:p+8,size};}p=next;}
    if(p!==end||!fmt||!data)throw new Error('WAV 缺少完整 fmt / data 块。');
    p=fmt.start;let format=v.getUint16(p,true);const channels=v.getUint16(p+2,true),sampleRate=v.getUint32(p+4,true),byteRate=v.getUint32(p+8,true),blockAlign=v.getUint16(p+12,true),bits=v.getUint16(p+14,true);
    if(format===0xfffe){const guid=[1,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113];if(fmt.size<40||v.getUint16(p+16,true)<22||!guid.every((n,i)=>a[p+24+i]===n)||![0,bits].includes(v.getUint16(p+18,true)))throw new Error('只支持有效位深等于容器位深的 WAVE_FORMAT_EXTENSIBLE PCM。');format=1;}
    if(format!==1||![8,16,24,32].includes(bits))throw new Error('当前支持 8/16/24/32 位整数 PCM；浮点和压缩 WAV 不用于采样 LSB 分析。');
    if(channels<1||channels>8||sampleRate<1000||sampleRate>384000||blockAlign!==channels*bits/8||byteRate!==sampleRate*blockAlign||data.size%blockAlign)throw new Error('WAV 通道、采样率、帧对齐或字节率异常。');
    const frames=data.size/blockAlign;if(!frames)throw new Error('WAV 没有采样数据。');
    return {a,v,format,channels,sampleRate,bits,blockAlign,byteRate,bytesPerSample:bits/8,frames,duration:frames/sampleRate,dataStart:data.start,dataSize:data.size,chunks,tail:a.length-end};
  }
  function sample(w,frame,channel){const p=w.dataStart+frame*w.blockAlign+channel*w.bytesPerSample;if(w.bits===8)return (w.a[p]-128)/128;if(w.bits===16)return w.v.getInt16(p,true)/32768;if(w.bits===32)return w.v.getInt32(p,true)/2147483648;let value=w.a[p]|(w.a[p+1]<<8)|(w.a[p+2]<<16);if(value&0x800000)value-=16777216;return value/8388608;}
  function channelReader(w,channel='mix'){
    if(channel==='difference'){if(w.channels<2)throw new Error('声道差需要至少两个声道。');return i=>(sample(w,i,0)-sample(w,i,1))/2;}
    if(channel==='mix')return i=>{let n=0;for(let ch=0;ch<w.channels;ch++)n+=sample(w,i,ch);return n/w.channels;};
    const ch=int(channel,0,w.channels-1,'声道索引');return i=>sample(w,i,ch);
  }
  function range(w,{start=0,duration=10}={}){start=Number(start);duration=Number(duration);if(!Number.isFinite(start)||start<0||start>=w.duration||!Number.isFinite(duration)||duration<=0||duration>120)throw new Error('起点须在音频内；每次分析时长须大于 0 且不超过 120 秒。');const from=Math.floor(start*w.sampleRate),to=Math.min(w.frames,Math.ceil((start+duration)*w.sampleRate));return {from,to,start:from/w.sampleRate,end:to/w.sampleRate};}
  function info(w){return {channels:w.channels,sampleRate:w.sampleRate,bits:w.bits,frames:w.frames,duration:w.duration,dataStart:w.dataStart,dataSize:w.dataSize,tail:w.tail,chunks:w.chunks};}
  function waveform(w,options={}){const r=range(w,options),read=channelReader(w,options.channel),width=Math.min(768,r.to-r.from),min=new Float32Array(width),max=new Float32Array(width);for(let x=0;x<width;x++){let lo=1,hi=-1;const from=r.from+Math.floor(x*(r.to-r.from)/width),to=r.from+Math.floor((x+1)*(r.to-r.from)/width);for(let i=from;i<to;i++){const value=read(i);lo=Math.min(lo,value);hi=Math.max(hi,value);}min[x]=lo;max[x]=hi;}return {min,max,...r};}
  function fft(real,imag) {
    const n=real.length;if(n!==imag.length||n<2||(n&(n-1)))throw new Error('FFT 长度须为 2 的幂。');
    for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}
    for(let len=2;len<=n;len*=2){const angle=-2*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);for(let i=0;i<n;i+=len){let ar=1,ai=0;for(let j=0;j<len/2;j++){const p=i+j,q=p+len/2,tr=ar*real[q]-ai*imag[q],ti=ar*imag[q]+ai*real[q];real[q]=real[p]-tr;imag[q]=imag[p]-ti;real[p]+=tr;imag[p]+=ti;const next=ar*wr-ai*wi;ai=ar*wi+ai*wr;ar=next;}}}
  }
  function spectrum(values) {
    const n=values.length,real=new Float64Array(n),imag=new Float64Array(n);let sum=0;
    for(let i=0;i<n;i++){const h=.5-.5*Math.cos(2*Math.PI*i/(n-1));real[i]=values[i]*h;sum+=h;}fft(real,imag);const result=new Float64Array(n/2+1);for(let i=0;i<result.length;i++)result[i]=Math.hypot(real[i],imag[i])*(i===0||i===n/2?1:2)/sum;return result;
  }
  function spectrogram(w,options={}) {
    const r=range(w,options),read=channelReader(w,options.channel),n=int(options.fftSize??2048,256,8192,'FFT 长度');if(n&(n-1))throw new Error('FFT 长度须为 2 的幂。');
    const high=Number(options.maxFrequency??w.sampleRate/2),low=Number(options.minFrequency??0);if(!Number.isFinite(low)||!Number.isFinite(high)||low<0||low>=high||high>w.sampleRate/2)throw new Error('频率范围须在 0 到采样率的一半之间。');
    const width=Math.max(1,Math.min(768,Math.ceil((r.to-r.from)/(n/4)))),height=256,bitmap=new Uint8Array(width*height*4),values=new Float64Array(n),binLow=Math.floor(low*n/w.sampleRate),binHigh=Math.ceil(high*n/w.sampleRate);
    for(let x=0;x<width;x++){
      const center=r.from+(x+.5)*(r.to-r.from)/width,first=Math.floor(center-n/2);
      for(let i=0;i<n;i++){const frame=first+i;values[i]=frame>=r.from&&frame<r.to?read(frame):0;}
      const amplitudes=spectrum(values);
      for(let y=0;y<height;y++){const begin=Math.max(binLow,Math.floor((high-(y+1)/height*(high-low))*n/w.sampleRate)),end=Math.min(binHigh,Math.max(begin,Math.ceil((high-y/height*(high-low))*n/w.sampleRate)));let peak=0;for(let b=begin;b<=end;b++)peak=Math.max(peak,amplitudes[b]||0);const intensity=Math.max(0,Math.min(1,(20*Math.log10(Math.max(peak,1e-5))+100)/100)),p=(y*width+x)*4;bitmap[p]=Math.round(255*Math.min(1,intensity*1.6));bitmap[p+1]=Math.round(255*Math.max(0,(intensity-.25)/.75));bitmap[p+2]=Math.round(140*(1-intensity)+60*intensity);bitmap[p+3]=255;}
    }
    return {image:bitmap,width,height,start:r.start,end:r.end,minFrequency:low,maxFrequency:high,fftSize:n,dbFloor:-100,note:'Hann 窗 FFT，纵轴为线性频率，亮度范围 −100 至 0 dBFS；长区间最多抽取 768 个时间窗，可能漏掉很短的信号。'};
  }
  function analyze(a,options={}){const w=wav(a);return {info:info(w),wave:waveform(w,options),spectrogram:spectrogram(w,options)};}
  function lsb(a,{channel='all',bits=1,packing='msb',skip=0,start=0,duration=10}={}) {
    const w=wav(a),r=range(w,{start,duration});bits=int(bits,1,8,'每采样低位数');const channels=channel==='all'?Array.from({length:w.channels},(_,i)=>i):[int(channel,0,w.channels-1,'声道索引')];
    function* stream(){for(let i=r.from;i<r.to;i++)for(const ch of channels){const byte=w.a[w.dataStart+i*w.blockAlign+ch*w.bytesPerSample];for(let bit=0;bit<bits;bit++)yield (byte>>>bit)&1;}}
    return {...root.Stego.packBits(stream(),{packing,skip}),info:info(w),start:r.start,end:r.end,note:'按原始整数采样取最低有效字节的低位，未经过音频解码或重采样。全声道按文件交错顺序读取。'};
  }
  function writeWav(data,channels,rate,bits){const out=new Uint8Array(44+data.length+(data.length&1)),v=new DataView(out.buffer),write=(p,s)=>out.set(new TextEncoder().encode(s),p);write(0,'RIFF');v.setUint32(4,out.length-8,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*channels*bits/8,true);v.setUint16(32,channels*bits/8,true);v.setUint16(34,bits,true);write(36,'data');v.setUint32(40,data.length,true);out.set(data,44);return out;}
  function transform(a,{operation='reverse',channel=0}={}) {
    const w=wav(a);if(operation==='reverse'){const data=a.slice();for(let i=0;i<w.frames;i++)data.set(a.subarray(w.dataStart+i*w.blockAlign,w.dataStart+(i+1)*w.blockAlign),w.dataStart+(w.frames-1-i)*w.blockAlign);return {data,note:'按完整采样帧倒序，保留声道交错、其他数据块与原始位深。'};}
    if(operation==='channel'){channel=int(channel,0,w.channels-1,'声道索引');const data=new Uint8Array(w.frames*w.bytesPerSample);for(let i=0;i<w.frames;i++){const p=w.dataStart+i*w.blockAlign+channel*w.bytesPerSample;data.set(a.subarray(p,p+w.bytesPerSample),i*w.bytesPerSample);}return {data:writeWav(data,1,w.sampleRate,w.bits),note:'逐字节提取指定声道，导出同位深的单声道 WAV；只保留标准 PCM 头与采样数据。'};}
    if(operation==='difference'){const read=channelReader(w,'difference'),data=new Uint8Array(w.frames*2),v=new DataView(data.buffer);for(let i=0;i<w.frames;i++)v.setInt16(i*2,Math.max(-32768,Math.min(32767,Math.round(read(i)*32768))),true);return {data:writeWav(data,1,w.sampleRate,16),note:'导出 (左 − 右) / 2 的 16 位单声道 WAV，便于收听声道差；这是派生音频。'};}
    throw new Error('未知 WAV 变换。');
  }
  function dtmf(a,options={}) {
    const w=wav(a);if(w.sampleRate<4000)throw new Error('DTMF 分析需要至少 4,000 Hz 采样率。');const r=range(w,options),read=channelReader(w,options.channel),frequencies=[697,770,852,941,1209,1336,1477,1633],keys=['123A','456B','789C','*0#D'],n=Math.round(w.sampleRate*.05),hop=Math.round(w.sampleRate*.025),coef=frequencies.map(f=>2*Math.cos(2*Math.PI*f/w.sampleRate)),events=[];let current=null;
    function flush(){if(current&&current.windows>=2)events.push({symbol:current.symbol,start:current.start,end:current.end});current=null;}
    for(let p=r.from;p+n<=r.to;p+=hop){let mean=0,energy=0;const values=new Float64Array(n);for(let i=0;i<n;i++){values[i]=read(p+i);mean+=values[i];}mean/=n;for(let i=0;i<n;i++){values[i]-=mean;energy+=values[i]*values[i];}const powers=coef.map(c=>{let one=0,two=0;for(const x of values){const y=x+c*one-two;two=one;one=y;}return (one*one+two*two-c*one*two)/(n*n);}),rows=[0,1,2,3].sort((a,b)=>powers[b]-powers[a]),cols=[4,5,6,7].sort((a,b)=>powers[b]-powers[a]),rr=rows[0],cc=cols[0],rp=powers[rr],cp=powers[cc],twist=rp/Math.max(cp,1e-20),dominance=2*(rp+cp)/Math.max(energy/n,1e-20);let symbol=null;
      if(energy/n>1e-6&&rp>5*powers[rows[1]]&&cp>5*powers[cols[1]]&&twist>.15&&twist<6&&dominance>.55)symbol=keys[rr][cc-4];
      if(!symbol){flush();continue;}if(current?.symbol===symbol){current.end=(p+n)/w.sampleRate;current.windows++;}else{flush();current={symbol,start:p/w.sampleRate,end:(p+n)/w.sampleRate,windows:1};}
    }
    flush();return {events,text:events.map(e=>e.symbol).join(''),start:r.start,end:r.end,note:'Goertzel 双音候选检测（50 ms 窗 / 25 ms 步长）；至少连续两窗。时间是近似范围，噪声、短音或变速音频可能漏检，需结合频谱确认。'};
  }
  const api={wav,sample,info,fft,spectrum,waveform,spectrogram,analyze,lsb,transform,dtmf,writeWav};root.AudioStego=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
