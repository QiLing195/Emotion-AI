# gen-pet-placeholders.ps1 -- 生成 anya_<state>.png 占位图（透明 PNG，320x400）
# 用途：先把"图片加载/状态切换"链路跑通；你之后用自己的画覆盖同名文件即可。
# 注意：本文件含中文，必须存为 UTF-8 BOM（Windows PowerShell 5.1 才不乱码）。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Get-Location) 'public\pet'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$W = 320; $H = 400
$font = New-Object System.Drawing.Font('Microsoft YaHei', 13)
$fontSmall = New-Object System.Drawing.Font('Microsoft YaHei', 11)
$brush = [System.Drawing.Brushes]::White
$eyeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 42, 38, 51))
$blushBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(120, 244, 114, 182))
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 60, 60, 72))
$shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))

# state -> @{ label; body; head; eyes; mouth; prop }
$states = [ordered]@{
  idle    = @{ label='待机微笑';   body='#F7CBD5'; head='#F6C1CF'; eyes='open';   mouth='smile'; prop='' }
  blink   = @{ label='眨眼';       body='#F7CBD5'; head='#F6C1CF'; eyes='closed'; mouth='smile'; prop='' }
  happy   = @{ label='开心星星眼'; body='#F7CBD5'; head='#F6C1CF'; eyes='star';   mouth='open';  prop='' }
  angry   = @{ label='生气鼓脸';   body='#F3B1B1'; head='#EFA6A6'; eyes='angry';  mouth='pout';  prop='' }
  shocked = @{ label='震惊张嘴';   body='#F7DCCB'; head='#F6D1C1'; eyes='wide';   mouth='o';     prop='' }
  sleepy  = @{ label='困倦揉眼';   body='#D9C7E8'; head='#D3C0E4'; eyes='sleepy'; mouth='small'; prop='' }
  peanut  = @{ label='吃花生';     body='#F7CBB5'; head='#F6C1AF'; eyes='open';   mouth='chew';  prop='peanut' }
  sit     = @{ label='坐下';       body='#F7CBD5'; head='#F6C1CF'; eyes='open';   mouth='smile'; prop='sit' }
  coffee  = @{ label='喝咖啡';     body='#F7D5C5'; head='#F6CBB5'; eyes='half';   mouth='sip';   prop='coffee' }
  reading = @{ label='读书';       body='#CBDCF7'; head='#C1D1F6'; eyes='down';   mouth='small'; prop='book' }
  sad     = @{ label='低落';       body='#8E9BB8'; head='#8A98B8'; eyes='sad';    mouth='frown'; prop='' }
  talk    = @{ label='说话';       body='#F7CBD5'; head='#F6C1CF'; eyes='open';   mouth='open';  prop='' }
  walk    = @{ label='行走';       body='#F7CBD5'; head='#F6C1CF'; eyes='open';   mouth='smile'; prop='walk' }
  wave    = @{ label='挥手';       body='#F7CBD5'; head='#F6C1CF'; eyes='happy';  mouth='smile'; prop='wave' }
  think   = @{ label='思考';       body='#DED7F0'; head='#D9D1EC'; eyes='up';     mouth='small'; prop='think' }
}

function ColorFromHex([string]$hex) {
  $h = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(255, [Convert]::ToInt32($h.Substring(0,2),16), [Convert]::ToInt32($h.Substring(2,2),16), [Convert]::ToInt32($h.Substring(4,2),16))
}

