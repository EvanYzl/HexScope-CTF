'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const {cryptoAssets} = require('./crypto/build.cjs');
const {previewAssets} = require('./preview/build.cjs');
const {extensionAssets}=require('./extensions/build.cjs');
const root = __dirname, inputs = {};
const digest = data => createHash('sha256').update(data).digest('hex');
function read(file, encoding='utf8') {
  const data = fs.readFileSync(path.join(root, file));
  inputs[file] = digest(data);
  return data.toString(encoding);
}
let html = read('src/template.html');
read('build.cjs');
read('crypto/build.cjs');
read('preview/build.cjs');
const assets = {};
assets.LOGIN=read('src/login.js');
assets.SHELL_CSS=read('src/shell.css');
assets.SCAN_POOL=read('src/file-read.js')+'\n'+read('src/scan-pool.js');
const branding=JSON.parse(read('desktop/branding.json'));
if(branding.version!=='4.1.0'||!branding.author||!branding.credit)throw Error('Invalid application branding');
const escapeHTML=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
for(const key of ['HEADER_CREDIT_HTML','FOOTER_CREDIT_HTML','ABOUT_CREDIT_HTML'])assets[key]=escapeHTML(branding.credit);
assets.BRAND_AUTHOR_HTML=escapeHTML(branding.author);
assets.TITLE_AUTHOR_HTML=escapeHTML(branding.author);
assets.BRAND_REPOSITORY_HTML=escapeHTML(branding.repositoryName);
assets.APP_ICON = read('desktop/assets/hexscope.png','base64');
for (const [key, file] of Object.entries({CSS:'style.css', CORE:'core.js', CTF:'ctf.js', STEGO:'stego.js', AUDIO:'audio.js', ANIMATION:'animation.js', LAB:'lab.js', DISK:'disk.js', HASH:'hash.js', MOUNT:'mount.js', WORKER:'worker.js', APP:'app.js', EXTRA:'extra.js', EXIF:'../vendor/exifr.js', FLATE:'../vendor/fflate.js'})) {
  assets[key] = read(path.posix.normalize('src/' + file));
}
assets.CSS += '\n' + read('src/disk.css') + '\n' + read('src/hash.css');
assets.CSS += '\n' + read('src/branding.css');
assets.CSS += '\n' + read('src/login.css');
Object.assign(assets, cryptoAssets(read));
Object.assign(assets, previewAssets(read));
assets.VISION_CSS=read('vision/style.css');
assets.VISION_HTML=read('vision/panel.html');
assets.VISION_UI=read('vision/core.js')+'\n;'+read('vision/ui.js');
read('extensions/build.cjs');
Object.assign(assets,extensionAssets(read));
for (const [key, value] of Object.entries(assets)) {
  const marker = '/*__' + key + '__*/';
  if (html.split(marker).length !== 2) throw Error('Expected exactly one template marker: ' + marker);
  if (!/CSS$|HTML$|JSON$/.test(key) && key !== 'APP_ICON') new vm.Script(value, {filename:key});
  // A callback preserves literal $&, $` and $' inside vendor bundles and examples.
  html = html.replace(marker, () => /CSS$|HTML$/.test(key) ? value : value.replace(/<\/script/gi, '<\\/script'));
}
if (/\/\*__[A-Z_]+__\*\//.test(html)) throw Error('Unresolved build marker');
const catalogContext = {};
catalogContext.window = catalogContext;
vm.createContext(catalogContext);
vm.runInContext(assets.CRYPTO_EXAMPLES + '\n;' + assets.CRYPTO_CATALOG, catalogContext);
const toolCount = catalogContext.window.HexCryptoCatalog.rows.length;
if (toolCount !== 78) throw Error('Crypto catalog must contain 78 tools');
const output = path.join(root, '..', 'HexScope.html');
fs.writeFileSync(output, html);
fs.writeFileSync(path.join(root, '..', 'HexScope.build.json'), JSON.stringify({
  application:'HexScope CTF', version:'4.1.0', edition:'crypto-integrated', author:branding.author, credit:branding.credit, repository:branding.repository,
  base:'src/template.html (current 4.1)', cryptoTools:toolCount, preview:['docx','spreadsheet','pdf','image','text','audio','video','zip'],
  revision:'r8',vision:{languageModels:73,barcodeGenerators:111,offlineCPU:true},extensions:{engine:'CyberChef 11.5.0',catalogOperations:505,network:false},
  htmlSHA256:digest(Buffer.from(html)), inputs
}, null, 2) + '\n');
console.log('Built HexScope 4.1 + ' + toolCount + ' crypto tools (' + Buffer.byteLength(html) + ' bytes)');
