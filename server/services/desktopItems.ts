/**
 * 桌面图标互动（v1.90）：她能"看到"你桌面上有什么；想打开某个东西要先弹授权卡。
 *
 * 安全边界（第一版故意收紧）：
 *   · 只读列表：只列 桌面 目录（用户桌面 + 公共桌面）的文件名/类型/大小/时间，不读内容
 *   · 打开：仅限 文件夹 / 快捷方式(.lnk,.url) / 文档(.txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx)
 *            / 图片(.png,.jpg,.jpeg,.webp,.gif) —— **exe/bat/cmd/ps1/vbs/msi 一律拒绝**
 *   · 每次打开都要你在桌宠上点「允许」（服务端只挂一个待确认动作，120 秒过期）
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
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

export function desktopRoots(): string[] {
  const roots = [join(homedir(), 'Desktop')];
  const pub = process.env.PUBLIC;
  if (pub) roots.push(join(pub, 'Desktop'));
  return Array.from(new Set(roots)).filter(p => existsSync(p));
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
  let truncated = false;
  for (const root of roots) {
    let names: string[] = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = join(root, name);
      try {
        const st = statSync(full);
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

export interface PendingDesktopAction {
  id: string;
  path: string;
  name: string;
  reason: string;
  createdAt: number;
}

let pending: PendingDesktopAction | null = null;

export function setPendingDesktopAction(input: { path: string; name: string; reason?: string }): PendingDesktopAction {
  pending = {
    id: `desk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    path: input.path,
    name: input.name,
    reason: input.reason ?? '',
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
  setPendingDesktopAction({ path: fuzzy.path, name: fuzzy.name, reason: q });
  return { ok: true, needsApproval: true, name: fuzzy.name };
}
