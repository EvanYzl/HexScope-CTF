const vm=require('node:vm');
const {readBuiltHTML,script}=require('../../tests/built-artifact.cjs');
function load(){
 const html=readBuiltHTML();
 const context={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,BigInt,console,postMessage(){}};
 context.globalThis=context;context.self=context;context.window=context;vm.createContext(context);
 for(const id of ['hexCryptoWorkerSource','cryptoExamplesCode','cryptoCatalogCode'])
   vm.runInContext(script(html,id),context,{filename:'HexScope-4.1-built:'+id});
 return context;
}
module.exports={load};
