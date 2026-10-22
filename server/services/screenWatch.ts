/**
 * 屏幕观察（v1.83）——她"看一眼你的屏幕"，由 **Electron 主进程截屏**（PowerShell 抓屏会被杀软拦），
 * 再由 PowerShell 只做 **OCR**（Windows.Media.Ocr，中文引擎）把屏幕文字读成文本，
 * 这样纯文本模型也能"看懂"你在做什么。
 *
 * 四种模式（用户在桌宠窗口里选）：
 *   A `on_demand_10`：你说→立刻截；她主动→弹一次授权（批准后 15 分钟免问）；定时最多 10 分钟一张
 *   B `on_demand_5` ：同上，但定时最多 5 分钟一张
 *   C `explicit_only`：只有你明确说"截/看看屏幕"才截；她自己不能主动看
 *   D `auto_no_prompt`：她自己随时可看（限频 10 分钟），不弹授权（隐私风险最高）
 *
 * 安全：前台是敏感窗口（密码/银行/支付/登录…）→ 直接拒绝并说明；每张都写审计账本；只保留 7 天。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readRecentActivity, activityWatchEnabled } from './activityWatcher.js';

export type ScreenPolicy = 'on_demand_10' | 'on_demand_5' | 'explicit_only' | 'auto_no_prompt';
export const SCREEN_POLICIES: ScreenPolicy[] = ['on_demand_10', 'on_demand_5', 'explicit_only', 'auto_no_prompt'];
export const DEFAULT_SCREEN_POLICY: ScreenPolicy = 'on_demand_10';

export const SCREEN_DIR = join('memories', 'screens');
export const SCREEN_SETTINGS_PATH = join('memories', 'pet_settings.json');
export const SCREEN_AUDIT_PATH = join('memories', 'screen_captures.jsonl');
/** Electron 轮询"有没有截屏请求" */
export const CAPTURE_REQUEST_PATH = join('memories', 'screen_request.json');
/** Electron 截完后回写结果 */
export const CAPTURE_RESULT_PATH = join('memories', 'screen_result.json');
export const SCREEN_RETENTION_DAYS = 7;
export const SCREEN_MIN_GAP_MS = 60_000;
export const SESSION_GRANT_MS = 15 * 60_000;

const SENSITIVE = ['password', 'passwd', '密码', '银行', '支付', '支付宝', '私钥', 'secret', 'token', '登录'];

export interface PetSettings {
  screenPolicy: ScreenPolicy;
  /** 最近一次用户批准"她可以自己看屏幕"的时间（会话内免问） */
  screenGrantAt: number;
}

export function loadPetSettings(): PetSettings {
  const fallback: PetSettings = { screenPolicy: DEFAULT_SCREEN_POLICY, screenGrantAt: 0 };
  if (!existsSync(SCREEN_SETTINGS_PATH)) return fallback;
  try {
    const raw = JSON.parse(readFileSync(SCREEN_SETTINGS_PATH, 'utf8')) as Partial<PetSettings>;
    return {
      screenPolicy: SCREEN_POLICIES.includes(raw.screenPolicy as ScreenPolicy) ? raw.screenPolicy as ScreenPolicy : DEFAULT_SCREEN_POLICY,
      screenGrantAt: Number.isFinite(Number(raw.screenGrantAt)) ? Number(raw.screenGrantAt) : 0,
    };
  } catch { return fallback; }
}

