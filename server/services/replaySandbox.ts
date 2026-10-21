/**
 * 沙盒真生成分叉回放（v1.62）—— **隔离进程、不碰线上、不回档**。
 *
 * 与 Stage C 的"决策层回放"的区别：
 *   · 决策层回放只显示"许可片段会变成什么"（零 LLM、确定性）；
 *   · 本模块**真的生成回复**：把当前 `memories/` 复制到临时目录，用独立进程（不同端口）跑，
 *     并在子进程里用 `REPLAY_FORCE_BRANCH` 强制她走某条分支，再用**同一句话**喂进去，
 *     对比不同分支下她的真实回复。
 *
 * 安全边界（用户关心的"回放会不会伤到她"）：
 *   ① 不回档：线上 memories/ 只被**读**（复制），子进程写的是临时目录；
 *   ② 隔离：子进程 cwd = 临时目录、PORT = 独立端口、跑完 kill + 删目录；
 *   ③ 不产生外部消息：子进程被动接收 HTTP 请求，其主动消息循环只入它自己的队列；
 *   ④ 失败即清：超时/异常都会 kill 子进程并删目录。
 *
 * 强制分支的实现见 aiCoordinator：子进程里 `REPLAY_FORCE_BRANCH` 会替换自状态表达片段
 * （silence = 不给许可；voice = 只说状态；voice_with_cause = 说状态+原因）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type ForcedBranch = 'silence' | 'voice' | 'voice_with_cause';

export const SANDBOX_MAX_CHOICES = 2;
export const SANDBOX_MAX_MESSAGES = 3;

export function sandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_SANDBOX_REPLAY === 'true';
}

/** 子进程用：读取强制分支（父进程/线上不设即 null） */
export function forcedBranch(env: NodeJS.ProcessEnv = process.env): ForcedBranch | null {
  const v = env.REPLAY_FORCE_BRANCH;
  return v === 'silence' || v === 'voice' || v === 'voice_with_cause' ? v : null;
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => (port ? res(port) : rej(new Error('no free port'))));
    });
  });
}

async function waitHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

async function chat(port: number, message: string): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ message, userId: 'sandbox', recentMessages: [] }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = (await r.json()) as { response?: string };
  return String(data?.response ?? '');
}

export interface SandboxReplayResult {
  ok: boolean;
  reason?: string;
  hisMessages: string[];
  runs: Array<{ choice: ForcedBranch; replies: string[]; error?: string }>;
  limitations: string[];
}

/**
 * 用同一句话、不同强制分支各跑一个隔离进程，返回她的真实回复。
 * 注意：**会调用模型**（每个 choice × 每条消息 一次生成），耗时 = 2 × N × 单轮耗时。
 */
export async function runSandboxReplay(input: {
  choices?: ForcedBranch[];
  hisMessages: string[];
  memoriesDir?: string;
  timeoutMs?: number;
}): Promise<SandboxReplayResult> {
  const rawMessages = (input.hisMessages ?? []).map(m => String(m ?? '').trim()).filter(Boolean);
  const hisMessages = rawMessages.slice(0, SANDBOX_MAX_MESSAGES);
  const choices = (input.choices?.length ? input.choices : (['silence', 'voice_with_cause'] as ForcedBranch[]))
    .filter((c): c is ForcedBranch => c === 'silence' || c === 'voice' || c === 'voice_with_cause')
    .slice(0, SANDBOX_MAX_CHOICES);
  const limitations = [
    '沙盒进程独立：不写线上 memories/、不产生外部消息、跑完即删',
    '强制分支只改"自状态表达许可"，其余 Prompt 与线上一致',
    '耗时 = 分支数 × 消息数 × 单轮生成耗时（会真的调模型）',
  ];
  if (hisMessages.length === 0) {
    return { ok: false, reason: 'hisMessages_empty（至少给一句他的话）', hisMessages, runs: [], limitations };
  }
  if (choices.length === 0) {
    return { ok: false, reason: 'choices_invalid', hisMessages, runs: [], limitations };
  }

  const repo = resolve('.');
  const srcMemories = input.memoriesDir ?? join(repo, 'memories');
  const tsxCli = join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(repo, 'server', 'index.ts');
  if (!existsSync(tsxCli) || !existsSync(entry)) {
    return { ok: false, reason: 'sandbox_unavailable（tsx 或 server 入口不存在）', hisMessages, runs: [], limitations };
  }

  const runs: SandboxReplayResult['runs'] = [];
  const timeoutMs = Math.max(20_000, Math.min(300_000, input.timeoutMs ?? 90_000));

  for (const choice of choices) {
    const dir = mkdtempSync(join(tmpdir(), `dsh-sandbox-${choice}-`));
    let child: ChildProcess | null = null;
    try {
      // ① 复制线上记忆到沙盒（读线上、写沙盒）
      if (existsSync(srcMemories)) cpSync(srcMemories, join(dir, 'memories'), { recursive: true });
      // ①.5 子进程 cwd 在沙盒目录 ⇒ 它需要自己的 .env / 配置目录（否则没有模型配置，回复为空）
      for (const name of ['.env', '.env.local']) {
        const p = join(repo, name);
        if (existsSync(p)) cpSync(p, join(dir, name));
      }
      for (const name of ['config', 'personas', 'data']) {
        const p = join(repo, name);
        if (existsSync(p)) cpSync(p, join(dir, name), { recursive: true });
      }
      const port = await freePort();
      // ② 起隔离进程：cwd = 沙盒目录，PORT 独立，强制分支
      const logPath = join(dir, 'sandbox.log');
      const logFd = openSync(logPath, 'a');
      child = spawn(process.execPath, [tsxCli, entry], {
        cwd: dir,
        env: {
          ...process.env,
          PORT: String(port),
          REPLAY_FORCE_BRANCH: choice,
          ENABLE_SANDBOX_REPLAY: 'false',          // 沙盒里不再嵌套沙盒
          DISABLE_PROACTIVE_LOOP: 'true',          // 不让它自己发消息
          ENABLE_JEVDECISION: 'false',
          ENABLE_JEV_DECISION: 'false',
        },
        stdio: ['ignore', logFd, logFd],           // 日志写文件（避免受限环境下管道 EPERM）
        windowsHide: true,
      });
      const up = await waitHealth(port, timeoutMs);
      if (!up) { runs.push({ choice, replies: [], error: 'sandbox_boot_timeout' }); continue; }
      const replies: string[] = [];
      for (const m of hisMessages) replies.push(await chat(port, m));
      const empty = replies.every(r => !r.trim());
      if (empty) {
        let tail = '';
        try {
          const log = readFileSync(logPath, 'utf8');
          tail = log.trim().split('\n').slice(-6).join(' | ').slice(-320);
        } catch { /* ignore */ }
        runs.push({ choice, replies, error: 'empty_reply' + (tail ? `（子进程日志尾：${tail}）` : '') });
      } else {
        runs.push({ choice, replies });
      }
      try { closeSync(logFd); } catch { /* ignore */ }
    } catch (e) {
      runs.push({ choice, replies: [], error: e instanceof Error ? e.message : 'sandbox_error' });
    } finally {
      if (child && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  return { ok: runs.some(r => r.replies.some(x => x.trim().length > 0)), hisMessages, runs, limitations };
}
