# ocr-image.ps1 -- OCR an existing image file with Windows.Media.Ocr (no screen capture)
# ASCII-only. Usage: powershell -File ocr-image.ps1 <imagePath> <outTxtPath>
$ErrorActionPreference = 'Stop'
$img = $args[0]
$out = $args[1]
if (-not (Test-Path $img)) { Set-Content -Path $out -Value 'OCR-ERROR: missing image' -Encoding UTF8; exit 1 }
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
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $img).Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sbmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) {
    $lang = New-Object Windows.Globalization.Language('zh-Hans-CN')
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
  }
  if (-not $engine) { throw 'no_ocr_engine' }
  $result = Await ($engine.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
  Set-Content -Path $out -Value $result.Text -Encoding UTF8
  $stream.Dispose()
  Write-Output ('OCR-OK chars=' + $result.Text.Length)
} catch {
  Set-Content -Path $out -Value ('OCR-ERROR: ' + $_.Exception.Message) -Encoding UTF8
  Write-Output ('OCR-ERR ' + $_.Exception.Message)
}
