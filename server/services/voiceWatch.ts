/**
 * 语音唤醒（v1.88）：Windows 自带 System.Speech 离线识别（zh-CN），不需要下载模型、不需要联网。
 *
 * 链路：scripts/voice-wake.ps1（长驻）→ 写 memories/voice_events.jsonl →
 *      本服务增量读取 → 暴露给桌宠页轮询（/api/pet/voice）
 *
 * 事件：ready / wake / utterance / no_speech / error
 * 桌宠页收到 wake → 冒泡"嗯？"；收到 utterance → 走 /api/chat 拿回复 → 冒泡（**不出声**）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const VOICE_EVENTS_PATH = join('memories', 'voice_events.jsonl');
export const VOICE_CONFIG_PATH = join('scripts', 'voice-config.json');
export const VOICE_SCRIPT_PATH = join('scripts', 'voice-wake.ps1');
export const VOICE_POLL_MS = 700;
export const VOICE_MAX_EVENTS = 100;

export type VoiceEventKind = 'ready' | 'wake' | 'utterance' | 'no_speech' | 'error';

export interface VoiceEvent {
  seq: number;
  ts: number;
  kind: VoiceEventKind;
  text: string;
}

export interface VoiceView {
  enabled: boolean;
  running: boolean;
  ready: boolean;
  /** 最近一次事件（供桌宠判断要不要冒泡） */
  last: VoiceEvent | null;
  /** 累计收到的事件数（桌宠用它做 after 游标） */
  seq: number;
}

export function voiceWakeEnabled(): boolean {
  return process.env.ENABLE_VOICE_WAKE === 'true';
}

let child: ChildProcess | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let readOffset = 0;
let seq = 0;
let ready = false;
let last: VoiceEvent | null = null;
const recent: VoiceEvent[] = [];

function ensureFile(): void {
  try {
    const dir = dirname(VOICE_EVENTS_PATH);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(VOICE_EVENTS_PATH)) appendFileSync(VOICE_EVENTS_PATH, '', 'utf8');
  } catch { /* ignore */ }
}

function parseLine(line: string): { ts: number; kind: VoiceEventKind; text: string } | null {
  const raw = line.trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { ts?: number; kind?: string; text?: string };
    const kind = String(obj.kind ?? '');
    if (!['ready', 'wake', 'utterance', 'no_speech', 'error'].includes(kind)) return null;
    return {
      ts: Number.isFinite(Number(obj.ts)) ? Number(obj.ts) : Date.now(),
      kind: kind as VoiceEventKind,
      text: typeof obj.text === 'string' ? obj.text : '',
    };
  } catch { return null; }
}

/** 增量读取文件里的新事件（被 startVoiceSampler 定时调用；测试里可直接调） */
export function pumpVoiceEvents(): VoiceEvent[] {
  ensureFile();
  let content = '';
  try { content = readFileSync(VOICE_EVENTS_PATH, 'utf8'); } catch { return []; }
  if (content.length <= readOffset) return [];
  const chunk = content.slice(readOffset);
  readOffset = content.length;
  const newEvents: VoiceEvent[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    seq += 1;
    const ev: VoiceEvent = { seq, ...parsed };
    recent.push(ev);
    while (recent.length > VOICE_MAX_EVENTS) recent.shift();
    if (ev.kind === 'ready') ready = true;
    if (ev.kind === 'error') ready = false;
    last = ev;
    newEvents.push(ev);
  }
  return newEvents;
}

/** 桌宠轮询：返回 seq > after 的事件 */
export function voiceEventsAfter(after: number): VoiceEvent[] {
  const min = Number.isFinite(after) ? after : 0;
  return recent.filter(e => e.seq > min);
}

export function voiceView(): VoiceView {
  return { enabled: voiceWakeEnabled(), running: Boolean(child), ready, last, seq };
}

export function startVoiceSampler(): void {
  if (!voiceWakeEnabled()) return;
  if (child) return;
  if (!existsSync(VOICE_SCRIPT_PATH)) {
    console.warn('[Voice] 找不到 scripts/voice-wake.ps1，语音唤醒不启动');
    return;
  }
  ensureFile();
  try {
    child = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VOICE_SCRIPT_PATH,
      '-OutFile', VOICE_EVENTS_PATH, '-ConfigFile', VOICE_CONFIG_PATH,
    ], { stdio: 'ignore', windowsHide: true });
    child.on('exit', () => { child = null; ready = false; });
    child.on('error', (e) => { child = null; ready = false; console.warn('[Voice] 识别进程启动失败：' + e.message); });
    pollTimer = setInterval(pumpVoiceEvents, VOICE_POLL_MS);
    console.log('[Voice] 语音唤醒已启动（说「安雅」/「小雅」/「anya」唤醒，之后说一句话）');
  } catch (e) {
    console.warn('[Voice] 启动失败：' + (e as Error).message);
  }
}

export function stopVoiceSampler(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (child) {
    try { child.kill(); } catch { /* ignore */ }
    child = null;
  }
  ready = false;
}

export function isVoiceSamplerRunning(): boolean {
  return Boolean(child);
}

/** 测试用：重置内存状态 */
export function resetVoiceStateForTests(): void {
  readOffset = 0; seq = 0; ready = false; last = null; recent.length = 0;
}

/** 测试/调试用：直接塞一个事件（不经过 PowerShell） */
export function injectVoiceEvent(kind: VoiceEventKind, text: string, ts = Date.now()): VoiceEvent {
  seq += 1;
  const ev: VoiceEvent = { seq, ts, kind, text };
  recent.push(ev);
  while (recent.length > VOICE_MAX_EVENTS) recent.shift();
  if (kind === 'ready') ready = true;
  if (kind === 'error') ready = false;
  last = ev;
  return ev;
}