export function savePetSettings(next: Partial<PetSettings>): PetSettings {
  const cur = loadPetSettings();
  const merged: PetSettings = {
    screenPolicy: next.screenPolicy && SCREEN_POLICIES.includes(next.screenPolicy) ? next.screenPolicy : cur.screenPolicy,
    screenGrantAt: Number.isFinite(Number(next.screenGrantAt)) ? Number(next.screenGrantAt) : cur.screenGrantAt,
  };
  try {
    const dir = dirname(SCREEN_SETTINGS_PATH);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SCREEN_SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[Screen] 保存设置失败：${(e as Error).message}`);
  }
  return merged;
}

/** 敏感窗口检测（复用活动采样的最新前台标题；采样没开则不做此检查并如实标注） */
export function sensitiveWindowActive(now = Date.now()): { sensitive: boolean; title?: string; checked: boolean } {
  if (!activityWatchEnabled()) return { sensitive: false, checked: false };
  const view = readRecentActivity(1, now);
  const title = view.entries[0]?.title ?? '';
  if (!title) return { sensitive: false, checked: true };
  const s = SENSITIVE.some(k => title.toLowerCase().includes(k.toLowerCase()));
  return { sensitive: s, title, checked: true };
}

export interface CaptureRecord {
  ts: number;
  trigger: 'user' | 'her' | 'auto';
  ok: boolean;
  reason?: string;
  imagePath?: string;
  ocrChars?: number;
  ms?: number;
}

export function readCaptureAudit(limit = 20): CaptureRecord[] {
  if (!existsSync(SCREEN_AUDIT_PATH)) return [];
  try {
    const rows: CaptureRecord[] = [];
    for (const line of readFileSync(SCREEN_AUDIT_PATH, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as CaptureRecord;
        if (Number.isFinite(Number(r.ts))) rows.push(r);
      } catch { /* skip */ }
    }
    return rows.sort((a, b) => b.ts - a.ts).slice(0, Math.max(1, Math.min(100, limit)));
  } catch { return []; }
}

export function auditCapture(record: CaptureRecord): void {
  try {
    const dir = dirname(SCREEN_AUDIT_PATH);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(SCREEN_AUDIT_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* ignore */ }
}

/** 定时频率（毫秒）；explicit_only 不允许她主动，所以无定时 */
export function autoIntervalMs(policy: ScreenPolicy): number {
  if (policy === 'on_demand_5') return 5 * 60_000;
  if (policy === 'on_demand_10') return 10 * 60_000;
  if (policy === 'auto_no_prompt') return 10 * 60_000;
  return Number.POSITIVE_INFINITY;
}

export interface CaptureDecision {
  allowed: boolean;
  reason: string;
  /** 是否需要用户先点一次授权 */
  needsApproval: boolean;
}

/** 是否允许现在截一张（trigger 区分谁发起的） */
export function decideCapture(trigger: 'user' | 'her' | 'auto', now = Date.now()): CaptureDecision {
  const settings = loadPetSettings();
  const policy = settings.screenPolicy;
  const audit = readCaptureAudit(50);
  const last = audit.find(r => r.ok);
  const gapPolicy = trigger === 'auto' ? autoIntervalMs(policy) : SCREEN_MIN_GAP_MS;
  if (last && now - last.ts < gapPolicy) {
    const waitMin = Math.ceil((gapPolicy - (now - last.ts)) / 60_000);
    return { allowed: false, reason: `太频繁：距上一次截图不到 ${waitMin} 分钟（当前模式 ${policy}）`, needsApproval: false };
  }

  const sens = sensitiveWindowActive(now);
  if (sens.sensitive) {
    return { allowed: false, reason: `前台是敏感窗口（${sens.title}），这次不截`, needsApproval: false };
  }

  if (trigger === 'user') return { allowed: true, reason: '你明确要求的', needsApproval: false };
  if (policy === 'explicit_only') {
    return { allowed: false, reason: '当前模式是"只在你明确说的时候截"，她不能主动看', needsApproval: false };
  }
  if (policy === 'auto_no_prompt') return { allowed: true, reason: 'auto_no_prompt 模式（不弹授权）', needsApproval: false };
  // on_demand_*：会话内 15 分钟免问
  if (now - settings.screenGrantAt < SESSION_GRANT_MS) {
    return { allowed: true, reason: '你 15 分钟内批准过她看屏幕', needsApproval: false };
  }
  return { allowed: false, reason: '需要你先允许她看屏幕（点桌宠上的"允许"）', needsApproval: true };
}

export function grantScreenSession(now = Date.now()): PetSettings {
  return savePetSettings({ screenGrantAt: now });
}

export function revokeScreenSession(): PetSettings {
  return savePetSettings({ screenGrantAt: 0 });
}

/** 清理过期截图（只动 memories/screens 下的 screen-*.jpg） */
export function cleanupOldScreens(now = Date.now()): number {
  if (!existsSync(SCREEN_DIR)) return 0;
  let removed = 0;
  try {
    for (const name of readdirSync(SCREEN_DIR)) {
      if (!/^screen-.*\.jpg$/.test(name)) continue;
      const p = join(SCREEN_DIR, name);
      try {
        if (now - statSync(p).mtimeMs > SCREEN_RETENTION_DAYS * 24 * 3_600_000) { unlinkSync(p); removed++; }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return removed;
}

export interface PendingCaptureRequest {
  id: string;
  trigger: 'user' | 'her' | 'auto';
  createdAt: number;
  reason: string;
}

export function writeCaptureRequest(trigger: 'user' | 'her' | 'auto', reason: string): PendingCaptureRequest {
  const req: PendingCaptureRequest = {
    id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trigger, createdAt: Date.now(), reason,
  };
  try {
    const dir = dirname(CAPTURE_REQUEST_PATH);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CAPTURE_REQUEST_PATH, JSON.stringify(req), 'utf8');
  } catch (e) {
    console.warn(`[Screen] 写截屏请求失败：${(e as Error).message}`);
  }
  return req;
}

export function readCaptureRequest(): PendingCaptureRequest | null {
  if (!existsSync(CAPTURE_REQUEST_PATH)) return null;
  try {
    const req = JSON.parse(readFileSync(CAPTURE_REQUEST_PATH, 'utf8')) as PendingCaptureRequest;
    if (!req?.id) return null;
    if (Date.now() - Number(req.createdAt) > 60_000) return null;   // 超时作废
    return req;
  } catch { return null; }
}

export function clearCaptureRequest(): void {
  try { if (existsSync(CAPTURE_REQUEST_PATH)) unlinkSync(CAPTURE_REQUEST_PATH); } catch { /* ignore */ }
}

export interface CaptureResult {
  id: string;
  ok: boolean;
  imagePath?: string;
  bytes?: number;
  width?: number;
  height?: number;
  error?: string;
  ocrOk?: boolean;
  ocrText?: string;
  ocrError?: string;
  ms?: number;
  createdAt: number;
}

export function readCaptureResult(): CaptureResult | null {
  if (!existsSync(CAPTURE_RESULT_PATH)) return null;
  try { return JSON.parse(readFileSync(CAPTURE_RESULT_PATH, 'utf8')) as CaptureResult; } catch { return null; }
}

export function clearCaptureResult(): void {
  try { if (existsSync(CAPTURE_RESULT_PATH)) unlinkSync(CAPTURE_RESULT_PATH); } catch { /* ignore */ }
}
