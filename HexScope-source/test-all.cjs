'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=__dirname,sha=data=>createHash('sha256').update(data).digest('hex');
const build=spawnSync(process.execPath,[path.join(root,'build.cjs')],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status||1);
const output=path.resolve(process.argv[2]||path.join(root,'../集成验证'));
fs.mkdirSync(output,{recursive:true});
const files=['tests','crypto/tests'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(x=>x.endsWith('.test.cjs')).sort().map(x=>path.join(root,folder,x)));
const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const log=(run.stdout||'')+(run.stderr||'');fs.writeFileSync(path.join(output,'自动化测试.log'),log);
if(run.status!==0){console.error(log.slice(-18000));throw run.error||Error('Integrated test run failed: '+run.status);}
const count=name=>Number(log.match(new RegExp('^# '+name+' (\\d+)\\r?$','m'))?.[1]);
const result={tests:count('tests'),passed:count('pass'),failed:count('fail'),cancelled:count('cancelled'),skipped:count('skipped')};
if(!result.tests||result.tests!==result.passed||result.failed||result.cancelled||result.skipped)throw Error('Incomplete test report');
const inputs={};
function walk(dir){for(const name of fs.readdirSync(dir)){if(['node_modules','history','engines'].includes(name))continue;const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else inputs[path.relative(root,p).replace(/\\/g,'/')]=sha(fs.readFileSync(p));}}
walk(root);
const html=fs.readFileSync(path.join(root,'../HexScope.html'));
const report={version:'4.1.0',edition:'crypto-integrated',createdAt:new Date().toISOString(),runtime:process.versions.node,platform:process.platform,...result,
 htmlSHA256:sha(html),testFiles:files.map(x=>path.relative(root,x).replace(/\\/g,'/')),inputs,
 boundaries:['Offline OCR (English, mixed Chinese/English), barcode standard samples, documents, cancellation and byte handoff tested. All 73 model files checked by hash; recognition quality of other languages not tested.','Extension recipes execute the exact bundled upstream Worker. Full embedded browser UI and real custom-protocol loading not exercised. Screenshot capture, global hotkeys and pinned windows are mocked.','DOM and actual worker computation tested. PDF native off-screen canvas rendering tested; actual desktop window layout, OS dialogs and drag/drop not tested.','Actual E01 reads, media/file hashing and VHD conversion tested. Drive-letter changes and UAC are mocked, not performed.','Document samples tested, not all Office/PDF variants or media codecs. Image controls and media UI lifecycle tested; interactive native image/media playback not tested.','Native file IO and E01 extraction/export use real files and worker computation; unreadable File errors and Electron preload/IPC transport are simulated. The original user failing file, native file-picker and save dialogs were not tested.']};
fs.writeFileSync(path.join(output,'自动化测试.json'),JSON.stringify(report,null,2)+'\n');
console.log('Integrated 4.1: '+result.passed+'/'+result.tests+' passed; report: '+output);
