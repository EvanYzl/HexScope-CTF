'use strict';
const {createHash,getHashes}=require('node:crypto');
const wasm=require('./vendor/hash-wasm.cjs');
// Electron uses BoringSSL, which omits these algorithms. Bundle incremental WASM
// implementations so release builds have the same algorithm set as development.
const fallbacks={'sha3-256':()=>wasm.createSHA3(256),'sha3-512':()=>wasm.createSHA3(512),blake2b512:()=>wasm.createBLAKE2b(512),blake2s256:()=>wasm.createBLAKE2s(256),sm3:()=>wasm.createSM3()};
const ALGORITHMS=[
  ['md5','MD5'],['sha1','SHA-1'],['sha224','SHA-224'],['sha256','SHA-256'],
  ['sha384','SHA-384'],['sha512','SHA-512'],['sha3-256','SHA3-256'],
  ['sha3-512','SHA3-512'],['blake2b512','BLAKE2b-512'],
  ['blake2s256','BLAKE2s-256'],['sm3','SM3'],['crc32','CRC-32 (校验和)']
];
const defaults=new Set(['md5','sha1','sha256','sha512']);
const supported=new Set(getHashes());
function capabilities(){return ALGORITHMS.map(([id,label])=>({id,label,available:id==='crc32'||supported.has(id)||Object.hasOwn(fallbacks,id),default:defaults.has(id)}));}
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
async function states(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>ALGORITHMS.length||new Set(ids).size!==ids.length)throw Error('请选择至少一种算法，且不要重复。');
  const selected=ids.map(id=>{const item=capabilities().find(x=>x.id===id&&x.available);if(!item)throw Error('不支持的哈希算法：'+String(id).slice(0,50));return item;});
  const engines=await Promise.all(selected.map(async item=>{if(item.id==='crc32')return null;if(Object.hasOwn(fallbacks,item.id)){const hash=await fallbacks[item.id]();return {update:chunk=>hash.update(chunk),digest:()=>Buffer.from(hash.digest('binary'))};}return createHash(item.id);}));let crc=0xffffffff,ended=false;
  return {
    update(chunk){if(ended)throw Error('摘要已经结束');for(const engine of engines)engine?.update(chunk);if(ids.includes('crc32'))for(const byte of chunk)crc=table[(crc^byte)&255]^(crc>>>8);},
    digest(){if(ended)throw Error('摘要已经结束');ended=true;return selected.map((item,i)=>{let buffer;if(engines[i])buffer=engines[i].digest();else{buffer=Buffer.alloc(4);buffer.writeUInt32BE((crc^0xffffffff)>>>0);}return {algorithm:item.id,label:item.label,hex:buffer.toString('hex'),base64:buffer.toString('base64')};});}
  };
}
function parseImageHashes(info){
  const size=/^Size(?: of data)? in bytes:\s*(\d+)\s*$/mi.exec(info);
  const n=size?Number(size[1]):NaN;const mediaBytes=Number.isSafeInteger(n)&&n>=0?n:null;
  const md5=/^MD5 hash of data:\s*([0-9a-f]{32})\s*$/mi.exec(info);
  return {mediaBytes,storedHashes:md5?{md5:md5[1].toLowerCase()}:{}};
}
function snapshot(stat){return {size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,ino:stat.ino,dev:stat.dev};}
function sameFile(stat,expected){return stat.isFile()&&Object.keys(snapshot(stat)).every(key=>expected[key]===undefined||stat[key]===expected[key]);}
async function hashStream({algorithms,total,source,read,verify,check=()=>{},notify=()=>{},storedHashes={}}){
  if(!Number.isSafeInteger(total)||total<0)throw Error('无法确定完整数据长度，停止计算以避免返回不完整的摘要。');
  const state=await states(algorithms),started=new Date(),clock=performance.now();let bytes=0,last=0,lastBytes=0;
  const progress=force=>{const now=performance.now();if(!force&&now-last<200&&!(lastBytes===0&&bytes>0))return;last=now;lastBytes=bytes;const seconds=(now-clock)/1000;notify({phase:'hash',kind:source.kind,bytes,total,bytesPerSecond:seconds>0?bytes/seconds:0,complete:!!force&&bytes===total});};
  check();await verify();progress(false);
  const result=await read(chunk=>{check();if(bytes+chunk.length>total)throw Error('读取长度超过记录值，未生成摘要。');state.update(chunk);bytes+=chunk.length;progress(false);});
  check();if(bytes!==total)throw Error('读取未完成（'+bytes+' / '+total+' 字节），未生成摘要。');
  await verify();check();
  // Finalize only after a successful full read, length check and source snapshot check.
  const hashes=state.digest(),comparisons=Object.entries(storedHashes).map(([algorithm,expected])=>{const actual=hashes.find(x=>x.algorithm===algorithm);return {algorithm,expected,actual:actual?.hex||null,status:!actual?'not_calculated':actual.hex===expected?'match':'mismatch'};});
  const report={version:1,application:'HexScope CTF 4.1',source,bytes,total,complete:true,startedAt:started.toISOString(),finishedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-clock)/1000,hashes,storedHashes,comparisons,readerWarning:result?.stderr||'',verification:'Full byte count and source size/mtime/ctime/file identity checked before and after reading.'};
  progress(true);return report;
}
module.exports={capabilities,states,parseImageHashes,snapshot,sameFile,hashStream};
