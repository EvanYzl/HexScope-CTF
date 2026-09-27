'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {inspectFixedVhd}=require('./vhd.cjs'),{snapshot,sameFile}=require('./hashing.cjs');
function literal(value){return "'"+String(value).replace(/'/g,"''")+"'";}
function requestFor(action,item,args={}){if(!['mount','unmount','status'].includes(action))throw Error('无效挂载操作');const offsetBytes=Number(args.offsetBytes);if(action==='mount'&&(!/^[D-Z]$/.test(args.letter)||!Number.isSafeInteger(offsetBytes)||offsetBytes<0||offsetBytes%512))throw Error('请选择 D–Z 盘符和有效的分区。');return {action,imagePath:item.filename,letter:args.letter||'',offsetBytes:action==='mount'?offsetBytes:0};}
function bootstrap(executable,helper,request,resultPath,elevated){
  const encoded=Buffer.from(JSON.stringify(request),'utf8').toString('base64');
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','"'+helper+'"','-RequestBase64',encoded,'-ResultPath','"'+resultPath+'"'];
  // All variable strings are single-quoted PowerShell literals; request content is Base64, never code.
  return '$ErrorActionPreference = \'Stop\'; try { $p = Start-Process -FilePath '+literal(executable)+' -ArgumentList @('+args.map(literal).join(',')+') '+(elevated?'-Verb RunAs ':'')+'-WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }';
}
class WindowsMount {
  constructor(root){this.root=root;this.selected=null;this.systemBusy=false;this.lastState=null;}
  assertSelectable(){if(this.lastState?.attached)throw Error('请先卸载当前 VHD，再选择或转换另一个；如已在外部卸载，请先刷新状态。');}
  async select(filename,partitions=[],sourceName=''){
    this.assertSelectable();
    const real=await fsp.realpath(filename);if(path.extname(real).toLowerCase()!=='.vhd')throw Error('请选择固定 .vhd 文件。');const info=await inspectFixedVhd(real);
    this.selected={id:randomUUID(),filename:real,name:path.basename(real),sourceName,mediaBytes:info.bytes,partitions,...snapshot(info.stat)};this.lastState=null;return this.public();
  }
  public(){if(!this.selected)return null;const {size,mtimeMs,ctimeMs,ino,dev,...item}=this.selected;return item;}
  image(id){if(!this.selected||this.selected.id!==id)throw Error('挂载对象已更换，请重新选择。');return this.selected;}
  async execute(action,args){
    if(process.platform!=='win32')throw Error('盘符挂载仅支持 Windows。');const item=this.image(args.vhdId);if(action==='mount'&&!sameFile(await fsp.stat(item.filename),item))throw Error('VHD 已发生变化，请重新选择。');
    const request=requestFor(action,item,args),folder=await fsp.mkdtemp(path.join(os.tmpdir(),'HexScope-mount-')),resultPath=path.join(folder,'result.json');
    const executable=path.join(process.env.SystemRoot||process.env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const script=bootstrap(executable,path.join(this.root,'mount-helper.ps1'),request,resultPath,action!=='status');this.systemBusy=true;
    try{
      const output=await new Promise((resolve,reject)=>{const child=spawn(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let message='';child.stderr.on('data',data=>{if(message.length<4000)message+=data.toString();});child.stdout.on('data',()=>{});child.on('error',reject);child.on('close',code=>resolve({code,message}));});
      let result;try{result=JSON.parse((await fsp.readFile(resultPath,'utf8')).replace(/^\uFEFF/,''));}catch{throw Error('Windows 挂载操作未完成。可能取消了管理员授权或系统策略禁止操作。'+(output.message?' '+output.message.trim():''));}
      if(!result.ok)throw Error(result.error||'Windows 挂载失败。');this.lastState=result.data;return result.data;
    }finally{this.systemBusy=false;await fsp.unlink(resultPath).catch(()=>{});await fsp.rmdir(folder).catch(()=>{});}
  }
}
module.exports={WindowsMount,literal,requestFor,bootstrap};
