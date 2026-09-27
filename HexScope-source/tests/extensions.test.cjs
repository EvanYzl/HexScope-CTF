'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {chef}=require('./extension-worker.cjs'),{createExtensionHandler}=require('../desktop/extensions-protocol.cjs'),{app}=require('./dom-helper.cjs');
const source=path.resolve(__dirname,'..'),config=require('../extensions/OperationConfig.json');
const pairs=[['To Base32','From Base32'],['To Base45','From Base45'],['To Base58','From Base58'],['To Base62','From Base62'],['To Base64','From Base64'],['To Base85','From Base85'],['To Base92','From Base92'],['To Hex','From Hex'],['To Binary','From Binary'],['To Octal','From Octal'],['To Decimal','From Decimal'],['ROT47','ROT47'],['ROT8000','ROT8000'],['To Braille','From Braille'],['Gzip','Gunzip'],['Zlib Deflate','Zlib Inflate'],['Bzip2 Compress','Bzip2 Decompress']];
for(const [a,b]of pairs)test('packaged extension worker real roundtrip: '+a,async()=>{const worker=chef();try{const input=a==='To Braille'?'HELLO WORLD 1234!':'Hello World 1234!',r=await worker.run(input,[a,b]);assert.equal(r.result,input);}finally{worker.close();}});
test('packaged extension worker parses known classical and multilayer vectors',async()=>{const w=chef();try{
 assert.equal((await w.run('SGV4U2NvcGU=',[{op:'From Base64',args:['A-Za-z0-9+/=',true,false]}])).result,'HexScope');
 assert.equal((await w.run('ATTACKATDAWN',[{op:'Vigenère Encode',args:['LEMON']}])).result,'LXFOPVEFRNHR');
 assert.equal((await w.run('LXFOPVEFRNHR',[{op:'Vigenère Decode',args:['LEMON']}])).result,'ATTACKATDAWN');
 assert.equal((await w.run('abc',['A1Z26 Cipher Encode','A1Z26 Cipher Decode'])).result,'abc');
 }finally{w.close();}});
test('packaged extension worker executes cryptography and compression module chunks offline',async()=>{const w=chef();try{
 const key=Buffer.alloc(32,1).toString('base64');const round=await w.run('HexScope Fernet',[{op:'Fernet Encrypt',args:[key]},{op:'Fernet Decrypt',args:[key]}]);assert.equal(round.result,'HexScope Fernet');
 assert.equal((await w.run('abc',[{op:'SHA2',args:['256',64,160]}])).result,crypto.createHash('sha256').update('abc').digest('hex'));
 }finally{w.close();}});
test('all advertised extension shortcuts refer to real catalog operations and vendor assets match hashes',()=>{
 const panel=fs.readFileSync(path.join(source,'extensions/panel.html'),'utf8');for(const hit of panel.matchAll(/<option value="([^"]+)"/g))assert(config[hit[1]],hit[1]);assert.equal(Object.keys(config).length,505);
 const record=require('../extensions/ASSET_HASHES.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(sha(fs.readFileSync(path.join(source,'extensions/index.html'))),record.entrySHA256);
 for(const [file,hash]of Object.entries(record.files))assert.equal(sha(fs.readFileSync(path.join(source,'extensions/vendor/cyberchef',file))),hash,file);
});
test('local extension protocol serves only packaged assets with correct MIME types and denies traversal/other origins',async()=>{
 const handler=createExtensionHandler(source);
 const page=await handler({url:'hexscope-tools://local/index.html'});assert.equal(page.status,200);const html=await page.text();assert(html.includes('hexscope-extension-v1'));assert(html.includes("connect-src 'self' blob:"));
 const js=await handler({url:'hexscope-tools://local/assets/main.js'});assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
 for(const url of ['hexscope-tools://evil/index.html','https://local/index.html','hexscope-tools://local/%2f..%2f..%2fdesktop/main.cjs','hexscope-tools://local/..%5cdesktop/main.cjs','hexscope-tools://local/missing.js'])assert.equal((await handler({url})).status,404);
 assert.equal((await handler({url:'hexscope-tools://local/index.html',method:'POST'})).status,404);
});
test('extension bridge requires its parent and returns byte-exact output, recipe and cancellation',async()=>{
 const sent=[],handlers={},parent={postMessage:m=>sent.push(m)},bytes=Uint8Array.from([0,255,80,75]).buffer;let cancelled=false,input;
 const api={operations:{'To Hex':{}},manager:{input:{inputWorker:{},set(_id,data){input=data;}},tabs:{getActiveTab:()=>1},worker:{cancelBake(){cancelled=true;}},output:{outputs:{1:{status:'baked'}},getOutputDish:()=>({value:bytes}),getDishBuffer:async()=>bytes}},getRecipeConfig:()=>[{op:'To Hex',args:[]}],setRecipeConfig(){}};
 const scope={window:{parent,app:api,addEventListener:(name,fn)=>handlers[name]=fn},ArrayBuffer,Number,Object,setTimeout};vm.runInNewContext(fs.readFileSync(path.join(source,'extensions/bridge.js'),'utf8'),scope);
 await handlers.message({source:{},data:{channel:'hexscope-extension-v1',id:1,action:'output'}});assert.equal(sent.length,0);
 const message=(id,action,rest={})=>handlers.message({source:parent,data:{channel:'hexscope-extension-v1',id,action,...rest}});
 await message(2,'output');assert.deepEqual(new Uint8Array(sent[0].data.bytes),new Uint8Array([0,255,80,75]));
 await message(3,'stop');assert.equal(cancelled,true);await message(4,'recipe',{recipe:[{op:'Unknown',args:[]}]});assert.match(sent.at(-1).error,/无效/);
 await message(5,'input',{bytes});assert.equal(input.buffer,bytes);assert.equal(input.encoding,0);await new Promise(r=>setTimeout(r,35));assert.equal(sent.at(-1).data.bytes,4);
});
test('actual HexScope DOM switches to extension workspace and reports missing portable resources explicitly',async t=>{
 const ui=app(t);ui.$('extensionsMode').click();assert.equal(ui.$('extensionsWorkspace').hidden,false);ui.$('extensionLaunch').click();await new Promise(r=>setTimeout(r,0));assert.match(ui.$('extensionStatus').textContent,/Windows 便携包/);assert.equal(ui.d.querySelectorAll('#extensionStage iframe').length,0);
});
