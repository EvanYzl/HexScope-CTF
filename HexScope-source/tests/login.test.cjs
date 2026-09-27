'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {app,eventually}=require('./dom-helper.cjs');
const {readBuiltHTML,script}=require('./built-artifact.cjs');
const box={module:{exports:{}},crypto:webcrypto,Uint32Array};vm.runInNewContext(script(readBuiltHTML(),'loginCode'),box);
const {generateChallenge,passwordFor}=box.module.exports;
const answer=ui=>{const s=Array.from(ui.$('loginChallenge').textContent);return s[0]+s[2]+s[4]+s[6];};
function submit(ui,value){ui.$('loginInput').value=value;ui.$('loginForm').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));}
function seeded(seed){return {subtle:webcrypto.subtle,getRandomValues(a){for(let i=0;i<a.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;a[i]=seed;}return a;}};}

test('login challenges are exactly 21 ASCII characters and always mix Latin, digits and punctuation',()=>{
  const random=seeded(391),seen=new Set();
  for(let i=0;i<256;i++){
    const value=generateChallenge(random);assert.equal(Array.from(value).length,21);
    assert.match(value,/[0-9]/);assert.match(value,/[A-Za-z]/);assert.match(value,/[!@#$%^&*()\-_=+\[\]{}:;,.?/~<>]/);
    assert.match(value,/^[\x21-\x7e]{21}$/);seen.add(value);
  }
  assert.equal(seen.size,256);assert.throws(()=>generateChallenge({}),/randomness/);
});
test('login derives the specified positions without losing punctuation or letter case',()=>{
  assert.equal(passwordFor('a1B2c3D4e5F6g7H8i9J0!'),'aBcD');
  assert.equal(passwordFor('!A<B&c>D1E2F3G4H5I6J7'),'!<&>');
  assert.throws(()=>passwordFor('short'),/length/);
});
test('built page stays locked without starting native bridges and exposes no rule, placeholder or tooltip',t=>{
  let calls=0;const ui=app(t,{status(){calls++;},hashCapabilities(){calls++;},onProgress(){calls++;}},{locked:true});
  assert.equal(ui.w.HexApp,undefined);assert.equal(calls,0);assert.equal(ui.$('appShell').hidden,true);assert(ui.$('appShell').hasAttribute('inert'));
  assert.equal(ui.$('loginInput').type,'password');assert.equal(ui.$('loginInput').value,'');assert.equal(ui.d.activeElement,ui.$('loginInput'));
  assert.equal(ui.$('loginScreen').querySelectorAll('[placeholder],[title],[data-password],[aria-description]').length,0);
  assert.equal(ui.$('loginChallenge').children.length,21);assert.equal(ui.$('loginChallenge').querySelectorAll('script,img,a').length,0);
  const visible=ui.$('loginScreen').textContent.replace(ui.$('loginChallenge').textContent,'').replace(/\s/g,'');
  assert.equal(visible,'H›HexScopeCTF登录');
});
test('wrong, empty and padded submissions keep the challenge and workbench locked without explanatory text',t=>{
  const ui=app(t,null,{locked:true}),challenge=ui.$('loginChallenge').textContent,text=ui.$('loginScreen').textContent,correct=answer(ui);
  for(const value of ['',correct+'x',' '+correct,correct+' ']){
    submit(ui,value);assert.equal(ui.$('appShell').hidden,true);assert.equal(ui.w.HexApp,undefined);
    assert.equal(ui.$('loginChallenge').textContent,challenge);assert.equal(ui.$('loginScreen').textContent,text);
    assert.equal(ui.$('loginInput').value,'');assert.equal(ui.$('loginInput').getAttribute('aria-invalid'),'true');
  }
  ui.$('loginInput').dispatchEvent(new ui.w.Event('input'));assert.equal(ui.$('loginInput').hasAttribute('aria-invalid'),false);
});
test('correct submission starts the real workbench once and existing file analysis operates after login',async t=>{
  const ui=app(t,null,{locked:true}),form=ui.$('loginForm'),input=ui.$('loginInput');submit(ui,answer(ui));
  assert.equal(ui.$('loginScreen'),null);assert.equal(ui.$('appShell').hidden,false);assert.equal(ui.$('appShell').hasAttribute('inert'),false);
  assert.equal(input.value,'');assert.equal(ui.d.activeElement,ui.$('addBtn'));assert(ui.w.HexApp);assert(ui.w.HexPreview);assert(ui.$('cryptoMode'));
  const original=ui.w.HexApp;form.dispatchEvent(new ui.w.Event('submit',{cancelable:true}));assert.equal(ui.w.HexApp,original);
  ui.$('demoBtn').click();await eventually(()=>ui.$('statTotal').textContent==='04');assert.equal(ui.w.HexApp.state.items.length,4);
});
test('IME confirmation does not submit prematurely and committed input can log in',t=>{
  const ui=app(t,null,{locked:true}),input=ui.$('loginInput'),correct=answer(ui);
  input.dispatchEvent(new ui.w.CompositionEvent('compositionstart'));input.value=correct;
  const key=new ui.w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});input.dispatchEvent(key);assert.equal(key.defaultPrevented,true);
  ui.$('loginForm').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));assert.equal(ui.$('appShell').hidden,true);assert.equal(input.value,correct);
  input.dispatchEvent(new ui.w.CompositionEvent('compositionend'));submit(ui,correct);assert.equal(ui.$('appShell').hidden,false);
});
test('file drops cannot navigate or call the image bridge while the login page is locked',t=>{
  let opened=0;const ui=app(t,{openDropped(){opened++;}},{locked:true});let reached=false;
  ui.d.addEventListener('drop',()=>{reached=true;});
  for(const type of ['dragover','drop']){
    const event=new ui.w.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[new File(['x'],'case.E01')]}});
    ui.d.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
  }
  assert.equal(opened,0);assert.equal(reached,false);assert.equal(ui.w.HexApp,undefined);
});
test('fresh openings use new randomness, ignore saved login state and fail closed if randomness fails',t=>{
  const random=seeded(79),a=app(t,null,{locked:true,random}),first=a.$('loginChallenge').textContent;submit(a,answer(a));
  const b=app(t,null,{locked:true,random});assert.notEqual(b.$('loginChallenge').textContent,first);assert.equal(b.$('appShell').hidden,true);
  const bad=app(t,null,{locked:true,random:{getRandomValues(){throw Error('unavailable');}}});
  assert.equal(bad.$('loginInput').disabled,true);assert.equal(bad.$('loginSubmit').disabled,true);assert.equal(bad.$('appShell').hidden,true);assert.equal(bad.w.HexApp,undefined);
});
