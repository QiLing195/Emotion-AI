/**
 * 桌面图标互动（v1.90）：她能"看到"你桌面上有什么；想打开某个东西要先弹授权卡。
 *
 * 安全边界（第一版故意收紧）：
 *   · 只读列表：只列 桌面 目录（用户桌面 + 公共桌面）的文件名/类型/大小/时间，不读内容
 *   · 打开：仅限 文件夹 / 快捷方式(.lnk,.url) / 文档(.txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx)
 *            / 图片(.png,.jpg,.jpeg,.webp,.gif) —— **exe/bat/cmd/ps1/vbs/msi 一律拒绝**
 *   · 每次打开都要你在桌宠上点「允许」（服务端只挂一个待确认动作，120 秒过期）
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const DESKTOP_MAX_ITEMS = 80;
export const DESKTOP_ACTION_TTL_MS = 120_000;

const OPEN_ALLOW_EXT = new Set([
  '.lnk', '.url', // 快捷方式
  '.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', // 文档
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', // 图片
  '.mp3', '.mp4', '.mkv', '.wav', // 媒体
]);
const OPEN_BLOCK_EXT = new Set(['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi', '.dll', '.scr', '.com', '.reg']);

export interface DesktopItem {
  name: string;
  /** 只发给本机桌宠页（不经过网络），用于「允许打开」 */
  path: string;
  kind: 'folder' | 'shortcut' | 'document' | 'image' | 'media' | 'other';
  ext: string;
  bytes: number;
  modifiedAt: number;
  /** 是否可以"打开"（exe/脚本类会被拒绝） */
  canOpen: boolean;
  /** 不能打开的原因（给她解释用） */
  blockedReason?: string;
}

/**
 * 真实桌面路径：Windows 允许把「桌面」重定向到别的盘（本机是 D:\桌面），
 * 所以先读注册表 User Shell Folders，再退回 %USERPROFILE%\Desktop / OneDrive\Desktop / 公共桌面。
 */
function desktopFromRegistry(): string | null {
  try {
    // 注意：中文 Windows 上 reg.exe 的控制台输出是 GBK，Node 按 UTF-8 解会把 "D:\桌面" 变乱码，
    // 所以让 PowerShell 以 UTF-8 输出（只取那一行的值）。
    const ps = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
      + "(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -Name Desktop).Desktop";
    const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    });
    const raw = String(out.stdout ?? '').trim().split(/\r?\n/).pop()?.trim() ?? '';
    if (out.status !== 0 || !raw) return null;
    const p = raw.replace(/%USERPROFILE%/gi, homedir()).replace(/%PUBLIC%/gi, process.env.PUBLIC ?? '');
    return p || null;
  } catch { return null; }
}

let cachedRoots: string[] | null = null;

export function desktopRoots(): string[] {
  if (cachedRoots) return cachedRoots;
  const roots: string[] = [];
  const reg = desktopFromRegistry();
  if (reg) roots.push(reg);
  roots.push(join(homedir(), 'Desktop'));
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer;
  if (oneDrive) roots.push(join(oneDrive, 'Desktop'));
  const pub = process.env.PUBLIC;
  if (pub) roots.push(join(pub, 'Desktop'));
  const uniq = Array.from(new Set(roots.map(p => p.replace(/[\\/]+$/, ''))));
  const existing = uniq.filter(p => existsSync(p));
  cachedRoots = existing.length ? existing : uniq;
  return cachedRoots;
}

/** 测试/调试用：清掉桌面路径缓存 */
export function resetDesktopRootsCacheForTests(): void {
  cachedRoots = null;
}

function classify(name: string, isDir: boolean): { kind: DesktopItem['kind']; ext: string } {
  if (isDir) return { kind: 'folder', ext: '' };
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (ext === '.lnk' || ext === '.url') return { kind: 'shortcut', ext };
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return { kind: 'image', ext };
  if (['.mp3', '.mp4', '.mkv', '.wav'].includes(ext)) return { kind: 'media', ext };
  if (['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'].includes(ext)) {
    return { kind: 'document', ext };
  }
  return { kind: 'other', ext };
}

