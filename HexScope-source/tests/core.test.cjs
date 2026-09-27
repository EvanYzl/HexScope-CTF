const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const C=require('../src/core.js');
const bytes=s=>C.enc.encode(s);
const read=name=>new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures',name)));
const png=()=>read('normal.png');
const archive=()=>C.makeZip([{name:'secret.txt',data:bytes('hidden content')},{name:'data.bin',data:new Uint8Array([0,255,4,89])}]);
const join=(...parts)=>C.cat(parts);
const pngChunk=(type,data)=>{const a=new Uint8Array(12+data.length),v=new DataView(a.buffer);v.setUint32(0,data.length);a.set(bytes(type),4);a.set(data,8);v.setUint32(8+data.length,C.crc32(a,4,8+data.length));return a;};

for(const [file,type] of [['normal.png','PNG'],['normal.jpg','JPEG'],['progressive.jpg','JPEG'],['normal.gif','GIF'],['animated.gif','GIF'],['normal.webp','WEBP'],['lossless.webp','WEBP'],['animated.webp','WEBP'],['normal.bmp','BMP']]) {
  test('real image stays clean: '+file,()=>{const a=read(file),r=C.analyze(a,file);assert.equal(r.type,type);assert.equal(r.end,a.length);assert.equal(r.matches,true);assert.equal(r.status,'clean');assert.equal(r.findings.length,0);});
  test('carve appended ZIP from '+file,()=>{const base=read(file),zip=archive(),a=join(base,zip),r=C.analyze(a,file);assert.equal(r.end,base.length);assert.equal(r.findings.length,1);const f=r.findings[0];assert.equal(f.level,'verified');assert.equal(f.type,'ZIP');assert.deepEqual(C.carve(a,f),zip);});
}
test('renamed PNG is detected independently of extension case',()=>{assert.equal(C.analyze(png(),'伪装.JpG').matches,false);assert.equal(C.analyze(png(),'REAL.PNG').matches,true);assert.equal(C.analyze(png(),'no_extension').matches,false);});
test('unknown and empty input never claim extension matches',()=>{assert.equal(C.analyze(bytes('hello'),'image.png').matches,null);assert.equal(C.analyze(new Uint8Array(),'empty.png').matches,null);});
test('truncated PNG does not gain a fake tail boundary',()=>{const a=png().slice(0,-4),r=C.analyze(a,'x.png');assert.equal(r.end,null);assert.equal(r.status,'damaged');assert.equal(r.tail,null);});
test('PNG bad CRC is reported and does not auto-select payload',()=>{const a=join(png(),archive());a[29]^=1;const r=C.analyze(a,'x.png');assert.match(r.notes.join(' '),/CRC/);assert.equal(r.boundaryVerified,false);assert.equal(r.findings[0].level,'embedded');});
test('fake IEND and archive in metadata do not truncate main PNG',()=>{const base=png(),data=join(bytes('comment\0fake IEND '),archive()),chunk=pngChunk('tEXt',data),a=join(base.slice(0,33),chunk,base.slice(33)),r=C.analyze(a,'meta.png');assert.equal(r.end,a.length);assert.equal(r.tail,null);assert.equal(r.findings.length,1);assert.equal(r.findings[0].level,'embedded');assert.equal(r.findings[0].context,'metadata');});
test('archive-looking raw bytes in IDAT are not hidden-file findings',()=>{const base=png(),a=join(base.slice(0,33),pngChunk('IDAT',archive()),base.slice(33)),r=C.analyze(a,'idat.png');assert.equal(r.findings.length,0);});
test('JPEG COM with false EOI does not shorten image',()=>{const base=read('normal.jpg'),payload=new Uint8Array([255,217,255,216,0,42]),seg=join(new Uint8Array([255,254,0,payload.length+2]),payload),a=join(base.slice(0,2),seg,base.slice(2)),r=C.analyze(a,'comment.jpg');assert.equal(r.end,a.length);assert.equal(r.tail,null);assert.equal(r.status,'clean');});
test('GIF comment semicolons are not trailers',()=>{const base=read('normal.gif'),a=join(base.slice(0,-1),new Uint8Array([33,254,3,59,59,59,0]),base.slice(-1)),r=C.analyze(a,'comment.gif');assert.equal(r.end,a.length);assert.equal(r.tail,null);});
test('RIFF overclaim is damaged',()=>{const a=read('normal.webp');new DataView(a.buffer).setUint32(4,0xfffffffe,true);assert.equal(C.analyze(a,'x.webp').end,null);});
test('BMP undersized pixel array is not accepted',()=>{const a=read('normal.bmp');new DataView(a.buffer).setUint32(2,60,true);assert.equal(C.analyze(a,'x.bmp').end,null);});
test('multiple concatenated files carve separately without archive-member duplicates',()=>{const p=png(),z=archive(),j=read('normal.jpg'),a=join(p,z,j),r=C.analyze(a,'x.png');assert.equal(r.findings.length,2);assert.deepEqual(C.carve(a,r.findings[0]),z);assert.deepEqual(C.carve(a,r.findings[1]),j);});
test('unknown tail stays accessible without a false file classification',()=>{const r=C.analyze(join(png(),bytes('unrecognized text')),'x.png');assert.equal(r.tail.size,17);assert.equal(r.findings.length,0);assert.equal(r.status,'suspect');});
test('PDF and RAR only provide low-confidence hints',()=>{for(const sig of [bytes('%PDF-1.7\nnot a full document'),new Uint8Array([82,97,114,33,26,7,0,99])]){const r=C.analyze(join(png(),sig),'x.png');assert.equal(r.findings.length,1);assert.equal(r.findings[0].level,'signature');assert.equal(r.findings[0].exportable,false);}});
test('truncated ZIP local header alone is not verified',()=>{const r=C.analyze(join(png(),new Uint8Array([80,75,3,4,0,0,0,0])),'x.png');assert.equal(r.findings[0].level,'signature');});
test('ZIP stored corruption is rejected',()=>{const z=archive();z[40]^=7;assert.equal(C.parseZip(z,0).verified,false);});
test('ZIP central/local disagreement is rejected',()=>{const z=archive();new DataView(z.buffer).setUint16(8,8,true);assert.equal(C.parseZip(z,0).verified,false);});
test('ZIP path and duplicate names are flattened safely',()=>{const z=C.makeZip([{name:'../../evil.txt',data:bytes('a')},{name:'CON.txt',data:bytes('b')},{name:'same.txt',data:bytes('c')},{name:'SAME.TXT',data:bytes('d')}]),r=C.parseZip(z,0);assert.equal(r.verified,true);assert.equal(r.entries.length,4);assert.equal(r.entries[0].name.includes('/'),false);assert.equal(r.entries[1].name,'_CON.txt');assert.equal(new Set(r.entries.map(e=>e.name.toLowerCase())).size,4);});
test('Office ZIP subtype is recognized by members',()=>{const z=C.makeZip([{name:'word/document.xml',data:bytes('x')},{name:'[Content_Types].xml',data:bytes('x')}]);
  // Build with standard-library fixture style: the exporter flattens paths by design.
  const raw=z.slice();const old=bytes('word_document.xml'),name=bytes('word/document.xml');for(let i=0;i<raw.length-old.length;i++)if(old.every((b,j)=>raw[i+j]===b))raw.set(name,i);
  assert.equal(C.analyze(raw,'test.docx').type,'DOCX');assert.equal(C.analyze(raw,'test.docx').matches,true);assert.equal(C.analyze(raw,'test.png').matches,false);
});
test('absolute SFX ZIP offsets are rebased correctly even with fake signature in comment',()=>{const a=read('absolute.png'),r=C.analyze(a,'absolute.png'),f=r.findings[0];assert.equal(f.absoluteOffsets,true);const z=C.carve(a,f),parsed=C.parseZip(z,0);assert.equal(parsed.verified,true);assert.equal(parsed.end,z.length);assert.equal(parsed.entries[0].name,'absolute.txt');});
test('Deflate and descriptor ZIPs round-trip with CRC',async()=>{for(const file of ['deflated.zip','descriptor.zip']){const a=read(file),r=C.parseZip(a,0);assert.equal(r.verified,true);for(const entry of r.entries){const compressed=a.subarray(entry.dataStart,entry.dataEnd),data=await C.inflateEntry(compressed,entry);assert.deepEqual(data,new Uint8Array(zlib.inflateRawSync(compressed)));assert.equal(C.crc32(data),entry.crc);}}});
test('decompression refuses encrypted and oversized members',async()=>{await assert.rejects(()=>C.inflateEntry(new Uint8Array(),{flags:1,size:0}),/加密/);await assert.rejects(()=>C.inflateEntry(new Uint8Array(),{flags:0,size:40*1024*1024}),/32 MiB/);});
test('decompression validates advertised size and CRC',async()=>{const z=read('deflated.zip'),e=C.parseZip(z,0).entries[0],raw=z.subarray(e.dataStart,e.dataEnd);await assert.rejects(()=>C.inflateEntry(raw,{...e,size:1}),/大小/);await assert.rejects(()=>C.inflateEntry(raw,{...e,crc:0}),/CRC/);});
test('valid 7z start/next-header CRC determines exact end',()=>{const next=new Uint8Array([0]),a=new Uint8Array(33),v=new DataView(a.buffer);a.set([55,122,188,175,39,28,0,4]);v.setUint32(20,next.length,true);v.setUint32(28,C.crc32(next),true);v.setUint32(8,C.crc32(a,12,32),true);a.set(next,32);const r=C.analyze(join(png(),a,bytes('trailing')),'x.png');assert.equal(r.findings[0].type,'7Z');assert.equal(r.findings[0].size,33);a[32]=4;assert.equal(C.parse(a,0,'7Z').verified,false);});
test('known CRC vector',()=>assert.equal(C.crc32(bytes('123456789')),0xcbf43926));
test('hostile names remain data and are sanitized for export',()=>{assert.equal(C.safeName('../<img onerror="alert(1)">.txt').includes('<'),false);assert.equal(C.safeName('..'),'file');assert.equal(C.safeName('LPT1'),'_LPT1');});
test('bounded random/truncated inputs do not throw',()=>{let seed=1234567;for(let n=0;n<1500;n++){const a=new Uint8Array(n%257);for(let i=0;i<a.length;i++){seed=(seed*1664525+1013904223)>>>0;a[i]=seed&255;}assert.doesNotThrow(()=>C.analyze(a,'fuzz.dat'));}});
