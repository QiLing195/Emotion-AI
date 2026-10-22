# 活动窗口采样器（v1.82）——每 20 秒把"当前前台窗口标题 + 进程名"追加到 JSONL
#
# 为什么是独立 PowerShell 进程：
#   Node 侧不方便直接调 Win32 API；而每次采样都 spawn 一个 PS 太贵（~0.5-1s）。
#   所以起**一个**长驻 PS 循环，只在文件里追加行；Node 只是读文件（不走管道）。
#
# 隐私：只记录窗口标题与进程名，**不记录键盘输入、不截屏、不读剪贴板**。
#       标题命中敏感词会被替换为 [已隐藏]（见 $SensitivePatterns）。

$ErrorActionPreference = 'SilentlyContinue'
$outPath = $args[0]
if (-not $outPath) { $outPath = 'memories/activity_log.jsonl' }
$intervalMs = 20000
if ($args.Count -ge 2) {
  $parsed = 0
  if ([int]::TryParse($args[1], [ref]$parsed) -and $parsed -ge 5000) { $intervalMs = $parsed }
}

# 只取前台窗口：不枚举全部窗口，避免把后台乱七八糟的东西记下来
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ActivitySampler {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static string Title() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static uint PidOf() {
    IntPtr h = GetForegroundWindow();
    uint pid = 0;
    GetWindowThreadProcessId(h, out pid);
    return pid;
  }
}
'@

$sensitive = @('password', 'passwd', '密码', '银行', '支付', '支付宝', '微信支付', '私钥', 'secret', 'token', '登录')

$dir = Split-Path -Parent $outPath
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

while ($true) {
  try {
    $title = [ActivitySampler]::Title()
    $proc = ''
    $p = Get-Process -Id ([ActivitySampler]::PidOf()) -ErrorAction SilentlyContinue
    if ($p) { $proc = $p.ProcessName }
    if ($title) {
      foreach ($s in $sensitive) {
        if ($title -match [regex]::Escape($s)) { $title = '[已隐藏：疑似敏感窗口]'; break }
      }
      $row = @{
        ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        title = $title
        process = $proc
      } | ConvertTo-Json -Compress
      # 文件超过 2MB 就滚动一份（保留最近 3 份），避免无限增长
      if ((Test-Path $outPath) -and ((Get-Item $outPath).Length -gt 2MB)) {
        for ($i = 2; $i -ge 1; $i--) {
          $src = "$outPath.$i"
          $dst = "$outPath.$($i + 1)"
          if (Test-Path $src) { Move-Item -Force $src $dst }
        }
        Move-Item -Force $outPath "$outPath.1"
      }
      Add-Content -Path $outPath -Value $row -Encoding UTF8
    }
  } catch { }
  Start-Sleep -Milliseconds $intervalMs
}
