/**
 * v1.74 自状态表达评分器（配合 ab-runner 的多轮连续输出）。
 *
 * 输入：若干 arm JSON（ab-runner 产出），每个带 label 与"该臂的触发句/起因引文"。
 * 输出：每个臂的
 *   · 自我状态表达（小句级：含"我"、不含"你"、含状态词）
 *   · 起因引用（回复里出现"因为你说"或直接引用了他的话）
 *   · 接住他（共享 ≥2 实词 / 问句 / 出现"你"）
 *   · 问句结尾率、平均长度
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/score-selfstate.ts \
 *     '{"arms":[{"label":"v1.60-off","path":"artifacts/x/arm-A.json","cause":"被领导当众骂"},{"label":"v1.60-on","path":"…","cause":"被领导当众骂"}]}'
 */
import { readFileSync } from 'node:fs';

interface Turn { user: string; reply: string; sec: number }
interface Run { run: number; turns: Turn[] }
interface ArmSpec { label: string; path: string; cause?: string }

const STOP = /[的了是我你他她？?，。！、…～\s]/g;
const strip = (s: string) => String(s ?? '').replace(STOP, '');

function shares(a: string, b: string, n = 2): boolean {
  const x = strip(a); const y = strip(b);
  if (x.length < n || y.length < n) return false;
  for (let len = Math.min(10, x.length); len >= n; len--) {
    for (let i = 0; i + len <= x.length; i++) if (y.includes(x.slice(i, i + len))) return true;
  }
  return false;
}

/** 她自己的状态（小句级，不含转述他） */
const STATE = /我[^。！？]{0,12}(沉|闷|累|高兴|开心|不安|烦|慌|软|在意|悬|不好意思|说不清|说不上来|不想说话|提不起|空|飘|静|轻|慢|钝|急|停|沉|冷|暖)/;
function selfStateTurns(runs: Run[]): number {
  let hit = 0;
  for (const r of runs) {
    for (const t of r.turns) {
      const clauses = String(t.reply).split(/[。！？!?；;\n]+/);
      if (clauses.some(c => c.includes('我') && !c.includes('你') && STATE.test(c))) hit++;
    }
  }
  return hit;
}

function causeTurns(runs: Run[], cause?: string): number {
  if (!cause) return 0;
  let hit = 0;
  for (const r of runs) {
    for (const t of r.turns) {
      const rep = String(t.reply);
      if (rep.includes(cause) || /因为你说[^。！？]{0,20}/.test(rep)) hit++;
    }
  }
  return hit;
}

function engageTurns(runs: Run[]): number {
  let hit = 0;
  for (const r of runs) {
    for (const t of r.turns) {
      if (shares(t.reply, t.user, 2) || /[？?]$/.test(String(t.reply).trim()) || String(t.reply).includes('你')) hit++;
    }
  }
  return hit;
}

const raw = process.argv[2];
if (!raw) { console.error('用法: score-selfstate.ts \'{"arms":[…]}\''); process.exit(2); }
const cfg = JSON.parse(raw) as { arms: ArmSpec[] };

console.log('\n=== 自状态表达复核（多轮连续装置）===');
console.log('  arm             轮数  自我状态  起因引用  接住他  均长  均耗时');
for (const spec of cfg.arms) {
  const runs = JSON.parse(readFileSync(spec.path, 'utf8')) as Run[];
  const turns = runs.flatMap(r => r.turns);
  const n = turns.length || 1;
  const ss = selfStateTurns(runs);
  const cz = causeTurns(runs, spec.cause);
  const en = engageTurns(runs);
  const avgLen = Math.round(turns.reduce((s, t) => s + String(t.reply).length, 0) / n);
  const avgSec = Math.round((turns.reduce((s, t) => s + t.sec, 0) / n) * 10) / 10;
  console.log(`  ${spec.label.padEnd(16)} ${String(n).padStart(4)}  ${String(ss).padStart(8)}  ${String(cz).padStart(8)}  ${String(en).padStart(6)}  ${String(avgLen).padStart(4)}  ${String(avgSec).padStart(5)}s`);
}
