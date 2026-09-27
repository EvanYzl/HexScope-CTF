'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2'};
function createExtensionHandler(root){
 const base=path.resolve(root,'extensions'),vendor=path.join(base,'vendor/cyberchef');
 return async request=>{
  try{
   const url=new URL(request.url);if(url.protocol!=='hexscope-tools:'||url.hostname!=='local'||request.method&&request.method!=='GET')return new Response('Not found',{status:404});
   const name=decodeURIComponent(url.pathname);if(name.includes('\\')||name.includes('\0'))return new Response('Not found',{status:404});
   const entry=name==='/'||name==='/index.html';const target=entry?path.join(base,'index.html'):path.resolve(vendor,'.'+name);
   if(!entry&&(!target.startsWith(vendor+path.sep)||name.split('/').includes('..')))return new Response('Not found',{status:404});
   const data=await fs.readFile(target);return new Response(data,{headers:{'Content-Type':TYPES[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
  }catch{return new Response('Not found',{status:404});}
 };
}
module.exports={createExtensionHandler};
