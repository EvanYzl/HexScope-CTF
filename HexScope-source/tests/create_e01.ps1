param([string]$OutputStem,[switch]$WithHashes,[switch]$CorruptRecordedHash)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
$diskEngine=(Resolve-Path (Join-Path $sourceRoot 'desktop/engines/tsk/bin')).Path
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.IO;
using System.Text;
public class EwfFixture {
 [DllImport("kernel32", CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr libewf_get_version();
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_initialize(ref IntPtr h,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_open(IntPtr h,[MarshalAs(UnmanagedType.LPArray,ArraySubType=UnmanagedType.LPStr)] string[] names,int count,int flags,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_set_media_size(IntPtr h,ulong size,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_set_format(IntPtr h,byte format,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_set_compression_values(IntPtr h,sbyte level,byte flags,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_set_maximum_segment_size(IntPtr h,ulong size,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_set_md5_hash(IntPtr h,byte[] hash,UIntPtr size,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_set_sha1_hash(IntPtr h,byte[] hash,UIntPtr size,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libewf_handle_write_buffer(IntPtr h,byte[] data,UIntPtr size,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libewf_handle_write_finalize(IntPtr h,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_close(IntPtr h,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_handle_free(ref IntPtr h,ref IntPtr e);
 [DllImport("libewf",CallingConvention=CallingConvention.Cdecl)] static extern int libewf_error_backtrace_sprint(IntPtr e,StringBuilder b,UIntPtr size);
 static void Check(long result,IntPtr e,string step){if(result<0){StringBuilder b=new StringBuilder(8000);libewf_error_backtrace_sprint(e,b,new UIntPtr(8000));throw new Exception(step+": "+b.ToString());}}
 public static void Create(string source,string dest,bool withHashes,bool corrupt){
   IntPtr h=IntPtr.Zero,e=IntPtr.Zero;byte[] bytes=File.ReadAllBytes(source);
   Check(libewf_handle_initialize(ref h,ref e),e,"initialize");
   Check(libewf_handle_open(h,new[]{dest},1,2,ref e),e,"open");
   Check(libewf_handle_set_media_size(h,(ulong)bytes.LongLength,ref e),e,"size");
   Check(libewf_handle_set_format(h,6,ref e),e,"format");
   Check(libewf_handle_set_compression_values(h,0,0,ref e),e,"compression");
   Check(libewf_handle_set_maximum_segment_size(h,1048576,ref e),e,"segment size");
   if(withHashes){using(var md5=System.Security.Cryptography.MD5.Create()){byte[] digest=md5.ComputeHash(bytes);if(corrupt)digest[0]^=1;Check(libewf_handle_set_md5_hash(h,digest,new UIntPtr(16),ref e),e,"MD5");}using(var sha1=System.Security.Cryptography.SHA1.Create()){byte[] digest=sha1.ComputeHash(bytes);Check(libewf_handle_set_sha1_hash(h,digest,new UIntPtr(20),ref e),e,"SHA1");}}
   long count=libewf_handle_write_buffer(h,bytes,new UIntPtr((uint)bytes.Length),ref e).ToInt64();Check(count,e,"write");if(count!=bytes.Length)throw new Exception("short write");
   Check(libewf_handle_write_finalize(h,ref e).ToInt64(),e,"finalize");
   Check(libewf_handle_close(h,ref e),e,"close");Check(libewf_handle_free(ref h,ref e),e,"free");
 }
}
'@
[EwfFixture]::SetDllDirectory($diskEngine) | Out-Null
Write-Output ('libewf version: '+[Runtime.InteropServices.Marshal]::PtrToStringAnsi([EwfFixture]::libewf_get_version()))
$fixtureDir=(Resolve-Path (Join-Path $sourceRoot 'tests/fixtures/disk')).Path
if (-not $OutputStem) {$OutputStem=Join-Path $fixtureDir 'split'}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputStem)) | Out-Null
[EwfFixture]::Create((Join-Path $fixtureDir 'fat16.dd'),$OutputStem,$WithHashes,$CorruptRecordedHash)
Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($OutputStem)) -Filter (([IO.Path]::GetFileName($OutputStem))+'.*') | Select-Object Name,Length
