# Developer asset conversion only: preserve the entire supplied image in each size.
param(
  [string]$SourceImage=(Join-Path $PSScriptRoot 'assets\icon-source.jpg'),
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'assets')
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$picture=[Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourceImage).Path)
$frames=New-Object 'System.Collections.Generic.List[byte[]]'
$sizes=@(16,20,24,32,40,48,64,128,256)
try {
  foreach($size in $sizes) {
    $bitmap=New-Object Drawing.Bitmap($size,$size,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $stream=New-Object IO.MemoryStream
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.CompositingMode=[Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality=[Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale=[Math]::Min($size/[double]$picture.Width,$size/[double]$picture.Height)
      $width=[int][Math]::Round($picture.Width*$scale);$height=[int][Math]::Round($picture.Height*$scale)
      $rectangle=New-Object Drawing.Rectangle(([int](($size-$width)/2)),([int](($size-$height)/2)),$width,$height)
      $graphics.DrawImage($picture,$rectangle,0,0,$picture.Width,$picture.Height,[Drawing.GraphicsUnit]::Pixel)
      $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
      $bytes=$stream.ToArray();$frames.Add($bytes)
      if($size -eq 256){[IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'hexscope.png'),$bytes)}
    } finally {$stream.Dispose();$graphics.Dispose();$bitmap.Dispose()}
  }
} finally {$picture.Dispose()}
$buffer=New-Object IO.MemoryStream
$writer=New-Object IO.BinaryWriter($buffer)
try {
  $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$sizes.Count)
  $offset=6+16*$sizes.Count
  for($i=0;$i -lt $sizes.Count;$i++){
    $dimension=if($sizes[$i] -eq 256){0}else{$sizes[$i]}
    $writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0)
    $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$frames[$i].Length);$writer.Write([uint32]$offset)
    $offset+=$frames[$i].Length
  }
  foreach($frame in $frames){$writer.Write($frame)}
  $writer.Flush();[IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'hexscope.ico'),$buffer.ToArray())
} finally {$writer.Dispose();$buffer.Dispose()}
Write-Output ('Created original-image icon sizes: '+($sizes -join ', '))
