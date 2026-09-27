'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const MAX_VHD=2040*1024**3;
function validateSize(bytes,sectorSize=512){if(sectorSize!==512)throw Error('固定 VHD 仅支持 512 字节逻辑扇区；此镜像需要 VHDX 或其他挂载方式。');if(!Number.isSafeInteger(bytes)||bytes<512||bytes%512||bytes>MAX_VHD)throw Error('VHD 转换要求完整数据大小为 512 字节的倍数，且不超过 2040 GiB。');}
function geometry(bytes){let total=Math.min(bytes/512,65535*16*255),sectors,heads,ch;if(total>=65535*16*63){sectors=255;heads=16;ch=Math.floor(total/sectors);}else{sectors=17;ch=Math.floor(total/sectors);heads=Math.max(4,Math.ceil(ch/1024));if(ch>=heads*1024||heads>16){sectors=31;heads=16;ch=Math.floor(total/sectors);}if(ch>=heads*1024){sectors=63;heads=16;ch=Math.floor(total/sectors);}}return {cylinders:Math.floor(ch/heads),heads,sectors};}
function footer(bytes){
  validateSize(bytes);const b=Buffer.alloc(512),g=geometry(bytes);b.write('conectix',0,'ascii');b.writeUInt32BE(2,8);b.writeUInt32BE(0x10000,12);b.fill(255,16,24);b.writeUInt32BE(Math.floor((Date.now()-Date.UTC(2000,0,1))/1000),24);b.write('HxSc',28,'ascii');b.writeUInt32BE(0x00040100,32);b.write('Wi2k',36,'ascii');b.writeBigUInt64BE(BigInt(bytes),40);b.writeBigUInt64BE(BigInt(bytes),48);b.writeUInt16BE(g.cylinders,56);b[58]=g.heads;b[59]=g.sectors;b.writeUInt32BE(2,60);const uuid=randomBytes(16);uuid[6]=(uuid[6]&15)|64;uuid[8]=(uuid[8]&63)|128;uuid.copy(b,68);b.writeUInt32BE((~b.reduce((n,x)=>n+x,0))>>>0,64);return b;
}
async function inspectFixedVhd(filename){
  const handle=await fsp.open(filename,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1024)throw Error('不是有效的固定 VHD 文件。');const b=Buffer.alloc(512);const {bytesRead}=await handle.read(b,0,512,stat.size-512);if(bytesRead!==512||b.subarray(0,8).toString()!=='conectix'||b.readUInt32BE(12)!==0x10000||b.readUInt32BE(60)!==2)throw Error('只接受固定 VHD。动态 / 差分 VHD 和 VHDX 请继续在软件内浏览。');const sum=b.readUInt32BE(64);b.fill(0,64,68);if(sum!==((~b.reduce((n,x)=>n+x,0))>>>0))throw Error('VHD 文件尾校验失败。');const bytes=Number(b.readBigUInt64BE(48));validateSize(bytes);if(bytes+512!==stat.size)throw Error('VHD 数据长度与文件尾不一致。');return {bytes,stat};}finally{await handle.close();}
}
async function convertVhd(service,imageId,destination,notify=()=>{}){
  const image=service.image(imageId);validateSize(image.mediaBytes,image.sectorSize);await service.unchanged();service.check();
  const folder=await fsp.realpath(destination);if(!(await fsp.stat(folder)).isDirectory())throw Error('请选择输出文件夹。');
  const disk=await fsp.statfs(folder,{bigint:true});if(disk.bavail*disk.bsize<BigInt(image.mediaBytes+512+16*1024*1024))throw Error('输出位置空间不足，需要接近源盘容量的额外空间。');
  const dir=await fsp.mkdtemp(path.join(folder,'HexScope-VHD-')),temporary=path.join(dir,'decoded.vhd.partial'),filename=path.join(dir,'decoded.vhd');let fd=null,bytes=0,finalized=false,last=0;const clock=performance.now(),hash=createHash('sha256');
  try{
    fd=fs.openSync(temporary,'wx');const reader=await service.streamImage(imageId,chunk=>{service.check();let offset=0;while(offset<chunk.length)offset+=fs.writeSync(fd,chunk,offset,chunk.length-offset);hash.update(chunk);bytes+=chunk.length;const now=performance.now();if(now-last>=200){last=now;notify({phase:'vhd',bytes,total:image.mediaBytes,bytesPerSecond:bytes/((now-clock)/1000)});}});
    service.check();if(bytes!==image.mediaBytes)throw Error('转换未读取完整镜像。');const tail=footer(bytes);let written=0;while(written<tail.length)written+=fs.writeSync(fd,tail,written,tail.length-written);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;await service.unchanged();service.check();
    // Independent native VHD decoder must recognize the footer and the same media size.
    const {parseImageHashes}=require('./hashing.cjs');const verify=(await service.run('img_stat',['-i','vhd',temporary])).data.toString('utf8');if(parseImageHashes(verify).mediaBytes!==bytes)throw Error('VHD 组件复核的数据长度不一致。');
    const sha256=hash.digest('hex');const manifest={version:1,source:image.name,sourceImageType:image.imageType||'auto',sourceSegments:image.segmentCount,decodedBytes:bytes,decodedSHA256:sha256,output:'decoded.vhd',outputBytes:bytes+512,footerBytes:512,scope:'前 decodedBytes 字节逐字节保持源镜像解码数据，最后追加 512 字节固定 VHD 文件尾；不修改源镜像。',createdAt:new Date().toISOString(),readerWarning:reader.stderr||'',partitions:image.partitions};
    await fsp.writeFile(path.join(dir,'conversion.json'),JSON.stringify(manifest,null,2),{encoding:'utf8',flag:'wx'});await fsp.rename(temporary,filename);finalized=true;notify({phase:'vhd',bytes,total:bytes,complete:true});return {filename,manifest};
  }finally{if(fd!==null)fs.closeSync(fd);if(!finalized)await fsp.unlink(temporary).catch(()=>{});}
}
module.exports={footer,geometry,validateSize,inspectFixedVhd,convertVhd,MAX_VHD};
