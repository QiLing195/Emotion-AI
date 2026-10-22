/**
 * 活动窗口采样（v1.82）——**只读**：只记录"前台窗口标题 + 进程名"，不记键盘、不截屏、不读剪贴板。
 *
 * 架构：
 *   Node（本模块）负责启动/停止一个**长驻 PowerShell 采样器**（scripts/activity-sampler.ps1），
 *   采样器每 20 秒往 `memories/activity_log.jsonl` 追加一行；Node 只**读文件**（不走管道，
 *   避免受限环境下 stdio pipe 的 EPERM 问题）。
 *
 * 开关：`ENABLE_ACTIVITY_WATCH=true`（默认关）。
 * 隐私：标题命中敏感词（密码/银行/支付/登录…）会被采样器替换成 [已隐藏]；
 *       本模块读取时也会再过滤一次（双保险），并把文件路径固定在工作区内。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACTIVITY_LOG_PATH = join('memories', 'activity_log.jsonl');
export const ACTIVITY_SAMPLE_MS = 20_000;
const MAX_READ_LINES = 400;

const SENSITIVE = ['password', 'passwd', '密码', '银行', '支付', '支付宝', '私钥', 'secret', 'token', '登录'];

export function activityWatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_ACTIVITY_WATCH === 'true';
}

export interface ActivityEntry {
  ts: number;
  title: string;
  process?: string;
}

export interface ActivityView {
  enabled: boolean;
  entries: Array<{ title: string; process: string; minutesAgo: number; ts: number }>;
  note?: string;
}

/** 二次脱敏（采样器已做一次，这里防旧文件/手工写入绕过） */
export function redactTitle(title: string): string {
  const t = String(title ?? '').trim();
  if (!t) return '';
  for (const s of SENSITIVE) {
    if (t.toLowerCase().includes(s.toLowerCase())) return '[已隐藏：疑似敏感窗口]';
  }
  return t.slice(0, 160);
}

/** 解析 JSONL（坏行跳过，不抛错） */
export function parseActivityLog(text: string): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const row = JSON.parse(s) as { ts?: number; title?: string; process?: string };
      if (typeof row.ts !== 'number' || typeof row.title !== 'string') continue;
      out.push({ ts: row.ts, title: row.title, ...(row.process ? { process: String(row.process) } : {}) });
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

/** 读最近 N 条（供她的工具用；去重连续相同标题，避免刷屏） */
export function readRecentActivity(limit = 10, now = Date.now(), path = ACTIVITY_LOG_PATH): ActivityView {
  if (!activityWatchEnabled()) {
    return { enabled: false, entries: [], note: '活动采样没开（ENABLE_ACTIVITY_WATCH=false），她看不到你在用什么。' };
  }
  if (!existsSync(path)) {
    return { enabled: true, entries: [], note: '还没有采样记录（采样器可能刚启动，或你一直没切换窗口）。' };
  }
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return { enabled: true, entries: [], note: '活动记录读取失败。' }; }
  const rows = parseActivityLog(text).sort((a, b) => b.ts - a.ts).slice(0, MAX_READ_LINES);

  const capped = Math.max(1, Math.min(20, Number.isFinite(limit) ? limit : 10));
  const picked: Array<{ title: string; process: string; minutesAgo: number; ts: number }> = [];
  let lastTitle = '';
  for (const r of rows) {
    const title = redactTitle(r.title);
    if (!title || title === lastTitle) continue;      // 连续同窗口不重复列
    lastTitle = title;
    picked.push({
      title,
      process: String(r.process ?? '').slice(0, 40),
      minutesAgo: Math.max(0, Math.round((now - r.ts) / 60_000)),
      ts: r.ts,
    });
    if (picked.length >= capped) break;
  }
  return { enabled: true, entries: picked };
}

let sampler: ChildProcess | null = null;

/** 启动采样器（幂等；失败只告警，不影响主流程） */
export function startActivitySampler(opts: { intervalMs?: number; logPath?: string } = {}): boolean {
  if (!activityWatchEnabled()) return false;
  if (sampler && !sampler.killed) return true;
  const scriptPath = join('scripts', 'activity-sampler.ps1');
  if (!existsSync(scriptPath)) { console.warn('[Activity] 采样脚本不存在，跳过'); return false; }
  const interval = Math.max(5000, opts.intervalMs ?? ACTIVITY_SAMPLE_MS);
  try {
    sampler = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      opts.logPath ?? ACTIVITY_LOG_PATH, String(interval),
    ], { stdio: 'ignore', windowsHide: true, detached: false });
    sampler.on('error', (e) => { console.warn(`[Activity] 采样器启动失败：${e.message}`); sampler = null; });
    sampler.on('exit', (code) => { if (code !== 0 && code !== null) console.warn(`[Activity] 采样器退出 code=${code}`); sampler = null; });
    console.log(`[Activity] 活动采样已启动（每 ${Math.round(interval / 1000)}s，仅窗口标题）`);
    return true;
  } catch (e) {
    console.warn(`[Activity] 启动异常：${(e as Error).message}`);
    sampler = null;
    return false;
  }
}

export function stopActivitySampler(): void {
  if (!sampler) return;
  try { sampler.kill(); } catch { /* ignore */ }
  sampler = null;
  console.log('[Activity] 活动采样已停止');
}

export function isActivitySamplerRunning(): boolean {
  return Boolean(sampler && !sampler.killed);
}
