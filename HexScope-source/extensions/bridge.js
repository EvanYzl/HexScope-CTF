(function(){
'use strict';
// Parent/child messages carry data only; neither side accepts code or filesystem paths.
const channel='hexscope-extension-v1',limit=128*1024*1024;
function send(id,data,error){window.parent.postMessage({channel,id,data,error},'*');}
window.addEventListener('message',async event=>{
 const m=event.data;if(event.source!==window.parent||!m||m.channel!==channel||!Number.isSafeInteger(m.id)||m.id<1)return;
 try{
  const app=window.app;if(!app?.manager?.input?.inputWorker)throw Error('扩展工具仍在初始化，请稍后重试。');
  if(m.action==='ready'){send(m.id,{ready:true,operations:Object.keys(app.operations).length});return;}
  if(m.action==='stop'){app.manager.worker.cancelBake(false,true);send(m.id,{stopped:true});return;}
  if(m.action==='recipe'){
   if(!Array.isArray(m.recipe)||m.recipe.length>100||m.recipe.some(x=>!x||!Object.hasOwn(app.operations,x.op)||!Array.isArray(x.args)))throw Error('转换步骤无效。');
   app.setRecipeConfig(m.recipe);send(m.id,{recipe:app.getRecipeConfig()});return;
  }
  if(m.action==='input'){
   if(!(m.bytes instanceof ArrayBuffer)||m.bytes.byteLength>limit)throw Error('扩展输入上限 128 MiB。');
   const tab=app.manager.tabs.getActiveTab('input');
   // set() schedules the editor update and intentionally never resolves in the
   // upstream UI; acknowledge after the scheduled update, without awaiting it.
   app.manager.input.set(tab,{type:'userinput',buffer:m.bytes,encoding:0,eolSequence:'\n'},false);
   setTimeout(()=>send(m.id,{bytes:m.bytes.byteLength}),30);return;
  }
  if(m.action==='output'){
   const tab=app.manager.tabs.getActiveTab('output'),out=app.manager.output.outputs[tab];
   if(!out||out.status!=='baked')throw Error('请先完成 Bake 转换，再获取结果。');
   const dish=app.manager.output.getOutputDish(tab);if(!dish)throw Error('当前转换没有可导出的结果。');
   const bytes=await app.manager.output.getDishBuffer(dish);if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>limit)throw Error('输出超过 128 MiB。');
   send(m.id,{bytes,recipe:app.getRecipeConfig()});return;
  }
  if(m.action==='report'){send(m.id,{recipe:app.getRecipeConfig(),engine:'CyberChef 11.5.0',offline:true,createdAt:new Date().toISOString()});return;}
  throw Error('未知的扩展操作。');
 }catch(error){send(m.id,null,error.message);}
});
// External links remain informational; opening them is disabled by the host.
})();
