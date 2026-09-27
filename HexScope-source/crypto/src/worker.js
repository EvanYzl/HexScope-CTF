'use strict';
const C=self.HexClassical;
function json(text){if(text.length>2*1024*1024)throw Error('JSON 输入过大');const o=JSON.parse(text);if(!o||typeof o!=='object'||Array.isArray(o))throw Error('请输入 JSON 对象');return o;}
function dataResult(data,note=''){return {data,text:new TextDecoder().decode(data),hex:C.encode('hex',data),note};}
function jwt(text,o){const p=text.trim().split('.');if(p.length!==3)throw Error('JWT/JWS 需三个点分段');const header=JSON.parse(C.text(C.decode('base64url',p[0]))),payload=JSON.parse(C.text(C.decode('base64url',p[1])));let signatureVerified=false;let note='内容仅解码，签名未验证；过期时间/受众/签发者没有验证。';if(o.key){const alg={HS256:'sha256',HS384:'sha384',HS512:'sha512'}[header.alg];if(!alg)throw Error('此入口只核对明确的 HS256/384/512，拒绝算法替换');const actual=self.HexNoble.hmac(self.HexNoble.hashes[alg],C.decode(o.keyFormat||'utf8',o.key),C.E.encode(p[0]+'.'+p[1])),expected=C.decode('base64url',p[2]);signatureVerified=actual.length===expected.length&&actual.every((v,i)=>v===expected[i]);note=signatureVerified?'HMAC 签名一致；时间、受众、签发者仍需核对。':'HMAC 签名不一致。';}return {header,payload,signatureVerified,note};}
async function run(task){const {action,input='',options:o={}}=task;if(typeof input!=='string'||input.length>2*1024*1024)throw Error('输入长度超过限制');
 if(action==='auto'){
  let parameters=null;if((o.format||'utf8')==='utf8'&&input.trim().startsWith('{'))try{parameters=json(input);}catch{}
  if(parameters?.n!==undefined&&parameters.c!==undefined)try{const r=self.HexMath.rsa(parameters);return {results:[{...r,path:['识别 RSA 参数','参数化 RSA 分析（已回代验证）'],score:0,original:false,flagLike:/flag\{/i.test(r.text)}],input:self.HexHeuristic.identify(input),expanded:1,generated:1,states:1,stop:'parameters',elapsedMs:0,note:'这是 RSA 参数求解结果，不是通过密文外观识别的算法。'};}catch(error){return {results:[],expanded:0,generated:0,states:0,stop:'parameters',elapsedMs:0,input:self.HexHeuristic.identify(input),note:'参数化分析未完成：'+error.message};}
  return self.HexHeuristic.search(input,o,value=>self.postMessage({type:'progress',value}));
 }
 if(action==='convert')return dataResult(C.decode(o.from||'base64',input),'输出格式由下方切换；所有字节均可下载。');
 if(action==='buddha')return dataResult(C.E.encode(self.HexLegacy.buddha(input,o.direction!=='encrypt')),'旧版佛曰 / Tudou 字表和公开固定密钥；其他版本、如是我闻或自定义箴言不适用。');
 if(action==='encode')return dataResult(C.E.encode(C.encode(o.to||'base64',C.decode(o.from||'utf8',input))));
 if(action==='classical')return dataResult(C.E.encode(C.transform(o.operation,input,o)),['hill','playfair','bacon','polybius','a1z26'].includes(o.operation)?'此古典字母格式可能规范化大小写、空格或 I/J。Playfair 解密保留填充字母，不擅自删除 X。':'');
 if(action==='cipher')return dataResult(self.HexModern.crypt(o,C.decode(o.from||'hex',input)),o.mode==='GCM'||o.algorithm==='ChaCha20-Poly1305'?'AEAD 解密会检查认证标签；输入/输出采用 ciphertext || 16-byte tag。':'裸字节密钥，无隐式口令派生；填充或可读性不等于密钥正确。');
 if(action==='xor')return dataResult(C.xor(C.decode(o.from||'hex',input),C.decode(o.keyFormat||'utf8',o.key||''),o.operation==='add',o.direction!=='encrypt'));
 if(action==='hash')return dataResult(self.HexModern.hashTool(o,C.decode(o.from||'utf8',input)),'这是摘要 / MAC / KDF 运算，不是可逆加密。');
 if(action==='dictionary')return self.HexHeuristic.dictionary({...o,words:input});
 if(action==='statistics'){const a=C.decode(o.from||'utf8',input);return {...self.HexHeuristic.identify(C.D.decode(a),a),kasiski:self.HexHeuristic.kasiski(C.D.decode(a)),vigenereCandidates:self.HexHeuristic.vigenere(C.D.decode(a)).slice(0,10)};}
 if(action==='jwt')return jwt(input,o);
 if(action==='js')return {literals:self.HexHeuristic.jsLiterals(input).map(v=>({...v,...dataResult(v.data)})),note:'仅提取允许的静态字面量；没有执行 JavaScript、eval 或 Function。'};
 if(action==='rsa')return self.HexMath.rsa({...json(input),...o});
 if(action==='rsa-padding')return self.HexAnalysisTools.rsaPadding({...json(input),...o});
 if(action==='ecc')return self.HexAdvanced.ecc({...json(input),...o});
 if(action==='coppersmith')return self.HexAdvanced.coppersmith({...json(input),...o});
 if(action==='lll'){const p=json(input);return {basis:self.HexAdvanced.lll(p.basis.map(row=>row.map(self.HexMath.number)))};}
 if(action==='math')return self.HexMath.math({...json(input),...o});
 if(action==='protocol')return self.HexMath.protocols({...json(input),...o});
 if(action==='signature')return self.HexModern.signature({...json(input),...o});
 if(action==='length-extension')return self.HexModern.lengthExtend({...json(input),...o});
 if(action==='a51'){const p={...json(input),...o};return self.HexModern.a51(C.decode('hex',p.key),p.frame);}
 if(action==='sbox')return self.HexAnalysisTools.sbox(json(input));
 if(action==='cpa')return self.HexAnalysisTools.cpa(json(input));
 if(action==='birthday')return self.HexAnalysisTools.birthday({...json(input),...o});
 throw Error('未知任务');
}
self.HexCryptoRun=run;
self.onmessage=async e=>{try{const result=await run(e.data);self.postMessage({type:'result',result});}catch(error){self.postMessage({type:'error',error:String(error.message||error)});}};
