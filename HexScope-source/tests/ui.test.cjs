// In-memory DOM / event unit tests. No browser is launched, and no URL is fetched.
// These tests do not validate browser rendering, native file pickers or CSP support.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const C=require('../src/core.js');
const html=require('./built-artifact.cjs').readBuiltHTML();
const fixture=name=>new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures',name)));
async function eventually(predicate,message='state transition') {
  const until=Date.now()+4000;
  while(Date.now()<until) {if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Timed out: '+message);
}
function app(t) {
  const downloads=[],errors=[],blobs=new Map();let index=0;
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.Blob=Blob;w.File=File;
    Object.defineProperty(w,'crypto',{value:webcrypto});
    w.URL.createObjectURL=blob=>{const id='blob:test-'+index++;blobs.set(id,blob);return id;};
    w.URL.revokeObjectURL=id=>blobs.delete(id);
    w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)});};
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    // Record drawing inputs only. This does not render canvas or test PNG encoding.
    w.ImageData=class {constructor(data,width,height){assert.equal(data.length,width*height*4);this.data=data;this.width=width;this.height=height;}};
    w.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){canvas._unitStroked=true;},putImageData(image){canvas._unitPixels=image.data;}};};
    w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([fixture('normal.png')],{type:'image/png'}));};
    // Runs the actual worker code in a separate VM context with mock messaging.
    w.Worker=class {
      constructor(url){this.source=blobs.get(url);this.dead=false;}
      async postMessage(data) {
        try {
          const src=await this.source.text();if(this.dead)return;
          const context={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,Blob,File,DecompressionStream,crypto:webcrypto};
          context.self={postMessage:value=>{if(!this.dead)this.onmessage?.({data:value});}};
          context.globalThis=context.self; // HexCore registers on the worker global.
          vm.runInNewContext(src,context);
          if(!this.dead)await context.self.onmessage({data});
        }catch(error){if(!this.dead)this.onerror?.({message:error.message});}
      }
      terminate(){this.dead=true;}
    };
  }});
  const w=dom.window,d=w.document,$=id=>d.getElementById(id);
  t.after(()=>{w.close();assert.deepEqual(errors,[],'no DOM script errors');});
  const input=files=>{Object.defineProperty($('fileInput'),'files',{value:files,configurable:true});$('fileInput').dispatchEvent(new w.Event('change'));};
  const row=name=>Array.from(d.querySelectorAll('.file-row')).find(x=>x.textContent.includes(name));
  return {w,d,$,downloads,input,row};
}
test('empty UI and help dialog initialize',t=>{const {w,d,$}=app(t);assert.equal(d.querySelectorAll('img').length,1);assert.equal($('creatorAvatar').src,d.querySelector('link[rel=icon]').href);assert.equal(d.querySelector('.creator-credit').textContent,'Created by 是羊羊羊呀');assert.equal(d.title,'HexScope CTF 4.1 · 是羊羊羊呀');assert.equal($('statTotal').textContent,'00');assert.equal($('exportBtn').disabled,true);$('helpBtn').click();assert.equal($('helpDialog').open,true);$('closeHelp').click();assert.equal($('helpDialog').open,false);});
test('four demo files flow through actual parser and batch export',async t=>{
  const {w,d,$,row,downloads}=app(t);$('demoBtn').click();await eventually(()=>$('statTotal').textContent==='04','demo scan');
  assert.equal($('statSuspect').textContent,'02');assert.equal($('statMismatch').textContent,'01');assert.equal($('statExtract').textContent,'01');
  row('02_').click();d.querySelector('[data-tab="extract"]').click();assert.equal(d.querySelectorAll('.candidate').length,1);assert.equal(d.querySelector('[data-choice]').checked,true);
  $('exportBtn').click();await eventually(()=>downloads.length===1,'batch export');
  const zip=new Uint8Array(await downloads[0].blob.arrayBuffer()),parsed=C.parseZip(zip,0);assert.equal(parsed.verified,true);assert.equal(parsed.entries.length,2);
  const nested=parsed.entries.find(e=>e.name.endsWith('.zip'));assert.equal(C.parseZip(zip.slice(nested.dataStart,nested.dataEnd),0).entries.length,2);
  const entry=parsed.entries.find(e=>e.name==='manifest.json'),manifest=JSON.parse(new TextDecoder().decode(zip.subarray(entry.dataStart,entry.dataEnd)));assert.equal(manifest.items[0].format,'ZIP');assert.equal(manifest.items[0].sourceSHA256.length,64);
  d.querySelector('[data-choice]').click();assert.match($('exportCount').textContent,/^0 /);assert.equal($('exportBtn').disabled,true);
});
test('ZIP members are decompressed through worker and exported with CRC',async t=>{
  const {d,$,row,downloads,input}=app(t),png=fixture('normal.png'),zip=fixture('deflated.zip');input([new File([png,zip],'embedded.png')]);await eventually(()=>$('statTotal').textContent==='01');
  d.querySelector('[data-tab="extract"]').click();d.querySelector('[data-unzip]').click();await eventually(()=>downloads.length===1,'unzip');
  const a=new Uint8Array(await downloads[0].blob.arrayBuffer()),r=C.parseZip(a,0);assert.equal(r.verified,true);assert.equal(r.entries.length,3);const e=r.entries.find(e=>e.name==='hello.txt');assert.equal(new TextDecoder().decode(a.subarray(e.dataStart,e.dataEnd)),'Hello, hidden world!\n'.repeat(100));
});
test('hex tail reaches exact end, jump handles offsets, manual export is byte-exact',async t=>{
  const {d,$,input,downloads}=app(t);const bytes=C.cat([fixture('normal.png'),C.enc.encode('marker-12345')]);input([new File([bytes],'tail.png')]);await eventually(()=>$('statTotal').textContent==='01');
  d.querySelector('[data-tab="hex"]').click();$('tailBtn').click();await eventually(()=>$('hexRange').textContent.includes(C.hex(bytes.length)),'tail');assert.match($('hexView').textContent,/31 32 33 34 35/);
  $('offsetInput').value='0x20';$('jumpBtn').click();await eventually(()=>$('hexRange').textContent.startsWith(C.hex(32)));
  $('rangeStart').value='1';$('rangeEnd').value='0xA';$('rangeBtn').click();assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()),bytes.slice(1,10));
  $('rangeEnd').value='999999';$('rangeBtn').click();assert.equal(downloads.length,1);assert.match($('toast').textContent,/区间无效/);
});
test('correct-extension copy preserves source bytes',async t=>{
  const {input,$,downloads}=app(t),bytes=fixture('normal.png');input([new File([bytes],'wrong.jpg')]);await eventually(()=>$('statTotal').textContent==='01');assert.equal($('correctBtn').hidden,false);$('correctBtn').click();assert.equal(downloads[0].name,'wrong.png');assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()),bytes);
});
test('filename HTML remains text; search and report work',async t=>{
  const {input,w,d,$,downloads}=app(t),name='<img src=x onerror=alert(1)>.png';input([new File([fixture('normal.png')],name)]);await eventually(()=>$('statTotal').textContent==='01');
  assert.equal(d.querySelectorAll('img:not(#creatorAvatar)').length,0);assert.equal($('detailName').textContent,name);
  $('searchInput').value='missing';$('searchInput').dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('.file-row').length,0);
  $('reportBtn').click();const report=JSON.parse(await downloads[0].blob.text());assert.equal(report.files[0].name,name);assert.equal(report.files[0].sha256.length,64);
});
test('folder picker click does not also open regular file picker',t=>{
  const {w,$}=app(t);let file=0,folder=0;const native=w.HTMLInputElement.prototype.click;
  $('fileInput').click=function(){file++;native.call(this);};$('folderInput').click=function(){folder++;native.call(this);};
  $('folderBtn').click();assert.equal(folder,1);assert.equal(file,0);$('addBtn').click();assert.equal(file,1);assert.equal(folder,1);
});
test('drop file fallback enqueues and scans',async t=>{
  const {w,d,$}=app(t),event=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[new File([fixture('normal.jpg')],'drop.jpg')],items:[]}});d.dispatchEvent(event);await eventually(()=>$('statTotal').textContent==='01');assert.equal($('detailName').textContent,'drop.jpg');
});
test('folder drag walks multiple batches and nested directories',async t=>{
  const {w,d,$}=app(t);const file=name=>({isFile:true,file:cb=>cb(new File([fixture('normal.png')],name))});
  const dir=entries=>({isDirectory:true,createReader:()=>{let i=0;return {readEntries:cb=>cb(entries[i++]||[])};}});
  const event=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[],items:[{webkitGetAsEntry:()=>dir([[file('one.png')],[dir([[file('nested.png')]])]])}]}});d.dispatchEvent(event);await eventually(()=>$('statTotal').textContent==='02');
});
test('scan can stop, resume and clear in-memory queue',async t=>{
  const {input,$,d}=app(t),data=fixture('normal.png');input([new File([data],'a.png'),new File([data],'b.png')]);$('cancelBtn').click();assert.equal($('progressArea').hidden,true);assert.match($('fileList').textContent,/已停止/);
  $('retryBtn').click();await eventually(()=>$('statTotal').textContent==='02');$('clearBtn').click();assert.equal($('statTotal').textContent,'00');assert.equal($('detail').hidden,true);assert.equal($('exportBtn').disabled,true);
});
test('oversize files show failed status without a success verdict',async t=>{
  const {input,$}=app(t),file=new File([new Uint8Array([1])],'too-big.png');Object.defineProperty(file,'size',{value:129*1024*1024});input([file]);await eventually(()=>$('fileList').textContent.includes('无法分析'));assert.match($('overviewPanel').textContent,/128 MiB/);assert.equal($('statTotal').textContent,'00');
});
test('individual payload and raw tail downloads retain correct bytes',async t=>{
  const {input,d,$,downloads}=app(t),png=fixture('normal.png'),zip=fixture('deflated.zip'),padding=C.enc.encode('unclassified');input([new File([png,zip,padding],'tail.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="extract"]').click();d.querySelector('[data-carve]').click();$('rawTailBtn').click();await eventually(()=>downloads.length===2);assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()),zip);assert.deepEqual(new Uint8Array(await downloads[1].blob.arrayBuffer()),C.cat([zip,padding]));
});
test('file tree preserves folder paths, aggregates sizes and filters inclusive byte intervals',async t=>{
  const {input,d,$,w}=app(t),a=new File([new Uint8Array(100)],'small.bin'),b=new File([new Uint8Array(200)],'large.bin');Object.defineProperty(a,'webkitRelativePath',{value:'case/photos/small.bin'});Object.defineProperty(b,'webkitRelativePath',{value:'case/docs/large.bin'});input([a,b]);await eventually(()=>$('statTotal').textContent==='02');assert.equal(d.querySelectorAll('.tree-directory').length,3);assert.match($('fileList').textContent,/300 B/);
  $('sizeUnit').value='1';$('minSize').value='100';$('maxSize').value='100';$('maxSize').dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('.file-row').length,1);assert.match($('fileList').textContent,/small.bin/);assert.match($('sizeFilterHint').textContent,/100 B/);
  $('resetSize').click();$('listMode').value='list';$('listMode').dispatchEvent(new w.Event('change'));$('sortSelect').value='sizeDesc';$('sortSelect').dispatchEvent(new w.Event('change'));assert.match(d.querySelector('.file-row').textContent,/large.bin/);
});
test('EXIF GPS worker, field search and JSON export',async t=>{
  const {input,d,$,w,downloads}=app(t);input([new File([fixture('gps.jpg')],'gps.jpg')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="exif"]').click();await eventually(()=>$('gpsSummary').textContent.includes('37.5000000'),'GPS');assert.match($('gpsSummary').textContent,/-122.2500000/);assert.match($('exifTable').textContent,/HexScope Synthetic Camera/);$('exifSearch').value='Make';$('exifSearch').dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('#exifTable tbody tr').length,1);$('exifExport').click();assert.equal(JSON.parse(await downloads[0].blob.text()).metadata.gps.longitude,-122.25);
});
test('encoding workspace Base64, next conversion and binary download',async t=>{
  const {$,w,downloads}=app(t);$('codecMode').click();assert.equal($('codecWorkspace').hidden,false);$('codecFrom').value='base64';$('codecTo').value='utf8';$('codecInput').value='ZmxhZ3t0ZXN0fQ==';$('codecRun').click();await eventually(()=>$('codecOutput').value==='flag{test}');$('codecBytesSave').click();assert.equal(await downloads[0].blob.text(),'flag{test}');$('codecNext').click();assert.equal($('codecInput').value,'flag{test}');assert.equal($('codecFrom').value,'utf8');$('codecSwap').click();assert.equal($('codecBytesSave').disabled,true);
});
test('strings extraction finds offset and forwards source text to codec workspace',async t=>{
  const {input,d,$}=app(t);input([new File([new Uint8Array([0,0]),new TextEncoder().encode('ZmxhZ3t0ZXN0fQ=='),new Uint8Array([0])],'encoded.bin')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="strings"]').click();$('stringNeedle').value='Zmx';$('stringScan').click();await eventually(()=>d.querySelectorAll('.string-row').length===1);assert.match($('stringResults').textContent,/0x00000002/);d.querySelector('[data-string-codec]').click();assert.equal($('codecWorkspace').hidden,false);assert.equal($('codecInput').value,'ZmxhZ3t0ZXN0fQ==');
});
test('LSB worker extracts known bytes, auto scanner finds flag and export matches',async t=>{
  const {input,d,$,downloads}=app(t);input([new File([fixture('lsb_flag.png')],'hidden.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="pixels"]').click();$('lsbRun').click();await eventually(()=>$('lsbPreview').textContent.includes('flag{hexscope_lsb_test}'),'LSB');$('lsbSave').click();assert.match(await downloads[0].blob.text(),/^flag\{hexscope_lsb_test\}/);$('lsbAuto').click();await eventually(()=>$('lsbHits').textContent.includes('flag{hexscope_lsb_test}'),'LSB auto');$('lsbReanalyze').click();await eventually(()=>$('statTotal').textContent==='02');
});
test('specialist tab and six family selectors show exactly one tool card',async t=>{const {d,$,input}=app(t);input([new File([fixture('normal.png')],'a.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();assert.equal($('labPanel').hidden,false);assert.equal($('overviewPanel').hidden,true);for(const family of ['png','text','audio','image','animation','zip']){d.querySelector('[data-lab="'+family+'"]').click();assert.equal(Array.from(d.querySelectorAll('.lab-card')).filter(x=>!x.hidden).length,1);assert.equal($('lab-'+family).hidden,false);}});
test('ZIP fake encryption worker audit, repaired download and JSON report',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('zip_fake_encryption.zip')],'fake.zip')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('zipAudit').click();await eventually(()=>!$('zipRepair').disabled);assert.match($('zipResults').textContent,/伪加密已验证/);$('zipRepair').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()),fixture('lab_normal.zip'));$('labReport').click();const report=JSON.parse(await downloads[1].blob.text());assert.equal(report.operation,'zipRepair');assert.equal(report.sourceSHA256.length,64);assert.equal(report.result.data.previewOnly,true);});
test('ZIP real encryption remains blocked with a clear explanation',async t=>{const {d,$,input}=app(t);input([new File([fixture('zip_real_encryption.zip')],'real.zip')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('zipAudit').click();await eventually(()=>$('zipResults').textContent.includes('1 个成员'));assert.equal($('zipRepair').disabled,true);assert.equal($('labSave').disabled,true);assert.match($('labStatus').textContent,/不生成/);});
test('PNG search candidate fills controls, validated repair saves exact original',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('png_height.png')],'height.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('pngMax').value='256';$('pngSearch').click();await eventually(()=>d.querySelector('[data-png-w]'));d.querySelector('[data-png-w]').click();assert.equal($('pngWidth').value,'256');assert.equal($('pngHeight').value,'96');$('pngDimensions').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()),fixture('height_original.png'));});
test('PNG chunks and palette use common download route without writing source',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('palette_lsb.png')],'palette.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('pngPalette').click();await eventually(()=>$('paletteColors').children.length===256);assert.match($('labPreview').textContent,/flag\{palette_bits\}/);$('labSave').click();assert.match(await downloads[0].blob.text(),/^flag\{palette_bits\}/);$('pngAudit').click();await eventually(()=>d.querySelector('[data-png-chunk]'));d.querySelector('[data-png-chunk]').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();assert.equal(downloads[1].blob.size,13);});
test('zero width audit visibly names characters and extracts correct bytes',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('zero_width.txt')],'hidden.txt')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('textAudit').click();await eventually(()=>$('textResults').textContent.includes('U+200B'));$('textBits').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();assert.equal(await downloads[0].blob.text(),'flag{zero_width}');});
test('trailing whitespace presets and scope recover hidden message',async t=>{const {d,w,$,input}=app(t);input([new File([fixture('trailing_whitespace.txt')],'space.txt')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('textPreset').value='space';$('textPreset').dispatchEvent(new w.Event('change'));$('textScope').value='line-end';$('textBits').click();await eventually(()=>$('labPreview').textContent.includes('flag{trailing_whitespace}'));assert.equal($('textZero').value,'0020');});
test('Base64 padding mode explains noncanonical lines and saves raw hidden bytes',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('base64_pad_bits.txt')],'padding.txt')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('base64Padding').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();assert.equal(await downloads[0].blob.text(),'flag{base64_pad_bits}');assert.match($('textResults').textContent,/非零填充/);});
test('text audit escapes HTML-like cover content and reports invalid UTF8',async t=>{const {d,$,input,row}=app(t);input([new File(['<img src=x onerror=alert(1)>\u200b'],'cover.txt'),new File([new Uint8Array([255])],'invalid.txt')]);await eventually(()=>$('statTotal').textContent==='02');row('cover.txt').click();d.querySelector('[data-tab="lab"]').click();$('textAudit').click();await eventually(()=>$('textResults').textContent.includes('<img'));assert.equal(d.querySelectorAll('img:not(#creatorAvatar)').length,0);row('invalid.txt').click();$('textAudit').click();await eventually(()=>$('labStatus').textContent.includes('分析失败'));assert.equal($('labSave').disabled,true);});
test('audio worker restores PCM LSB and generates byte-exact reverse copy',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('audio_lsb.wav')],'signal.wav')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('audioLSB').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();assert.match(await downloads[0].blob.text(),/^flag\{pcm_sample_lsb\}/);$('audioReverse').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();const a=new Uint8Array(await downloads[1].blob.arrayBuffer());assert.deepEqual(a.subarray(44,48),fixture('audio_lsb.wav').subarray(-4));});
test('audio plots pass expected dimensions to canvas and export is connected',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('audio_lsb.wav')],'signal.wav')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('audioAnalyze').click();await eventually(()=>!$('spectrogramSave').disabled);assert.equal($('waveCanvas')._unitStroked,true);const c=$('spectrogramCanvas');assert.equal(c._unitPixels.length,c.width*c.height*4);assert.match($('spectrogramAxis').textContent,/4000 Hz/);$('spectrogramSave').click();assert.match(downloads[0].name,/spectrogram.png$/);});
test('DTMF worker displays known keypad tones and approximate time stamps',async t=>{const {d,$,input}=app(t);input([new File([fixture('dtmf_keypad.wav')],'tones.wav')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('audioDTMF').click();await eventually(()=>$('dtmfResults').textContent.includes('123A456B789C*0#D'));assert.equal(d.querySelectorAll('#dtmfResults tbody tr').length,16);});
test('reference image XOR transfers exact pixels to image canvas',async t=>{const {d,w,$,input}=app(t);input([new File([fixture('pair_hidden.png')],'hidden.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();Object.defineProperty($('imageReference'),'files',{value:[new File([fixture('pair_reference.png')],'reference.png')],configurable:true});$('imageReference').dispatchEvent(new w.Event('change'));$('imageOperation').value='xor';$('imageRun').click();await eventually(()=>!$('imageSave').disabled);global.HexCore=C;global.fflate=require('../vendor/fflate.js');const T=require('../src/ctf.js'),expected=T.pixels(fixture('pair_expected.png'));assert.deepEqual(Array.from($('compareCanvas')._unitPixels),Array.from(expected.rgba));});
test('animated PNG frames preview and export retain manifest and decodable structure',async t=>{const {d,$,input,downloads}=app(t);input([new File([fixture('hidden_frames.png')],'animated.png')]);await eventually(()=>$('statTotal').textContent==='01');d.querySelector('[data-tab="lab"]').click();$('animationInspect').click();await eventually(()=>d.querySelectorAll('[data-frame]').length===3);d.querySelector('[data-frame="1"]').click();await eventually(()=>!$('labSave').disabled);assert.equal(d.querySelector('#animationStage img').alt,'原始局部帧 2');$('labSave').click();const frame=new Uint8Array(await downloads[0].blob.arrayBuffer());assert(C.parse(frame,0,'PNG').verified);$('animationExport').click();await eventually(()=>!$('labSave').disabled);$('labSave').click();const zip=C.parseZip(new Uint8Array(await downloads[1].blob.arrayBuffer()),0);assert.equal(zip.entries.length,4);});
test('cancel and file switch clear old outputs and do not accept stale worker results',async t=>{const {d,$,input,row}=app(t);input([new File([fixture('png_height.png')],'height.png'),new File([fixture('zero_width.txt')],'text.txt')]);await eventually(()=>$('statTotal').textContent==='02');row('height.png').click();d.querySelector('[data-tab="lab"]').click();$('pngSearch').click();$('labCancel').click();assert.match($('labStatus').textContent,/已停止/);assert.equal($('labSave').disabled,true);row('text.txt').click();$('textBits').click();await eventually(()=>!$('labSave').disabled);assert.match($('labPreview').textContent,/flag\{zero_width\}/);row('height.png').click();assert.equal($('labSave').disabled,true);assert.equal($('labPreview').textContent,'');});
