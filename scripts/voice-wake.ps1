# voice-wake.ps1 -- 语音唤醒 + 一句话听写（Windows System.Speech，离线、无需下载模型）
# 纯 ASCII（中文词来自 voice-config.json）
#
# 用法：
#   麦克风长驻: powershell -NoProfile -ExecutionPolicy Bypass -File voice-wake.ps1 -OutFile <jsonl> -ConfigFile <json>
#   测试喂 WAV:  powershell ... -Wav test1.wav,test2.wav
#
# 事件（每行一个 JSON，UTF-8）：
#   {"ts":...,"kind":"ready"}
#   {"ts":...,"kind":"wake","text":"安雅"}
#   {"ts":...,"kind":"utterance","text":"我今天有点累"}
#   {"ts":...,"kind":"no_speech"}
#   {"ts":...,"kind":"error","text":"..."}

param(
  [string]$OutFile = 'memories/voice_events.jsonl',
  [string]$ConfigFile = 'scripts/voice-config.json',
  [string]$WavCsv = '',
  [int]$WakeTimeoutSec = 30,
  [int]$UtteranceTimeoutSec = 12
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

function Write-Event([string]$kind, [string]$text) {
  $obj = @{ ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); kind = $kind; text = $text } | ConvertTo-Json -Compress
  Add-Content -Path $OutFile -Value $obj -Encoding UTF8
}

$wakeWords = @('安雅', '小雅', 'anya')
if (Test-Path $ConfigFile) {
  try {
    $cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.wakeWords -and $cfg.wakeWords.Count -gt 0) { $wakeWords = @($cfg.wakeWords) }
  } catch { }
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$Wav = @()
if ($WavCsv) { $Wav = @($WavCsv -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
$isWav = $Wav.Count -gt 0

try {
  $culture = New-Object System.Globalization.CultureInfo('zh-CN')
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(2)
  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.8)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromSeconds(1.0)

  $choices = New-Object System.Speech.Recognition.Choices
  foreach ($w in $wakeWords) { [void]$choices.Add($w) }
  $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
  $gb.Culture = $culture
  $wakeGrammar = New-Object System.Speech.Recognition.Grammar($gb)
  $wakeGrammar.Name = 'wake'
  $dictGb = New-Object System.Speech.Recognition.GrammarBuilder
  $dictGb.Culture = $culture
  $dictGb.AppendDictation()
  $dictation = New-Object System.Speech.Recognition.Grammar($dictGb)
  $dictation.Name = 'dictation'

  if (-not $isWav) { $engine.SetInputToDefaultAudioDevice() }
  Write-Event 'ready' ''

  $idx = 0
  while ($true) {
    # ---------- 等唤醒词 ----------
    $engine.UnloadAllGrammars()
    [void]$engine.LoadGrammar($wakeGrammar)

    $wake = $null
    if ($isWav) {
      if ($idx -ge $Wav.Count) { break }
      $engine.SetInputToWaveFile($Wav[$idx])
      try { $wake = $engine.Recognize([TimeSpan]::FromSeconds(8)) } catch { $wake = $null }
      if ($null -eq $wake) { $idx++; continue }
    } else {
      try { $wake = $engine.Recognize([TimeSpan]::FromSeconds($WakeTimeoutSec)) } catch { $wake = $null }
      if ($null -eq $wake) { continue }
    }

    Write-Event 'wake' $wake.Text.Trim()

    # ---------- 听一句话 ----------
    $engine.UnloadAllGrammars()
    [void]$engine.LoadGrammar($dictation)

    if ($isWav) {
      $idx++
      if ($idx -ge $Wav.Count) { Write-Event 'no_speech' ''; break }
      $engine.SetInputToWaveFile($Wav[$idx])
    } else {
      try { $engine.SetInputToDefaultAudioDevice() } catch { }
    }

    $utt = $null
    try { $utt = $engine.Recognize([TimeSpan]::FromSeconds($UtteranceTimeoutSec)) } catch { $utt = $null }
    if ($null -eq $utt) {
      Write-Event 'no_speech' ''
    } else {
      $text = $utt.Text.Trim()
      if ($text.Length -gt 0) { Write-Event 'utterance' $text } else { Write-Event 'no_speech' '' }
    }

    if ($isWav) { $idx++ }
  }
} catch {
  try { Write-Event 'error' $_.Exception.Message } catch { }
  exit 1
}
