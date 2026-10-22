# screen-capture.ps1 -- capture screen, downscale JPEG, optional OCR (Windows.Media.Ocr)
# ASCII-only on purpose: Windows PowerShell 5.1 mangles non-BOM UTF-8 source.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File screen-capture.ps1 <outDir> <maxWidth> <doOcr 0|1>
# Writes <outDir>/screen_last.json  (image path, size, ocr text) and the JPEG itself.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$outDir = if ($args.Count -ge 1) { $args[0] } else { 'memories/screens' }
$maxWidth = if ($args.Count -ge 2) { [int]$args[1] } else { 1280 }
$doOcr = if ($args.Count -ge 3) { $args[2] -eq '1' } else { $true }

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$jpgPath = Join-Path $outDir "screen-$stamp.jpg"

# 1) grab the virtual screen
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)

# 2) downscale
$w = [Math]::Min($maxWidth, $b.Width)
$h = [int]($b.Height * $w / $b.Width)
$small = New-Object System.Drawing.Bitmap($w, $h)
$g2 = [System.Drawing.Graphics]::FromImage($small)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($bmp, 0, 0, $w, $h)

# 3) save JPEG (quality 78)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]78)
$small.Save($jpgPath, $codec, $params)

# 4) OCR on the *full-size* bitmap via WinRT (Chinese engine if present)
$ocrText = ''
$ocrError = ''
if ($doOcr) {
  try {
    [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    function Await($op, $type) {
      $m = $asTaskGeneric.MakeGenericMethod($type)
      $task = $m.Invoke($null, @($op))
      $task.Wait(-1) | Out-Null
      return $task.Result
    }

    $tmpPng = Join-Path $outDir ".ocr-$stamp.png"
    $bmp.Save($tmpPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmpPng)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sbmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('zh-Hans-CN'))) }
    if ($engine) {
      $result = Await ($engine.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
      $ocrText = $result.Text
    } else {
      $ocrError = 'no_ocr_engine'
    }
    $stream.Dispose()
    Remove-Item $tmpPng -Force -ErrorAction SilentlyContinue
  } catch {
    $ocrError = $_.Exception.Message
  }
}

$g.Dispose(); $bmp.Dispose(); $g2.Dispose(); $small.Dispose()

$payload = @{
  ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  imagePath = (Resolve-Path $jpgPath).Path
  width = $w
  height = $h
  bytes = (Get-Item $jpgPath).Length
  ocrText = $ocrText
  ocrError = $ocrError
} | ConvertTo-Json -Compress -Depth 4

Set-Content -Path (Join-Path $outDir 'screen_last.json') -Value $payload -Encoding UTF8
Write-Output $jpgPath
