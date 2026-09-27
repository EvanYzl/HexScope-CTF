'use strict';
// Forked with the bundled Electron Node runtime. No user code, paths or URLs run here.
const {VisionEngine}=require('./vision-engine.cjs');
let engine;
process.once('message',async({op,args})=>{
 engine=new VisionEngine(value=>process.send?.({type:'progress',value}));
 try{const value=await engine.run(op,args);process.send?.({type:'result',value});}
 catch(e){process.send?.({type:'error',error:String(e?.message||e)});}
 finally{await engine.close();process.disconnect?.();}
});
