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
 assert.equal((html.match(/data-hexscope-startup/g)||[]).length,11); // Ten inert UI scripts and their boot selector.
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
async function exportSnapshotSmoke(html,snapshots,snapshot,data,C){
 const context={Uint8Array,ArrayBuffer,AbortController,hexscopeFiles:{readSnapshot:args=>snapshots.read(args),cancelPreview:async()=>{}}};
 vm.createContext(context);vm.runInContext(script(html,'scanPoolCode'),context);
 const bootstrap=`const {parentPort,workerData}=require('node:worker_threads'),vm=require('node:vm');
 const r={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,Blob,File,crypto:require('node:crypto').webcrypto};r.self=r;r.globalThis=r;
 r.postMessage=(value,transfer)=>parentPort.postMessage(value,transfer);vm.createContext(r);vm.runInContext(workerData,r);parentPort.on('message',data=>r.onmessage({data}));`;
 const worker=new Worker(bootstrap,{eval:true,workerData:script(html,'coreCode')+'\n'+script(html,'workerCode')}),finding=C.analyze(new Uint8Array(data.bytes),data.name).findings.find(x=>x.type==='ZIP'&&x.exportable);
 const file={name:data.name,size:snapshot.size,_hexSnapshot:snapshot,slice(){throw Error('Stale File must never be read');},arrayBuffer(){throw Error('Stale File must never be read');}};
 const sourceSHA256=createHash('sha256').update(data.bytes).digest('hex'),binding=context.HexFileIO.bind(worker,{kind:'export',items:[{file,finding,sha256:sourceSHA256,name:'extracted.zip'}]});let timer;
 try{
  const response=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('Packaged snapshot export timed out')),20000);
   worker.on('message',value=>{if(!binding.handle(value))value.ok?resolve(value):reject(Error(value.error));});worker.on('error',reject);worker.postMessage(binding.payload);
  });
  const bytes=new Uint8Array(response.data),zip=C.parseZip(bytes,0);assert(zip.verified);assert.equal(response.count,1);
  const member=zip.entries.find(x=>x.name==='extracted.zip'),manifestEntry=zip.entries.find(x=>x.name==='manifest.json');assert(member&&manifestEntry);
  const recovered=bytes.subarray(member.dataStart,member.dataEnd);assert.equal(C.crc32(recovered),member.crc);
  assert.equal(createHash('sha256').update(recovered).digest('hex'),createHash('sha256').update(C.carve(new Uint8Array(data.bytes),finding)).digest('hex'));
  const manifest=JSON.parse(new TextDecoder().decode(bytes.subarray(manifestEntry.dataStart,manifestEntry.dataEnd)));assert.equal(manifest.items[0].sourceSHA256,sourceSHA256);
  return {worker:'actual packaged export worker and shared file reader',input:'E01 extraction snapshot with unusable File methods',zip:'structure, member CRC, byte hash and source manifest verified'};
 }finally{clearTimeout(timer);binding.close();await worker.terminate();}
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
 const {VisionService}=require(path.join(app,'vision-ipc.cjs')),visionService=new VisionService({root:app});let vision;
 try{
  const capabilities=await visionService.run(1,'capabilities',{});assert.equal(capabilities.languages.length,73);
  const png=await visionService.run(2,'barcode-create',{format:'qrcode',text:'flag{portable_offline}'});
  const found=await visionService.run(3,'barcode-read',{bytes:png});assert(found.some(x=>x.text==='flag{portable_offline}'));
  const sample=fs.readFileSync(path.join(root,'示例文件/13_图文工具/ocr-english.png'));
  const ocr=await visionService.run(4,'ocr',{bytes:sample,languages:['eng']});assert.match(ocr.text,/HexScope Offline OCR 123456/);assert(ocr.pdf.length>100);
  const docx=await visionService.run(5,'docx',{text:ocr.text}),xlsx=await visionService.run(6,'xlsx',{rows:[['text'],[ocr.text]]});assert(docx.length>100);assert(xlsx.length>100);
  vision={models:capabilities.languages.length,barcodeGenerators:capabilities.barcodeWrite.length,QRroundtrip:true,OCR:ocr.text,searchablePDFBytes:ocr.pdf.length,DOCXBytes:docx.length,XLSXBytes:xlsx.length,environment:'packaged Electron only; no external Node/Python/Java',nativeScreenshotAndPin:'mocked in developer suite, not performed'};
 }finally{visionService.close();}
 const chef=require('../tests/extension-worker.cjs').chef({directory:path.join(app,'extensions')});let extensions;
 try{for(const recipe of [['To Base92','From Base92'],['ROT8000','ROT8000'],['Bzip2 Compress','Bzip2 Decompress']])assert.equal((await chef.run('HexScope offline',recipe)).result,'HexScope offline');extensions={catalog:505,recipes:['Base92 roundtrip','ROT8000 roundtrip','Bzip2 roundtrip'],assets:'packaged app/extensions',iframeAndBridgeInNativeWindow:'not tested'};}finally{chef.close();}
 const preview=await require('../preview/runtime-smoke.cjs').run(html,path.join(root,'示例文件/12_文件预览'));
 const {readPreview}=require(path.join(app,'preview-read.cjs')),previewPaths=['sample.docx','sample.xlsx','sample.pdf','pixel.png'];
 for(const name of previewPaths){
  const filename=path.join(root,'示例文件/12_文件预览',name),stat=fs.statSync(filename,{bigint:true});
  const bytes=await readPreview({path:filename,size:Number(stat.size),lastModified:Number(stat.mtimeNs/1000000n),offset:0,length:Number(stat.size)});
  assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(fs.readFileSync(filename)).digest('hex'));
 }
 preview.nativeFileReads={files:previewPaths,contents:'all SHA-256 values match packaged originals',GUIFileBridge:'preload/IPC simulated in developer suite; actual native file picker not tested'};
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
  const plan=await f.task(()=>f.planAnalysis({...context,entryIds:[entry.id]}));assert.equal(plan.entries.length,1);
  const data=await f.task(()=>f.analyze({entryId:entry.id}));assert(core.HexCore.analyze(new Uint8Array(data.bytes),data.name).findings.some(x=>x.type==='ZIP'&&x.exportable));
  const {PreviewSnapshots}=require(path.join(app,'preview-snapshots.cjs')),snapshots=new PreviewSnapshots(scratch);
  try{
    const snapshot=await snapshots.save(data),bytes=await snapshots.read({snapshotId:snapshot.id,offset:0,length:snapshot.size});
    assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(data.bytes).digest('hex'));
    assert(core.HexCore.analyze(new Uint8Array(bytes),data.name).findings.some(x=>x.type==='ZIP'&&x.exportable));
    const exported=await exportSnapshotSmoke(html,snapshots,snapshot,data,core.HexCore);
    const directory=snapshots.directory;snapshots.release([snapshot.id]);assert(!fs.existsSync(directory));
    preview.E01snapshot={read:'actual six-volume E01 extraction; snapshot SHA-256 matches',analysis:'appended ZIP still detected',export:exported,cleanup:'registered snapshot and session directory removed'};
  }finally{snapshots.dispose();}
  const batchRows=[entry,listing.entries.find(x=>x.name==='HELLO.TXT')].filter(Boolean).slice(0,plan.limits.threads);
  const parallel=await f.task(()=>f.analyzeBatch({entryIds:batchRows.map(x=>x.id),threads:batchRows.length}));assert.equal(parallel.results.length,batchRows.length);assert(parallel.results.every(x=>x.ok));assert.deepEqual(parallel.results[0].bytes,data.bytes);
  for(const result of parallel.results){const check=await f.task(()=>f.hashEntry({entryId:result.entryId,algorithms:['sha256']}));assert.equal(check.hashes[0].hex,createHash('sha256').update(result.bytes).digest('hex'));}
  const entryHash=await f.task(()=>f.hashEntry({entryId:entry.id,algorithms:['sha256']}));assert.equal(entryHash.hashes[0].hex,createHash('sha256').update(data.bytes).digest('hex'));
  fs.mkdirSync(scratch,{recursive:true});const converted=await f.task(()=>convertVhd(f,image.id,scratch));assert.equal(converted.manifest.decodedSHA256,expected.hashes.sha256);
  const mounts=new WindowsMount(app),chosen=await mounts.select(converted.filename),status=await mounts.execute('status',{vhdId:chosen.id});
  assert.equal(status.attached,false);assert.equal(status.mediaBytes,expected.bytes);
  const result={application:'HexScope CTF 4.1 + Crypto + Preview + Vision + Extensions',branding:{author:branding.author,credit:branding.credit,repository:branding.repository,HTMLCredits:3},runtime:process.versions,PATH:'Windows system directories only',htmlSHA256:createHash('sha256').update(html).digest('hex'),login,cryptography,preview,vision,extensions,icon:{sizes:icon.sizes,sourceSHA256:icon.files['icon-source.jpg'],assets:'all hashes match',offlineFavicon:'matches bundled PNG'},
   E01segments:6,E01sourceHashAlgorithms:sourceHash.hashes.length,singleFileHashAlgorithms:localHash.hashes.length,sourceHashes:'all match independent Python RAW vectors',
   fileHandoffZIP:'detected using bundled file-analysis code',parallelImageReads:{readers:batchRows.length,allEntryHashes:'matched',maximumThreads:plan.limits.threads},fileWithinImageHash:'matched',VHDdecodedSHA256:'matched',WindowsVHDRecognition:'correct media size, detached',actualDriveMount:'not performed',nativeGUI:'not launched or tested'};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  return result;
 }finally{f.dispose();}
}
module.exports={main};