foreach ($key in $states.Keys) {
  $s = $states[$key]
  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $bodyColor = ColorFromHex $s.body
  $headColor = ColorFromHex $s.head
  $bodyBrush = New-Object System.Drawing.SolidBrush($bodyColor)
  $headBrush = New-Object System.Drawing.SolidBrush($headColor)

  # 影子
  $g.FillEllipse($shadowBrush, 80, 356, 160, 22)

  # 身体（坐下时矮一点）
  $bodyH = if ($s.prop -eq 'sit') { 96 } else { 120 }
  $bodyY = 340 - $bodyH
  $g.FillRectangle($bodyBrush, 110, $bodyY, 100, $bodyH)
  $g.FillEllipse($bodyBrush, 110, $bodyY - 24, 100, 48)

  # 头
  $headY = $bodyY - 150
  $g.FillEllipse($headBrush, 92, $headY, 136, 136)

  # 眼睛
  switch ($s.eyes) {
    'open'   { $g.FillEllipse($eyeBrush, 130, ($headY+62), 16, 22); $g.FillEllipse($eyeBrush, 174, ($headY+62), 16, 22) }
    'closed' { $g.DrawArc((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 128, ($headY+70), 20, 14, 180, 180); $g.DrawArc((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 172, ($headY+70), 20, 14, 180, 180) }
    'star'   { $g.FillEllipse($eyeBrush, 130, ($headY+60), 18, 24); $g.FillEllipse($eyeBrush, 172, ($headY+60), 18, 24); $g.FillEllipse($brush, 134, ($headY+64), 6, 6); $g.FillEllipse($brush, 176, ($headY+64), 6, 6) }
    'angry'  { $g.DrawLine((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 126, ($headY+52), 148, ($headY+62)); $g.DrawLine((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 194, ($headY+52), 172, ($headY+62)); $g.FillEllipse($eyeBrush, 132, ($headY+66), 14, 16); $g.FillEllipse($eyeBrush, 174, ($headY+66), 14, 16) }
    'wide'   { $g.FillEllipse($eyeBrush, 128, ($headY+56), 22, 28); $g.FillEllipse($eyeBrush, 170, ($headY+56), 22, 28) }
    'sleepy' { $g.DrawArc((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 128, ($headY+72), 20, 12, 180, 180); $g.DrawArc((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 172, ($headY+72), 20, 12, 180, 180) }
    'half'   { $g.FillEllipse($eyeBrush, 130, ($headY+66), 16, 12); $g.FillEllipse($eyeBrush, 174, ($headY+66), 16, 12) }
    'down'   { $g.FillEllipse($eyeBrush, 130, ($headY+70), 16, 14); $g.FillEllipse($eyeBrush, 174, ($headY+70), 16, 14) }
    'sad'    { $g.FillEllipse($eyeBrush, 130, ($headY+66), 15, 18); $g.FillEllipse($eyeBrush, 175, ($headY+66), 15, 18); $g.DrawLine((New-Object System.Drawing.Pen($eyeBrush.Color, 4)), 128, ($headY+58), 148, ($headY+64)); $g.DrawLine((New-Object System.Drawing.Pen($eyeBrush.Color, 4)), 192, ($headY+58), 172, ($headY+64)) }
    'happy'  { $g.DrawArc((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 128, ($headY+66), 22, 16, 180, 180); $g.DrawArc((New-Object System.Drawing.Pen($eyeBrush.Color, 5)), 170, ($headY+66), 22, 16, 180, 180) }
    'up'     { $g.FillEllipse($eyeBrush, 130, ($headY+56), 16, 18); $g.FillEllipse($eyeBrush, 174, ($headY+56), 16, 18) }
  }

  # 嘴
  $pen = New-Object System.Drawing.Pen($eyeBrush.Color, 4)
  switch ($s.mouth) {
    'smile' { $g.DrawArc($pen, 146, ($headY+98), 28, 18, 0, 180) }
    'open'  { $g.FillEllipse($eyeBrush, 148, ($headY+100), 24, 18) }
    'pout'  { $g.DrawArc($pen, 150, ($headY+106), 20, 12, 180, 180) }
    'o'     { $g.FillEllipse($eyeBrush, 150, ($headY+98), 20, 24) }
    'small' { $g.DrawArc($pen, 152, ($headY+102), 16, 12, 0, 180) }
    'chew'  { $g.FillEllipse($eyeBrush, 150, ($headY+102), 20, 12) }
    'sip'   { $g.DrawArc($pen, 150, ($headY+100), 20, 14, 0, 180) }
    'frown' { $g.DrawArc($pen, 146, ($headY+104), 28, 16, 180, 180) }
  }

  # 腮红
  $g.FillEllipse($blushBrush, 116, ($headY+90), 22, 14)
  $g.FillEllipse($blushBrush, 182, ($headY+90), 22, 14)

  # 道具
  switch ($s.prop) {
    'peanut' { $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 214, 170, 110))), 232, 260, 22, 34) }
    'coffee' { $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 240, 240, 240))), 224, 276, 30, 34); $g.DrawArc($pen, 252, 282, 16, 16, 270, 180) }
    'book'   { $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 120, 160, 220))), 214, 262, 44, 32); $g.DrawLine($pen, 236, 262, 236, 294) }
    'sit'    { $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 255, 255, 255))), 104, 344, 112, 10) }
    'walk'   { $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 240, 200, 220))), 96, 352, 26, 12); $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 240, 200, 220))), 198, 352, 26, 12) }
    'wave'   { $g.FillRectangle((New-Object System.Drawing.SolidBrush($headColor)), 226, ($bodyY + 10), 16, 46) }
    'think'  { $g.DrawString('?', $font, $textBrush, 244, ($headY + 10)) }
  }

  # 状态标签（方便你核对哪张是哪张；换成自己的画时不用保留）
  $g.DrawString($s.label, $fontSmall, $textBrush, 10, 8)

  $file = Join-Path $outDir ("anya_{0}.png" -f $key)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $bodyBrush.Dispose(); $headBrush.Dispose()
  Write-Output ("{0}  <- {1}" -f (Split-Path $file -Leaf), $s.label)
}
Write-Output ""
Write-Output ("done: " + $states.Count + " files in " + $outDir)
