(function(root,factory){
  'use strict';
  const login=factory();
  if(typeof module==='object'&&module.exports)module.exports=login;
  else login.mount(root.document,root.crypto);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const groups=[Array.from('0123456789'),
    Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'),Array.from('!@#$%^&*()-_=+[]{}:;,.?/~<>')];
  const alphabet=groups.flat();
  function generateChallenge(random=globalThis.crypto){
    if(!random||typeof random.getRandomValues!=='function')throw Error('Secure randomness unavailable');
    const word=new Uint32Array(1);
    function index(limit){
      const ceiling=0x100000000-(0x100000000%limit);
      do{random.getRandomValues(word);}while(word[0]>=ceiling);
      return word[0]%limit;
    }
    const chars=groups.map(group=>group[index(group.length)]);
    while(chars.length<21)chars.push(alphabet[index(alphabet.length)]);
    for(let i=chars.length-1;i>0;i--){const j=index(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
    return chars.join('');
  }
  function passwordFor(challenge){
    const chars=Array.from(challenge);
    if(chars.length!==21)throw Error('Invalid challenge length');
    return [0,2,4,6].map(i=>chars[i]).join('');
  }
  function mount(document,random){
    const view=document.defaultView,screen=document.getElementById('loginScreen'),shell=document.getElementById('appShell');
    const form=document.getElementById('loginForm'),input=document.getElementById('loginInput'),submit=document.getElementById('loginSubmit');
    let challenge='',unlocked=false,starting=false,composing=false;
    function blockDrop(event){if(!unlocked){event.preventDefault();event.stopImmediatePropagation();}}
    view.addEventListener('dragover',blockDrop,true);view.addEventListener('drop',blockDrop,true);
    try{
      challenge=generateChallenge(random);
      const output=document.getElementById('loginChallenge');
      for(const char of Array.from(challenge)){const span=document.createElement('span');span.textContent=char;output.append(span);}
      input.disabled=false;submit.disabled=false;input.focus();
    }catch{return;}
    input.addEventListener('compositionstart',()=>{composing=true;});
    input.addEventListener('compositionend',()=>{composing=false;});
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&(composing||event.isComposing||event.keyCode===229)){event.preventDefault();event.stopPropagation();}
    });
    input.addEventListener('input',()=>input.removeAttribute('aria-invalid'));
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(unlocked||starting||composing)return;
      if(input.value!==passwordFor(challenge)){
        input.value='';input.setAttribute('aria-invalid','true');input.focus();return;
      }
      starting=true;submit.disabled=true;input.value='';
      let startupError=false;
      const failed=()=>{startupError=true;};view.addEventListener('error',failed);
      try{
        // Preserve source IDs for the worker and verification paths. Execute each UI entry once.
        for(const source of document.querySelectorAll('script[data-hexscope-startup]')){
          const script=document.createElement('script');script.textContent=source.textContent;
          document.head.append(script);script.remove();
          if(startupError)throw Error('Workspace initialization failed');
        }
        shell.hidden=false;shell.inert=false;shell.removeAttribute('inert');shell.removeAttribute('aria-hidden');
        unlocked=true;challenge='';screen.remove();document.body.classList.remove('login-locked');
        view.removeEventListener('dragover',blockDrop,true);view.removeEventListener('drop',blockDrop,true);
        document.getElementById('addBtn').focus();
      }catch{
        // Leave the workbench inaccessible if startup fails; do not duplicate partially bound listeners.
        shell.hidden=true;shell.inert=true;shell.setAttribute('inert','');shell.setAttribute('aria-hidden','true');input.disabled=true;
      }finally{view.removeEventListener('error',failed);}
    });
  }
  return Object.freeze({generateChallenge,passwordFor,mount});
});
