'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const sha=data=>createHash('sha256').update(data).digest('hex');
let cached;
function readBuiltHTML(){
  if(cached)return cached;
  const html=fs.readFileSync(path.join(root,'../HexScope.html'));
  const record=JSON.parse(fs.readFileSync(path.join(root,'../HexScope.build.json'),'utf8'));
  assert.equal(record.version,'4.1.0','Tests require the integrated 4.1 build');
  assert.equal(record.edition,'crypto-integrated');
  assert.equal(record.htmlSHA256,sha(html),'Generated HTML differs from the build manifest; rebuild first');
  for(const [file,digest] of Object.entries(record.inputs))
    assert.equal(sha(fs.readFileSync(path.join(root,file))),digest,'Stale build input: '+file+'; run node build.cjs');
  return cached=html.toString('utf8');
}
function script(html,id){
  const match=html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)</script>'));
  assert(match,'Missing built script: '+id);
  return match[1];
}
module.exports={readBuiltHTML,script};
