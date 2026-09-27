'use strict';
const assert=require('node:assert/strict');
// Exercise the real form rather than injecting a test bypass into the product.
module.exports=function unlock(window){
  const d=window.document,chars=Array.from(d.getElementById('loginChallenge').textContent);
  assert.equal(chars.length,21);assert.equal(d.getElementById('appShell').hidden,true);
  d.getElementById('loginInput').value=[0,2,4,6].map(i=>chars[i]).join('');
  d.getElementById('loginForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(d.getElementById('appShell').hidden,false,'workbench starts through the real login form');
  assert.equal(d.getElementById('loginScreen'),null);
};