export function openPolicy(item: Pick<DesktopItem, 'kind' | 'ext'>): { canOpen: boolean; reason?: string } {
  if (item.kind === 'folder') return { canOpen: true };
  if (OPEN_BLOCK_EXT.has(item.ext)) return { canOpen: false, reason: '可执行文件/脚本不能直接打开（安全限制）' };
  if (OPEN_ALLOW_EXT.has(item.ext)) return { canOpen: true };
  return { canOpen: false, reason: '这个类型不开放（只允许快捷方式/文档/图片/音视频/文件夹）' };
}

/** 列出桌面图标（只读，最多 80 个，按名字排序） */
export function listDesktopItems(limit = DESKTOP_MAX_ITEMS): { roots: string[]; items: DesktopItem[]; truncated: boolean } {
  const roots = desktopRoots();
  const items: DesktopItem[] = [];
  const seenNames = new Set<string>();
  let truncated = false;
  for (const root of roots) {
    let names: string[] = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (seenNames.has(name.toLowerCase())) continue;
      const full = join(root, name);
      try {
        const st = statSync(full);
        seenNames.add(name.toLowerCase());
        const { kind, ext } = classify(name, st.isDirectory());
        const policy = openPolicy({ kind, ext });
        items.push({
          name,
          path: full,
          kind,
          ext,
          bytes: st.isDirectory() ? 0 : st.size,
          modifiedAt: st.mtimeMs,
          canOpen: policy.canOpen,
          ...(policy.reason ? { blockedReason: policy.reason } : {}),
        });
      } catch { /* 跳过读不到的项 */ }
      if (items.length >= limit) { truncated = true; break; }
    }
    if (truncated) break;
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { roots, items, truncated };
}

/** 她做工具调用时看到的版本（不含本机绝对路径，避免路径泄漏进模型上下文） */
export function listDesktopForModel(limit = DESKTOP_MAX_ITEMS): {
  ok: boolean;
  count: number;
  items: Array<{ name: string; kind: string; ext: string; bytes: number; canOpen: boolean }>;
  truncated: boolean;
} {
  const { items, truncated } = listDesktopItems(limit);
  return {
    ok: true,
    count: items.length,
    items: items.map(i => ({ name: i.name, kind: i.kind, ext: i.ext, bytes: i.bytes, canOpen: i.canOpen })),
    truncated,
  };
}

/** 校验一个路径确实是桌面上的条目（防越权） */
export function isDesktopPath(p: string): boolean {
  if (!p) return false;
  const abs = resolve(p);
  return desktopRoots().some(root => {
    const r = resolve(root);
    return abs === r || abs.startsWith(r + sep);
  });
}

export type DesktopActionKind = 'open' | 'move' | 'rename';

export interface PendingDesktopAction {
  id: string;
  kind: DesktopActionKind;
  path: string;
  name: string;
  reason: string;
  targetPath?: string;
  targetName?: string;
  createdAt: number;
}

let pending: PendingDesktopAction | null = null;

