'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=__dirname,vendor=path.join(root,'vendor/cyberchef'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function extensionAssets(read){
 const html=read('extensions/vendor/cyberchef/CyberChef_v11.5.0.html');
 const bridge=read('extensions/bridge.js');new vm.Script(bridge);
 const csp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 const modified=html.replace('<head>',()=>'<head><meta http-equiv="Content-Security-Policy" content="'+csp+'">').replace('</body>',()=>'<script>'+bridge.replace(/<\/script/gi,'<\\/script')+'</script></body>');
 if(modified===html||!modified.includes('hexscope-extension-v1'))throw Error('Extension bridge was not inserted');
 fs.writeFileSync(path.join(root,'index.html'),modified);
 const files={};function walk(dir){for(const file of fs.readdirSync(dir)){const p=path.join(dir,file);if(fs.statSync(p).isDirectory())walk(p);else files[path.relative(vendor,p).replace(/\\/g,'/')]=sha(fs.readFileSync(p));}}walk(vendor);
 fs.writeFileSync(path.join(root,'ASSET_HASHES.json'),JSON.stringify({version:'11.5.0',entrySHA256:sha(Buffer.from(modified)),files},null,2)+'\n');
 return {EXTENSION_UI:read('extensions/ui.js'),EXTENSION_CSS:read('extensions/style.css'),EXTENSION_HTML:read('extensions/panel.html')};
}
module.exports={extensionAssets};
