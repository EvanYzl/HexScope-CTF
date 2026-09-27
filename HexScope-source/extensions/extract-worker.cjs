'use strict';
// Extract the exact worker literal used by the upstream UI, for offline tests.
// The input is the pinned vendor build, never an uploaded evidence file.
const vm=require('node:vm');
function extractWorker(source){
 const marker='/*! For license information please see ChefWorker.js.LICENSE.txt';
 for(let i=Math.max(0,source.indexOf(marker)-1);i<source.length;i++){
  const quote=source[i];if(quote!=='"'&&quote!=="'")continue;const start=i++;
  while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]===quote)break;i++;}
  if(i-start<10000)continue;const literal=source.slice(start,i+1);
  if(!literal.includes(marker)||!literal.includes('workerLoaded'))continue;
  const value=vm.runInNewContext(literal,{}, {timeout:5000});
  if(typeof value==='string'&&value.includes('workerLoaded')&&value.includes('bakeComplete'))return value;
 }
 throw Error('Unable to find pinned upstream ChefWorker literal');
}
module.exports={extractWorker};
