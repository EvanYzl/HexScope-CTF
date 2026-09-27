(function(root){
'use strict';
// Independently implemented from the published RIPEMD algorithm parameters:
// https://homes.esat.kuleuven.be/~bosselae/ripemd/rmd{128,256,320}.txt
const left=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
const right=[5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
const ls=[11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
const rs=[8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
const k=[0,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e],kr=[0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0];
const rol=(x,s)=>(x<<s)|(x>>>(32-s));
const f=(i,x,y,z)=>i===0?x^y^z:i===1?(x&y)|(~x&z):i===2?(x|~y)^z:i===3?(x&z)|(y&~z):x^(y|~z);
function ripemd(data,bits){
 if(![128,256,320].includes(bits))throw Error('此入口支持 RIPEMD-128/256/320');
 const wide=bits===320,rounds=wide?80:64,half=wide?5:4;
 let h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476];if(wide)h.push(0xc3d2e1f0);if(bits!==128)h.push(0x76543210,0xfedcba98,0x89abcdef,0x01234567);if(wide)h.push(0x3c2d1e0f);
 const padded=new Uint8Array(Math.ceil((data.length+9)/64)*64);padded.set(data);padded[data.length]=128;const view=new DataView(padded.buffer);view.setBigUint64(padded.length-8,BigInt(data.length)*8n,true);
 for(let offset=0;offset<padded.length;offset+=64){let l=h.slice(0,half),r=bits===128?l.slice():h.slice(half);for(let i=0;i<rounds;i++){
   const j=i>>>4,a=rol((l[0]+f(j,l[1],l[2],l[3])+view.getUint32(offset+4*left[i],true)+k[j])|0,ls[i]),b=rol((r[0]+f((rounds-1-i)>>>4,r[1],r[2],r[3])+view.getUint32(offset+4*right[i],true)+(j===3&&!wide?0:kr[j]))|0,rs[i]);
   l=wide?[l[4],(a+l[4])|0,l[1],rol(l[2],10),l[3]]:[l[3],a,l[1],l[2]];
   r=wide?[r[4],(b+r[4])|0,r[1],rol(r[2],10),r[3]]:[r[3],b,r[1],r[2]];
   if(bits!==128&&i%16===15){const swap=wide?[1,3,0,2,4][j]:j;[l[swap],r[swap]]=[r[swap],l[swap]];}
  }
  if(bits===128)h=[h[1]+l[2]+r[3]|0,h[2]+l[3]+r[0]|0,h[3]+l[0]+r[1]|0,h[0]+l[1]+r[2]|0];else h=h.map((v,i)=>(v+(i<half?l[i]:r[i-half]))|0);
 }
 const out=new Uint8Array(bits/8),outView=new DataView(out.buffer);h.forEach((v,i)=>outView.setUint32(4*i,v,true));return out;
}
// Original Tudou/佛曰 wire-format constants, independently implemented.
// The original .NET format pads the public key and IV with ASCII spaces.
const tudou='滅苦婆娑耶陀跋多漫都殿悉夜爍帝吉利阿無南那怛喝羯勝摩伽謹波者穆僧室藝尼瑟地彌菩提蘇醯盧呼舍佛參沙伊隸麼遮闍度蒙孕薩夷迦他姪豆特逝朋輸楞栗寫數曳諦羅曰咒即密若般故不實真訶切一除能等是上明大神知三藐耨得依諸世槃涅竟究想夢倒顛離遠怖恐有礙心所以亦智道。集盡死老至',markers='冥奢梵呐俱哆怯諳罰侄缽皤';
function buddha(input,decrypt=true){
 if(input.length>65536)throw Error('旧版佛曰输入上限 65,536 字符');
 const options={algorithm:'AES',mode:'CBC',padding:'pkcs7',direction:decrypt?'decrypt':'encrypt',keyFormat:'utf8',key:'XDXDtudou@KeyFansClub^_^Encode!!'.padEnd(32,' '),ivFormat:'utf8',iv:'Potato@Key@_@=_='.padEnd(16,' ')};
 if(!decrypt){const bytes=new Uint8Array(input.length*2),view=new DataView(bytes.buffer);for(let i=0;i<input.length;i++)view.setUint16(2*i,input.charCodeAt(i),true);return '佛曰：'+[...root.HexModern.crypt(options,bytes)].map(b=>(b>=128?markers[0]:'')+tudou[b&127]).join('');}
 const s=input.replace(/^\s*佛曰\s*[:：]/,'').replace(/\s/g,''),bytes=[];
 for(let i=0;i<s.length;i++){let high=0;if(markers.includes(s[i])){high=128;i++;}const low=i<s.length?tudou.indexOf(s[i]):-1;if(low<0)throw Error('佛曰旧版字表不匹配或高位标记缺少后续字符');bytes.push(high|low);}
 const plain=root.HexModern.crypt(options,new Uint8Array(bytes));if(plain.length%2)throw Error('佛曰解密结果不是 UTF-16LE');return new TextDecoder('utf-16le',{fatal:true}).decode(plain);
}
root.HexLegacy={ripemd,buddha};
})(typeof self!=='undefined'?self:globalThis);
