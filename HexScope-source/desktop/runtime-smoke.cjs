'use strict';
// Invoked with the shipped Electron in ELECTRON_RUN_AS_NODE mode. No window/UAC.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createHash}=require('node:crypto'),{Worker}=require('node:worker_threads');
function script(html,id){const hit=html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)</script>'));assert(hit,id);return hit[1];}
function loginSmoke(html){
 const context={module:{exports:{}},crypto:require('node:crypto').webcrypto,Uint32Array};vm.createContext(context);vm.runInContext(script(html,'loginCode'),context);
 const {generateChallenge,passwordFor}=context.module.exports;
 for(let i=0;i<32;i++){
  const value=generateChallenge();assert.match(value,/^[\x21-\x7e]{21}$/);assert.match(value,/[A-Za-z]/);assert.match(value,/[0-9]/);assert.match(value,/[^A-Za-z0-9]/);
 }
 assert.equal(passwordFor('a1B2c3D4e5F6g7H8i9J0!'),'aBcD');
 assert(html.includes('id="appShell" hidden inert aria-hidden="true"'));
 assert.equal((html.match(/data-hexscope-startup/g)||[]).length,9); // Eight inert UI scripts and their boot selector.
 return {challengeLength:21,characterClasses:['ASCII letters','digits','punctuation'],randomSamples:32,startup:'initially hidden; computation checked using packaged HTML',DOMAndSubmitFlow:'covered by developer regression suite'};
}
async function cryptoSmoke(html){
 const bootstrap=`const {parentPort,workerData}=require('node:worker_threads'),vm=require('node:vm');
 const r={TextEncoder,TextDecoder,Uint8Array,Uint32Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,BigInt,Blob,File,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,CompressionStream,DecompressionStream};
 r.self=r;r.globalThis=r;r.window=r;r.postMessage=value=>parentPort.postMessage(value);vm.createContext(r);vm.runInContext(workerData,r);
 parentPort.on('message',data=>r.onmessage({data}));parentPort.postMessage({type:'ready',rows:r.HexCryptoCatalog.rows,auto:r.HexCryptoExamples.auto});`;
 const worker=new Worker(bootstrap,{eval:true,workerData:['hexCryptoWorkerSource','cryptoExamplesCode','cryptoCatalogCode'].map(id=>script(html,id)).join('\n;\n')});
 let running;
 const next=new Promise((resolve,reject)=>{running={resolve,reject};});
 worker.on('message',value=>{if(value.type==='progress')return;if(value.type==='error')running?.reject(Error(value.error));else running?.resolve(value);});
 worker.on('error',error=>running?.reject(error));
 const timer=setTimeout(()=>{running?.reject(Error('Packaged crypto worker timed out'));worker.terminate();},60000);
 const run=task=>new Promise((resolve,reject)=>{running={resolve,reject};worker.postMessage(task);}).then(x=>x.result);
 try{
  const {rows,auto}=await next;assert.equal(rows.length,78);
  for(const row of rows){const result=await run({action:row.action,input:row.input,options:row.options});assert(result&&typeof result==='object',row.id);
   if(row.id==='rsa-padding')assert.equal(new TextDecoder().decode(result.data),'flag{oaep_sample}');
   if(row.id==='cpa')assert.equal(result.candidates[0].key,82);
  }
  for(const [id,text]of [['layered','flag{hello}'],['caesar','flag{layered_caesar}'],['xor','flag{base64_xor}']]){
   const result=await run({action:'auto',input:auto[id],options:{depth:3,nodes:700,beam:20,timeMs:4000,extended:false}});assert(result.results.some(x=>x.text===text),id);
  }
  const recovery=await run({action:'convert',input:Buffer.from('flag{offline_runtime}').toString('base64'),options:{from:'base64'}});
  assert.equal(Buffer.from(recovery.data).toString(),'flag{offline_runtime}');
  return {toolsExecuted:rows.length,automaticExamples:3,recoveredBytes:'exact match',runtimeWorker:'actual worker_threads running the bundled browser worker in a VM context'};
 }finally{clearTimeout(timer);await worker.terminate();}
}
async function main({directory,scratch,output}){
 const root=path.resolve(directory),app=path.join(root,'resources/app');
 process.env.PATH=path.join(process.env.WINDIR,'System32')+';'+process.env.WINDIR;
 const html=fs.readFileSync(path.join(app,'HexScope.html'),'utf8');
 const branding=JSON.parse(fs.readFileSync(path.join(app,'branding.json'),'utf8'));
 const build=JSON.parse(fs.readFileSync(path.join(app,'HexScope.build.json'),'utf8'));
 assert.equal(branding.author,'是羊羊羊呀');assert.equal(build.author,branding.author);assert.equal(build.repository,branding.repository);
 assert.equal(html.split(branding.credit).length-1,3,'homepage, footer and about credits');
 const login=loginSmoke(html);
 const icon=JSON.parse(fs.readFileSync(path.join(app,'assets/ICON_INFO.json'),'utf8'));
 for(const [file,sha]of Object.entries(icon.files))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(app,'assets',file))).digest('hex'),sha);
 assert(html.includes('data:image/png;base64,'+fs.readFileSync(path.join(app,'assets/hexscope.png')).toString('base64')));
 const cryptography=await cryptoSmoke(html);
 const preview=await require('../preview/runtime-smoke.cjs').run(html,path.join(root,'示例文件/12_文件预览'));
 const core={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView};core.self=core;core.globalThis=core;vm.createContext(core);vm.runInContext(script(html,'coreCode'),core);
 const {Forensics}=require(path.join(app,'forensics.cjs')),{convertVhd}=require(path.join(app,'vhd.cjs')),{WindowsMount}=require(path.join(app,'windows-mount.cjs'));
 const f=new Forensics(path.join(app,'engines/tsk/bin'));
 try{
  const sample=path.join(root,'示例文件/11_取证镜像'),image=await f.task(()=>f.open(path.join(sample,'split.E01')));assert.equal(image.segmentCount,6);
  const expected=JSON.parse(fs.readFileSync(path.join(sample,'源盘哈希参考.json'),'utf8'));
  const sourceHash=await f.task(()=>f.hashImage({imageId:image.id,algorithms:Object.keys(expected.hashes)}));
  assert.deepEqual(Object.fromEntries(sourceHash.hashes.map(x=>[x.algorithm,x.hex])),expected.hashes);
  const local=await f.task(()=>f.selectHashFile(path.join(sample,'fat16.dd'))),localHash=await f.task(()=>f.hashFile({fileId:local.id,algorithms:Object.keys(expected.hashes)}));
  assert.deepEqual(Object.fromEntries(localHash.hashes.map(x=>[x.algorithm,x.hex])),expected.hashes);
  const context={imageId:image.id,offset:image.partitions[0].offset,sectorSize:image.sectorSize};
  const listing=await f.task(()=>f.list({...context,recursive:true}));assert(listing.entries.some(x=>x.name==='中文 线索.png'));
  const entry=listing.entries.find(x=>x.path==='/PICTURES/HIDDEN.PNG');assert(entry);
  const plan=await f.task(()=>f.planAnalysis({...context,entryIds:[entry.id],capacity:1000}));assert.equal(plan.entries.length,1);
  const data=await f.task(()=>f.analyze({entryId:entry.id}));assert(core.HexCore.analyze(new Uint8Array(data.bytes),data.name).findings.some(x=>x.type==='ZIP'&&x.exportable));
  const entryHash=await f.task(()=>f.hashEntry({entryId:entry.id,algorithms:['sha256']}));assert.equal(entryHash.hashes[0].hex,createHash('sha256').update(data.bytes).digest('hex'));
  fs.mkdirSync(scratch,{recursive:true});const converted=await f.task(()=>convertVhd(f,image.id,scratch));assert.equal(converted.manifest.decodedSHA256,expected.hashes.sha256);
  const mounts=new WindowsMount(app),chosen=await mounts.select(converted.filename),status=await mounts.execute('status',{vhdId:chosen.id});
  assert.equal(status.attached,false);assert.equal(status.mediaBytes,expected.bytes);
  const result={application:'HexScope CTF 4.1 + Crypto + Preview',branding:{author:branding.author,credit:branding.credit,repository:branding.repository,HTMLCredits:3},runtime:process.versions,PATH:'Windows system directories only',htmlSHA256:createHash('sha256').update(html).digest('hex'),login,cryptography,preview,icon:{sizes:icon.sizes,sourceSHA256:icon.files['icon-source.jpg'],assets:'all hashes match',offlineFavicon:'matches bundled PNG'},
   E01segments:6,E01sourceHashAlgorithms:sourceHash.hashes.length,singleFileHashAlgorithms:localHash.hashes.length,sourceHashes:'all match independent Python RAW vectors',
   fileHandoffZIP:'detected using bundled file-analysis code',fileWithinImageHash:'matched',VHDdecodedSHA256:'matched',WindowsVHDRecognition:'correct media size, detached',actualDriveMount:'not performed',nativeGUI:'not launched or tested'};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  return result;
 }finally{f.dispose();}
}
module.exports={main};
