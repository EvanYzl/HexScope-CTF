(function(){
'use strict';
const H=window.HexApp,$=H.$,channel='hexscope-extension-v1',origin='hexscope-tools://local';let frame=null,serial=0;const requests=new Map();
const status=text=>$('extensionStatus').textContent=text;
function launch(){
 if(frame)return;if(!window.hexscopeVision)throw Error('扩展引擎需要 Windows 便携包内置资源。');
 frame=document.createElement('iframe');frame.title='离线编码与密码扩展';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads');frame.referrerPolicy='no-referrer';
 frame.src=origin+'/index.html';$('extensionStage').replaceChildren(frame);frame.onload=()=>status('引擎页面已载入。请从左侧搜索操作，并在 Recipe 配置参数。');
 status('正在载入本地扩展引擎…');
}
function request(action,extra={}){if(!frame)throw Error('请先启动离线引擎。');return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{requests.delete(id);reject(Error('扩展引擎尚未响应，可点击停止或重新启动程序。'));},15000);requests.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({channel,id,action,...extra},origin);});}
window.addEventListener('message',event=>{const data=event.data;if(event.source!==frame?.contentWindow||event.origin!==origin||data?.channel!==channel)return;const r=requests.get(data.id);if(!r)return;requests.delete(data.id);clearTimeout(r.timer);data.error?r.reject(Error(data.error)):r.resolve(data.data);});
function bind(id,fn){$(id).onclick=async()=>{try{await fn();}catch(e){status(e.message);}};}
bind('extensionLaunch',()=>launch());bind('extensionStop',async()=>{await request('stop');status('扩展计算已停止。');});
bind('extensionFromFile',async()=>{const item=H.selected();if(!item)throw Error('请先在文件分析中选择文件。');const bytes=await window.HexFileIO.read(item.file);await request('input',{bytes:bytes.slice().buffer});status('已载入 '+item.file.name+' 的完整字节。');});
bind('extensionFromText',async()=>{const bytes=new TextEncoder().encode($('codecInput').value);await request('input',{bytes:bytes.buffer});status('已载入编码工作台文本的 UTF-8 字节。');});
bind('extensionToFile',async()=>{const result=await request('output');H.addFiles([new File([result.bytes],'扩展恢复结果.bin')]);H.showWorkspace('inspection');});
bind('extensionToText',async()=>{const result=await request('output');$('codecInput').value=new TextDecoder().decode(result.bytes);H.showWorkspace('codec');});
bind('extensionReport',async()=>{const report=await request('report');H.download(JSON.stringify(report,null,2),'HexScope-extension-recipe.json','application/json');status('转换步骤已导出。');});
$('extensionPreset').onchange=async()=>{const op=$('extensionPreset').value;if(!op)return;try{await request('recipe',{recipe:[{op,args:[]}]});status('已载入 '+op+'，请检查参数和输入后运行。');}catch(e){status(e.message);}finally{$('extensionPreset').value='';}};
const nav=document.createElement('button');nav.id='extensionsMode';nav.className='mode';nav.type='button';nav.textContent='扩展工坊';nav.onclick=()=>H.showWorkspace('extensions');document.querySelector('.mode-nav').insertBefore(nav,document.querySelector('.mode-nav>span'));
window.addEventListener('pagehide',()=>{for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('页面已关闭'));}requests.clear();});
window.HexExtensions={launch,request};
})();
