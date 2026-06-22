# Generate square PWA icons from brand mark (192, 512, maskable 512)
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$source = Join-Path $root 'assets\brand\brem-logo-mark-transparent.png'
$outDir = Join-Path $root 'assets\brand'

function Save-PwaIcon {
  param(
    [string]$DestPath,
    [int]$Size,
    [double]$PaddingRatio
  )

  $src = [System.Drawing.Image]::FromFile($source)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 10))

  $inner = [int][Math]::Floor($Size * (1 - (2 * $PaddingRatio)))
  $scale = [Math]::Min($inner / $src.Width, $inner / $src.Height)
  $w = [int][Math]::Round($src.Width * $scale)
  $h = [int][Math]::Round($src.Height * $scale)
  $x = [int][Math]::Floor(($Size - $w) / 2)
  $y = [int][Math]::Floor(($Size - $h) / 2)

  $g.DrawImage($src, $x, $y, $w, $h)
  $g.Dispose()
  $bmp.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $src.Dispose()
}

Save-PwaIcon -DestPath (Join-Path $outDir 'pwa-icon-192.png') -Size 192 -PaddingRatio 0.08
Save-PwaIcon -DestPath (Join-Path $outDir 'pwa-icon-512.png') -Size 512 -PaddingRatio 0.08
Save-PwaIcon -DestPath (Join-Path $outDir 'pwa-icon-maskable-512.png') -Size 512 -PaddingRatio 0.10

Write-Host 'Generated pwa-icon-192.png, pwa-icon-512.png, pwa-icon-maskable-512.png'
