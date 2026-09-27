# Build-time patch only. Preserve the upstream manifest and add per-process UTF-8.
# The target computer runs the packaged EXEs directly; it does not run this script.
param([string]$EngineDirectory=(Join-Path $PSScriptRoot 'engines\tsk\bin'))
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class ManifestResource {
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibraryEx(string file,IntPtr reserved,uint flags);
 [DllImport("kernel32",SetLastError=true)] public static extern bool FreeLibrary(IntPtr module);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr FindResource(IntPtr module,IntPtr name,IntPtr type);
 [DllImport("kernel32",SetLastError=true)] public static extern uint SizeofResource(IntPtr module,IntPtr resource);
 [DllImport("kernel32",SetLastError=true)] public static extern IntPtr LoadResource(IntPtr module,IntPtr resource);
 [DllImport("kernel32",SetLastError=true)] public static extern IntPtr LockResource(IntPtr data);
 public delegate bool LangCallback(IntPtr module,IntPtr type,IntPtr name,ushort lang,IntPtr param);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool EnumResourceLanguages(IntPtr module,IntPtr type,IntPtr name,LangCallback callback,IntPtr param);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr BeginUpdateResource(string file,bool deleteExisting);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool UpdateResource(IntPtr update,IntPtr type,IntPtr name,ushort language,byte[] data,uint size);
 [DllImport("kernel32",SetLastError=true)] public static extern bool EndUpdateResource(IntPtr update,bool discard);
 public static ushort[] Languages(IntPtr module){var langs=new List<ushort>();LangCallback cb=(m,t,n,l,p)=>{langs.Add(l);return true;};EnumResourceLanguages(module,(IntPtr)24,(IntPtr)1,cb,IntPtr.Zero);return langs.ToArray();}
}
'@
foreach ($toolName in @('img_stat','img_cat','mmls','fls','icat','fsstat','istat')) {
  $target=(Resolve-Path -LiteralPath (Join-Path $EngineDirectory ($toolName+'.exe'))).Path
  $module=[ManifestResource]::LoadLibraryEx($target,[IntPtr]::Zero,2)
  if ($module -eq [IntPtr]::Zero) {throw 'Cannot read manifest resource'}
  try {
    $resource=[ManifestResource]::FindResource($module,[IntPtr]1,[IntPtr]24)
    if ($resource -eq [IntPtr]::Zero) {throw 'No upstream manifest'}
    $size=[ManifestResource]::SizeofResource($module,$resource)
    $pointer=[ManifestResource]::LockResource([ManifestResource]::LoadResource($module,$resource))
    $bytes=New-Object byte[] $size
    [Runtime.InteropServices.Marshal]::Copy($pointer,$bytes,0,$size)
    $text=[Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
    $languages=[ManifestResource]::Languages($module)
  } finally {[ManifestResource]::FreeLibrary($module) | Out-Null}
  $xml=New-Object Xml.XmlDocument
  $xml.LoadXml($text)
  $namespace='urn:schemas-microsoft-com:asm.v3'
  $application=$xml.CreateElement('application',$namespace)
  $settings=$xml.CreateElement('windowsSettings',$namespace)
  $cp=$xml.CreateElement('activeCodePage','http://schemas.microsoft.com/SMI/2019/WindowsSettings')
  $cp.InnerText='UTF-8'
  $settings.AppendChild($cp) | Out-Null
  $application.AppendChild($settings) | Out-Null
  if ($xml.OuterXml -notmatch 'activeCodePage') {$xml.DocumentElement.AppendChild($application) | Out-Null}
  $output=[Text.Encoding]::UTF8.GetBytes($xml.OuterXml)
  $update=[ManifestResource]::BeginUpdateResource($target,$false)
  if ($update -eq [IntPtr]::Zero) {throw 'Cannot update manifest'}
  try {foreach ($language in $languages) {if (-not [ManifestResource]::UpdateResource($update,[IntPtr]24,[IntPtr]1,$language,$output,$output.Length)) {throw 'Manifest update failed'}}}
  catch {[ManifestResource]::EndUpdateResource($update,$true) | Out-Null;throw}
  if (-not [ManifestResource]::EndUpdateResource($update,$false)) {throw 'Cannot commit manifest'}
  Write-Output ($toolName+': UTF-8 manifest enabled')
}
