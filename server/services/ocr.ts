/**
 * 截图 OCR（v1.83）：只把**已存在的图片**交给 Windows.Media.Ocr 读文字。
 * 不在这里抓屏（抓屏由 Electron 主进程做——PowerShell 抓屏会被杀软判为恶意脚本）。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const OCR_TIMEOUT_MS = 25_000;
export const OCR_MAX_CHARS = 4000;

/** 对一张本地图片做 OCR；失败返回 { ok:false, error }（绝不抛错） */
export async function runOcr(imagePath: string): Promise<{ ok: boolean; text?: string; error?: string; ms: number }> {
  const t0 = Date.now();
  if (!existsSync(imagePath)) return { ok: false, error: 'image_not_found', ms: Date.now() - t0 };
  const script = join('scripts', 'ocr-image.ps1');
  if (!existsSync(script)) return { ok: false, error: 'ocr_script_missing', ms: Date.now() - t0 };
  const outTxt = join(tmpdir(), `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    const code = await new Promise<number>((resolve) => {
      const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, imagePath, outTxt], {
        stdio: 'ignore', windowsHide: true,
      });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, OCR_TIMEOUT_MS + 5000);
      child.on('close', c => { clearTimeout(timer); resolve(c ?? 1); });
      child.on('error', () => { clearTimeout(timer); resolve(1); });
    });
    if (!existsSync(outTxt)) return { ok: false, error: `ocr_no_output（exit ${code}）`, ms: Date.now() - t0 };
    const text = readFileSync(outTxt, 'utf8').trim();
    if (text.startsWith('OCR-ERROR')) return { ok: false, error: text.slice(0, 200), ms: Date.now() - t0 };
    return { ok: true, text: text.slice(0, OCR_MAX_CHARS), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, ms: Date.now() - t0 };
  } finally {
    try { if (existsSync(outTxt)) unlinkSync(outTxt); } catch { /* ignore */ }
  }
}

/** OCR 出来的文本往往一堆空格（中文按字切），压一压更省 token / 更好读 */
export function compactOcrText(text: string): string {
  return String(text ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
