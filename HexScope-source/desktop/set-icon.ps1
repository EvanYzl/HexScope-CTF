# Build-time PE resource replacement; does not launch or install the executable.
param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Icon)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HexScopeIconResource {
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr unused,uint flags);
 [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr module);
 delegate bool NameCallback(IntPtr module,IntPtr type,IntPtr name,IntPtr param);
 delegate bool LangCallback(IntPtr module,IntPtr type,IntPtr name,ushort language,IntPtr param);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceNames(IntPtr module,IntPtr type,NameCallback callback,IntPtr param);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr module,IntPtr type,IntPtr name,LangCallback callback,IntPtr param);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResource(string path,bool deleteExisting);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool UpdateResource(IntPtr update,IntPtr type,IntPtr name,ushort language,byte[] data,uint size);
 [DllImport("kernel32",SetLastError=true)] static extern bool EndUpdateResource(IntPtr update,bool discard);
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr FindResource(IntPtr module,IntPtr name,IntPtr type);
 [DllImport("kernel32")] static extern uint SizeofResource(IntPtr module,IntPtr resource);
 [DllImport("kernel32")] static extern IntPtr LoadResource(IntPtr module,IntPtr resource);
 [DllImport("kernel32")] static extern IntPtr LockResource(IntPtr resource);
 [DllImport("user32",SetLastError=true)] static extern IntPtr CreateIconFromResourceEx(byte[] data,uint size,bool isIcon,uint version,int width,int height,uint flags);
 [DllImport("user32")] static extern bool DestroyIcon(IntPtr icon);
 class Entry { public ushort Type,Id,Language; public string Name; }
 static void Check(bool success){if(!success)throw new Win32Exception(Marshal.GetLastWin32Error());}
 static IntPtr Open(string file){var handle=LoadLibraryEx(file,IntPtr.Zero,2);Check(handle!=IntPtr.Zero);return handle;}
 static List<Entry> Existing(string file){
  var entries=new List<Entry>();var module=Open(file);
  try {foreach(ushort kind in new ushort[]{14,3}){
   NameCallback callback=(m,t,n,p)=>{
    bool integer=(n.ToInt64()>>16)==0;ushort id=integer?(ushort)n.ToInt64():(ushort)0;string name=integer?null:Marshal.PtrToStringUni(n);
    LangCallback languages=(lm,lt,ln,l,lp)=>{entries.Add(new Entry{Type=kind,Id=id,Name=name,Language=l});return true;};
    Check(EnumResourceLanguages(m,t,n,languages,IntPtr.Zero));return true;
   };
   if(!EnumResourceNames(module,(IntPtr)kind,callback,IntPtr.Zero)){
    int error=Marshal.GetLastWin32Error();if(error!=1813&&error!=1814)throw new Win32Exception(error);
   }
  }}finally{FreeLibrary(module);}return entries;
 }
 static byte[] Resource(IntPtr module,int type,int id){
  var resource=FindResource(module,(IntPtr)id,(IntPtr)type);Check(resource!=IntPtr.Zero);
  var data=new byte[SizeofResource(module,resource)];var pointer=LockResource(LoadResource(module,resource));Check(pointer!=IntPtr.Zero);
  Marshal.Copy(pointer,data,0,data.Length);return data;
 }
 public static int Install(string file,string icon){
  var bytes=File.ReadAllBytes(icon);
  if(bytes.Length<22||BitConverter.ToUInt16(bytes,0)!=0||BitConverter.ToUInt16(bytes,2)!=1)throw new Exception("Invalid ICO header");
  int count=BitConverter.ToUInt16(bytes,4);
  if(count<1||count>64||6+16*count>bytes.Length)throw new Exception("Invalid ICO frame count");
  var images=new List<byte[]>();byte[] group;
  using(var buffer=new MemoryStream())using(var writer=new BinaryWriter(buffer)){
   writer.Write((ushort)0);writer.Write((ushort)1);writer.Write((ushort)count);
   for(int i=0;i<count;i++){
    int at=6+16*i;uint size=BitConverter.ToUInt32(bytes,at+8),offset=BitConverter.ToUInt32(bytes,at+12);
    if(size==0||offset<6+16*count||(ulong)offset+size>(ulong)bytes.Length)throw new Exception("Invalid ICO image bounds");
    var image=new byte[size];Buffer.BlockCopy(bytes,(int)offset,image,0,(int)size);images.Add(image);
    writer.Write(bytes,at,12);writer.Write((ushort)(i+1));
   }
   writer.Flush();group=buffer.ToArray();
  }
  var existing=Existing(file);var update=BeginUpdateResource(file,false);Check(update!=IntPtr.Zero);
  try {
   foreach(var entry in existing){
    var name=entry.Name==null?(IntPtr)entry.Id:Marshal.StringToHGlobalUni(entry.Name);
    try{Check(UpdateResource(update,(IntPtr)entry.Type,name,entry.Language,null,0));}
    finally{if(entry.Name!=null)Marshal.FreeHGlobal(name);}
   }
   for(int i=0;i<count;i++)Check(UpdateResource(update,(IntPtr)3,(IntPtr)(i+1),0,images[i],(uint)images[i].Length));
   Check(UpdateResource(update,(IntPtr)14,(IntPtr)1,0,group,(uint)group.Length));
  }catch{EndUpdateResource(update,true);throw;}
  Check(EndUpdateResource(update,false));
  var verify=Open(file);
  try{
   if(!Resource(verify,14,1).SequenceEqual(group))throw new Exception("Icon group mismatch after write");
   for(int i=0;i<count;i++){
    if(!Resource(verify,3,i+1).SequenceEqual(images[i]))throw new Exception("Icon payload mismatch after write");
    int width=bytes[6+16*i]==0?256:bytes[6+16*i];int height=bytes[7+16*i]==0?256:bytes[7+16*i];
    var decoded=CreateIconFromResourceEx(images[i],(uint)images[i].Length,true,0x30000,width,height,0);
    Check(decoded!=IntPtr.Zero);DestroyIcon(decoded);
   }
  }finally{FreeLibrary(verify);}
  return count;
 }
}
'@
$exe=(Resolve-Path -LiteralPath $Executable).Path
$ico=(Resolve-Path -LiteralPath $Icon).Path
$count=[HexScopeIconResource]::Install($exe,$ico)
Write-Output ('Updated and verified '+$count+' icon resources: '+$exe)
