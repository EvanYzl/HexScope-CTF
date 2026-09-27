param([string]$RequestBase64,[string]$ResultPath,[switch]$DefinitionsOnly)
$ErrorActionPreference='Stop'
function Invoke-HexMount($request) {
  if ($request.action -notin @('mount','unmount','status')) {throw 'Unsupported operation.'}
  $imagePath=[IO.Path]::GetFullPath([string]$request.imagePath)
  if ([IO.Path]::GetExtension($imagePath) -ne '.vhd' -or -not [IO.File]::Exists($imagePath)) {throw 'A fixed VHD file is required.'}
  if ($request.action -eq 'mount' -and ([string]$request.letter -cnotmatch '^[D-Z]$' -or [double]$request.offsetBytes -lt 0 -or [double]$request.offsetBytes % 512 -ne 0)) {throw 'Invalid drive letter or partition offset.'}
  $image=Get-DiskImage -ImagePath $imagePath -ErrorAction Stop
  if ($request.action -eq 'unmount') {
    if ($image.Attached) {Dismount-DiskImage -ImagePath $imagePath -ErrorAction Stop | Out-Null}
    $after=Get-DiskImage -ImagePath $imagePath -ErrorAction Stop
    if ($after.Attached) {throw 'Windows still reports this VHD as attached.'}
    return @{attached=$false;imagePath=$imagePath;partitions=@()}
  }
  if ($request.action -eq 'status' -and -not $image.Attached) {return @{attached=$false;imagePath=$imagePath;mediaBytes=$image.Size;partitions=@()}}
  $created=$false
  try {
    if (-not $image.Attached) {
      $image=Mount-DiskImage -ImagePath $imagePath -StorageType VHD -Access ReadOnly -NoDriveLetter -PassThru -ErrorAction Stop
      $created=$true
    }
    $disk=$image | Get-Disk -ErrorAction Stop
    if (-not $disk.IsReadOnly) {throw 'The selected VHD is not read-only. Detach it from its original tool before using HexScope.'}
    if ($request.action -eq 'mount' -and $disk.IsOffline) {Set-Disk -Number $disk.Number -IsOffline $false -ErrorAction Stop | Out-Null}
    $partitions=@(Get-Partition -DiskNumber $disk.Number -ErrorAction Stop)
    if ($request.action -eq 'mount') {
      $part=@($partitions | Where-Object {$_.Offset -eq [UInt64]$request.offsetBytes})
      if ($part.Count -ne 1) {throw 'The chosen partition was not found. Bare partition images and unsupported partition tables cannot be assigned a drive letter here.'}
      $letter=[string]$request.letter
      if ($part[0].DriveLetter -and [string]$part[0].DriveLetter -ne $letter) {throw 'This partition already has a different drive letter. Unmount it before choosing a new one.'}
      if ([string]$part[0].DriveLetter -ne $letter) {
        if (Get-PSDrive -Name $letter -PSProvider FileSystem -ErrorAction SilentlyContinue) {throw 'That drive letter is already in use.'}
        $volume=$part[0] | Get-Volume -ErrorAction Stop
        if (-not $volume -or [string]$volume.FileSystemType -in @('Unknown','RAW','')) {throw 'Windows cannot read this file system. Use the built-in image browser; never initialize or format the disk.'}
        Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $part[0].PartitionNumber -AccessPath ($letter+':\') -ErrorAction Stop | Out-Null
      }
      $partitions=@(Get-Partition -DiskNumber $disk.Number -ErrorAction Stop)
      if (-not ($partitions | Where-Object {$_.Offset -eq [UInt64]$request.offsetBytes -and [string]$_.DriveLetter -eq $letter})) {throw 'Windows did not confirm the requested drive letter.'}
    }
    $checkDisk=$image | Get-Disk -ErrorAction Stop
    if (-not $checkDisk.IsReadOnly) {throw 'Read-only verification failed.'}
    $rows=@($partitions | ForEach-Object {$driveText=[string]$_.DriveLetter;if ($driveText -notmatch '^[A-Z]$') {$driveText=''};@{number=$_.PartitionNumber;offset=$_.Offset;size=$_.Size;letter=$driveText.ToUpperInvariant();type=[string]$_.Type}})
    return @{attached=$true;readOnly=$true;imagePath=$imagePath;diskNumber=$disk.Number;partitions=$rows}
  } catch {
    $original=$_.Exception.Message
    if ($created) {
      try {Dismount-DiskImage -ImagePath $imagePath -ErrorAction Stop | Out-Null}
      catch {$original+=' Automatic detach also failed: '+$_.Exception.Message+'. Detach this VHD using Disk Management.'}
    }
    throw $original
  }
}
if ($DefinitionsOnly) {return}
try {
  $request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
  $data=Invoke-HexMount $request
  $result=@{ok=$true;data=$data}
} catch {$result=@{ok=$false;error=$_.Exception.Message}}
[IO.File]::WriteAllText($ResultPath,($result | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
if (-not $result.ok) {exit 1}
