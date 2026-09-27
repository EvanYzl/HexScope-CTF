param([string]$VhdPath)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../desktop/mount-helper.ps1') -DefinitionsOnly
$script:attached=$false;$script:readOnly=$true;$script:letter='';$script:occupied=$false;$script:unsupported=$false;$script:failAssign=$false;$script:events=@()
function Assert($value,$message) {if (-not $value) {throw $message}}
function Get-DiskImage {param($ImagePath,$ErrorAction) @{Attached=$script:attached;ImagePath=$ImagePath}}
function Mount-DiskImage {param($ImagePath,$StorageType,$Access,[switch]$NoDriveLetter,[switch]$PassThru,$ErrorAction) Assert ($Access -eq 'ReadOnly') 'Writable mount requested';Assert $NoDriveLetter 'Unexpected automount';$script:events+='attach';$script:attached=$true;@{Attached=$true;ImagePath=$ImagePath}}
function Dismount-DiskImage {param($ImagePath,$ErrorAction) $script:events+='detach';$script:attached=$false;$script:letter=''}
function Get-Disk {param([Parameter(ValueFromPipeline=$true)]$InputObject) process {@{IsReadOnly=$script:readOnly;IsOffline=$false;Number=42}}}
function Get-Partition {param($DiskNumber,$ErrorAction) Assert ($DiskNumber -eq 42) 'Wrong disk targeted';[pscustomobject]@{PartitionNumber=1;Offset=1048576;Size=4194304;DriveLetter=$script:letter;Type='IFS'}}
function Get-Volume {param([Parameter(ValueFromPipeline=$true)]$InputObject) process {@{FileSystemType=$(if ($script:unsupported) {'Unknown'} else {'FAT'})}}}
function Get-PSDrive {param($Name,$PSProvider,$ErrorAction) if ($script:occupied) {@{Name=$Name}}}
function Add-PartitionAccessPath {param($DiskNumber,$PartitionNumber,$AccessPath,$ErrorAction) Assert ($DiskNumber -eq 42 -and $PartitionNumber -eq 1) 'Unexpected target';if ($script:failAssign) {throw 'Mock assignment failure'};$script:events+='assign';$script:letter=$AccessPath.Substring(0,1)}
function Request($action='mount') {@{action=$action;imagePath=$VhdPath;letter='Z';offsetBytes=1048576}}
function Reset {$script:attached=$false;$script:readOnly=$true;$script:letter='';$script:occupied=$false;$script:unsupported=$false;$script:failAssign=$false;$script:events=@()}
function MustFail($request,$match) {$failed=$false;try {Invoke-HexMount $request | Out-Null} catch {$failed=$true;Assert ($_.Exception.Message -match $match) ('Unexpected error: '+$_.Exception.Message)};Assert $failed 'Expected failure'}
$count=0
Reset;$r=Invoke-HexMount (Request);Assert ($r.attached -and $r.readOnly -and $r.partitions[0].letter -eq 'Z') 'Mount not confirmed';Assert (($script:events -join ',') -eq 'attach,assign') 'Wrong mount sequence';$count++
$r=Invoke-HexMount (Request 'unmount');Assert (-not $r.attached) 'Detach not confirmed';$count++
Reset;$script:occupied=$true;MustFail (Request) 'in use';Assert (-not $script:attached) 'Occupied-letter rollback failed';$count++
Reset;$script:unsupported=$true;MustFail (Request) 'cannot read';Assert (-not $script:attached) 'Unsupported-FS rollback failed';$count++
Reset;$script:failAssign=$true;MustFail (Request) 'Mock assignment';Assert (-not $script:attached) 'Assignment rollback failed';$count++
Reset;$script:attached=$true;$script:readOnly=$false;MustFail (Request) 'not read-only';Assert $script:attached 'Existing external mount was unexpectedly detached';Assert ($script:events.Count -eq 0) 'Existing writable mount was mutated';$count++
Reset;$q=Request;$q.offsetBytes=2097152;MustFail $q 'not found';Assert (-not $script:attached) 'Wrong-partition rollback failed';$count++
Reset;$q=Request;$q.letter='C';MustFail $q 'Invalid';Assert ($script:events.Count -eq 0) 'System letter reached storage action';$count++
Reset;$r=Invoke-HexMount (Request 'status');Assert (-not $r.attached -and $script:events.Count -eq 0) 'Status request mutated disk';$count++
Reset;$script:attached=$true;$script:letter='Y';MustFail (Request) 'different drive';Assert ($script:letter -eq 'Y' -and $script:attached) 'Existing letter changed without detach';$count++
Reset;$script:attached=$true;$script:letter=[char]0;$r=Invoke-HexMount (Request 'status');Assert ($r.partitions[0].letter -eq '') 'NUL drive letter was not normalized';$count++
@{tests=$count;passed=$count;storageCommands='mocked';actualSystemMount=$false} | ConvertTo-Json -Compress