export function setPendingDesktopAction(input: { kind?: DesktopActionKind; path: string; name: string; reason?: string; targetPath?: string; targetName?: string }): PendingDesktopAction {
  pending = {
    id: `desk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: input.kind ?? 'open',
    path: input.path,
    name: input.name,
    reason: input.reason ?? '',
    ...(input.targetPath ? { targetPath: input.targetPath } : {}),
    ...(input.targetName ? { targetName: input.targetName } : {}),
    createdAt: Date.now(),
  };
  return pending;
}

export function getPendingDesktopAction(now = Date.now()): PendingDesktopAction | null {
  if (!pending) return null;
  if (now - pending.createdAt > DESKTOP_ACTION_TTL_MS) { pending = null; return null; }
  return pending;
}

export function clearPendingDesktopAction(): void {
  pending = null;
}

/** 她请求打开桌面上的某个东西：返回给模型的结果（不暴露绝对路径） */
export function requestOpenDesktopItem(query: string): {
  ok: boolean;
  needsApproval?: boolean;
  name?: string;
  reason?: string;
  candidates?: string[];
} {
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, reason: '没说打开哪个' };
  const { items } = listDesktopItems();
  const lower = q.toLowerCase();
  const exact = items.find(i => i.name === q) ?? items.find(i => i.name.replace(/\.[^.]+$/, '') === q);
  const fuzzy = exact ?? items.filter(i => i.name.toLowerCase().includes(lower)).sort((a, b) => a.name.length - b.name.length)[0];
  if (!fuzzy) {
    return { ok: false, reason: `桌面上没找到「${q}」`, candidates: items.slice(0, 8).map(i => i.name) };
  }
  if (!fuzzy.canOpen) {
    return { ok: false, name: fuzzy.name, reason: fuzzy.blockedReason ?? '这个类型不能打开' };
  }
  setPendingDesktopAction({ kind: 'open', path: fuzzy.path, name: fuzzy.name, reason: q });
  return { ok: true, needsApproval: true, name: fuzzy.name };
}

// ===== v1.91 移动 / 重命名（都要授权；执行后 5 分钟内可撤销） =====

export interface DesktopActionResult {
  ok: boolean;
  needsApproval?: boolean;
  note?: string;
  kind?: DesktopActionKind;
  from?: string;
  to?: string;
  reason?: string;
  undoAvailable?: boolean;
}

const BAD_NAME = /[\\/:*?"<>|\x00]/;
let lastUndo: { kind: 'move' | 'rename'; fromPath: string; toPath: string; fromName: string; toName: string; at: number } | null = null;
export const DESKTOP_UNDO_TTL_MS = 5 * 60_000;

function findDesktopItem(query: string): DesktopItem | null {
  const q = String(query ?? '').trim();
  if (!q) return null;
  const { items } = listDesktopItems();
  const lower = q.toLowerCase();
  const exact = items.find(i => i.name === q) ?? items.find(i => i.name.replace(/\.[^.]+$/, '') === q);
  return exact ?? items.filter(i => i.name.toLowerCase().includes(lower)).sort((a, b) => a.name.length - b.name.length)[0] ?? null;
}

function safeNewName(name: string): string | null {
  const n = String(name ?? '').trim();
  if (!n || n.length > 120) return null;
  if (BAD_NAME.test(n) || n === '.' || n === '..') return null;
  return n;
}

/** 她请求把桌面上的某个东西移动到另一个桌面文件夹 */
export function requestMoveDesktopItem(query: string, targetFolder: string): DesktopActionResult {
  const item = findDesktopItem(query);
  if (!item) return { ok: false, reason: `桌面上没找到「${query}」` };
  if (item.name.toLowerCase() === 'desktop.ini') return { ok: false, reason: 'desktop.ini 是系统文件，不动它' };
  const folder = findDesktopItem(targetFolder);
  if (!folder) return { ok: false, reason: `桌面上没有文件夹「${targetFolder}」` };
  if (folder.kind !== 'folder') return { ok: false, reason: `「${folder.name}」不是文件夹` };
  if (folder.path === item.path) return { ok: false, reason: '原地不动没意义' };
  const targetPath = join(folder.path, item.name);
  if (existsSync(targetPath)) return { ok: false, reason: `「${folder.name}」里已经有同名文件了` };
  setPendingDesktopAction({ kind: 'move', path: item.path, name: item.name, targetPath, targetName: folder.name, reason: query });
  return { ok: true, needsApproval: true, kind: 'move', from: item.name, to: folder.name, note: '已在他桌宠上弹出授权卡；他点允许后才真的移动，此刻还没动。先跟他说一声要他点一下。' };
}

/** 她请求重命名桌面上的某个东西 */
export function requestRenameDesktopItem(query: string, newName: string): DesktopActionResult {
  const item = findDesktopItem(query);
  if (!item) return { ok: false, reason: `桌面上没找到「${query}」` };
  if (item.name.toLowerCase() === 'desktop.ini') return { ok: false, reason: 'desktop.ini 是系统文件，不动它' };
  const keepExt = item.kind !== 'folder' && item.ext && !String(newName).toLowerCase().endsWith(item.ext);
  const base = safeNewName(newName);
  if (!base) return { ok: false, reason: '新名字不合法（不能含 \\ / : * ? " < > |）' };
  const finalName = keepExt ? base + item.ext : base;
  const targetPath = join(item.path.slice(0, item.path.length - item.name.length), finalName);
  if (existsSync(targetPath)) return { ok: false, reason: `桌面上已经有「${finalName}」了` };
  setPendingDesktopAction({ kind: 'rename', path: item.path, name: item.name, targetName: finalName, targetPath, reason: query });
  return { ok: true, needsApproval: true, kind: 'rename', from: item.name, to: finalName, note: '已在他桌宠上弹出授权卡；他点允许后才真的改名，此刻还没改。先跟他说一声要他点一下。' };
}

function appendDesktopEvent(ev: Record<string, unknown>): void {
  try {
    const dir = 'memories';
    if (!existsSync(dir)) return;
    const line = JSON.stringify({ ts: Date.now(), ...ev }) + '\n';
    const p = join(dir, 'desktop_events.jsonl');
    writeFileSync(p, line, { flag: 'a' });
  } catch { /* ignore */ }
}

/** 桌宠页点「允许」后执行 move/rename（open 由 Electron 执行） */
export function executePendingDesktopAction(): DesktopActionResult {
  const act = getPendingDesktopAction();
  if (!act) return { ok: false, reason: '没有待确认的动作（可能已过期）' };
  clearPendingDesktopAction();
  if (act.kind === 'open') return { ok: true, kind: 'open', from: act.name, to: act.name };
  if (!act.targetPath) return { ok: false, reason: '缺少目标路径' };
  if (!isDesktopPath(act.path) || !isDesktopPath(act.targetPath)) return { ok: false, reason: '目标不在桌面内' };
  if (!existsSync(act.path)) return { ok: false, reason: '源文件已经不在桌面上了' };
  if (existsSync(act.targetPath)) return { ok: false, reason: '目标位置已存在同名项' };
  try {
    renameSync(act.path, act.targetPath);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  lastUndo = {
    kind: act.kind,
    fromPath: act.path,
    toPath: act.targetPath,
    fromName: act.name,
    toName: act.kind === 'rename' ? (act.targetName ?? '') : act.name,
    at: Date.now(),
  };
  appendDesktopEvent({ kind: act.kind, name: act.name, to: act.targetName ?? '', fromPath: act.path, toPath: act.targetPath });
  return { ok: true, kind: act.kind, from: act.name, to: act.targetName ?? '', undoAvailable: true };
}

export function undoLastDesktopAction(): DesktopActionResult {
  if (!lastUndo) return { ok: false, reason: '没有可撤销的操作' };
  if (Date.now() - lastUndo.at > DESKTOP_UNDO_TTL_MS) { lastUndo = null; return { ok: false, reason: '撤销已过期（5 分钟）' }; }
  const u = lastUndo;
  try {
    if (!existsSync(u.toPath)) return { ok: false, reason: '东西已经不在原位置了' };
    if (existsSync(u.fromPath)) return { ok: false, reason: '原位置已有同名项，撤销会覆盖，先不动' };
    renameSync(u.toPath, u.fromPath);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  lastUndo = null;
  appendDesktopEvent({ kind: 'undo', name: u.fromName });
  return { ok: true, kind: u.kind, from: u.toName, to: u.fromName };
}

export function hasUndoableDesktopAction(): boolean {
  return Boolean(lastUndo && Date.now() - lastUndo.at <= DESKTOP_UNDO_TTL_MS);
}

/** 记录"打开"事件（由桌宠页在 Electron 打开成功后调用） */
export function recordDesktopOpen(name: string): void {
  appendDesktopEvent({ kind: 'open', name });
}

export interface DesktopEventView {
  ts: number;
  kind: string;
  name: string;
  to?: string;
}

export function readDesktopEvents(limit = 10): DesktopEventView[] {
  try {
    const p = join('memories', 'desktop_events.jsonl');
    if (!existsSync(p)) return [];
    const rows: DesktopEventView[] = [];
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { ts?: number; kind?: string; name?: string; to?: string };
        if (!Number.isFinite(Number(o.ts)) || !o.kind || !o.name) continue;
        rows.push({ ts: Number(o.ts), kind: String(o.kind), name: String(o.name), ...(o.to ? { to: String(o.to) } : {}) });
      } catch { /* skip */ }
    }
    return rows.sort((a, b) => b.ts - a.ts).slice(0, Math.max(1, Math.min(50, limit)));
  } catch { return []; }
}
