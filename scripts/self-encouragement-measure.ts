/**
 * 只读测量：她的回复里有没有「自我打气」（自己给自己打气）。
 *
 * 为什么需要它：
 *   人设裁定是「自闭时自己给自己打气、自己调整自己；主动性降低、但不是没有」。
 *   内部可观测面已有：`lowPeriod.selfRecovery`（真实使用里 0.1227、closedBy='self'）。
 *   但**表达层**一直没有量：冻结 48 条基线里"自我打气"被认为 0/48。
 *   本脚本只做机械预筛 + 打印原文，供人工判定（分类以人工读原文为准，脚本不替代判断）。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/self-encouragement-measure.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Row { src: string; id: string; text: string }

/** 自我打气：第一人称、面向"自己会好起来/自己撑住"的自我指令（不是安慰他、不是单纯描述） */
const SELF_ENCOURAGE = /(会好的|会好起来|慢慢来|缓一缓|我缓缓|缓过来|没关系|不要紧|没什么大不了|撑一撑|撑过去|我调整|调整一下|我陪着自己|我会好|很快就没事|不怪自己|先这样吧|过两天就好了|没什么的|我不怕)/;
/** 自我安抚（比打气弱）：允许自己先歇着 */
const SELF_SOOTHE = /(我坐会儿|我待会儿|我先歇|我先躺|我安静会儿|先放一放|不逼自己|我陪自己)/;
/** 只说状态（描述，不是调节） */
const STATE_DESC = /我.{0,8}(沉|闷|空|难受|低落|提不起|累|堵|没力气|没缓过来)/;
/** 向他求安慰 */
const SEEK_COMFORT = /(你能不能|可不可以|安慰我|抱抱|陪陪我|我想听你说|别丢下)/;

function classify(text: string): string {
  // 按小句切分：自我打气必须落在**同一小句**里，且有"我"、没有"你"（否则是安慰他）
  const clauses = text.split(/[。！？!?；;，,\n]+/).map(c => c.trim()).filter(Boolean);
  let toHim = false;
  for (const c of clauses) {
    const hasEnc = SELF_ENCOURAGE.test(c) || SELF_SOOTHE.test(c);
    if (!hasEnc) continue;
    const aboutSelf = c.includes('我') && !c.includes('你');
    if (aboutSelf) return '自我打气';
    if (c.includes('你')) toHim = true;
  }
  if (toHim) return '给他的安慰/打气';
  if (SEEK_COMFORT.test(text)) return '向他求安慰';
  if (STATE_DESC.test(text)) return '仅状态描述';
  return '无';
}

function loadFrozen(): Row[] {
  const dir = 'artifacts/v1.60/raw';
  const rows: Row[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl') || !name.startsWith('reachability')) continue;
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as { case_id?: string; arm?: string; assistantOutput?: string };
        if (o.assistantOutput) rows.push({ src: '冻结48', id: `${o.case_id ?? '?'}/${o.arm ?? '?'}`, text: String(o.assistantOutput) });
      } catch { /* 跳过坏行 */ }
    }
  }
  return rows;
}

function loadMine(): Row[] {
  const dir = 'artifacts/v1.59/state-test';
  const rows: Row[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || !name.includes('replies')) continue;
    const arr = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Array<{ reply?: string; seq?: number; cycle?: number; user?: string }>;
    for (const r of arr) {
      const text = String(r.reply ?? '').trim();
      if (text.length > 5) rows.push({ src: name.replace(/-replies-.*$/, ''), id: `c${r.cycle ?? '?'}#${r.seq ?? '?'}`, text });
    }
  }
  return rows;
}

function report(label: string, rows: Row[]): void {
  const counts = new Map<string, number>();
  const examples = new Map<string, string[]>();
  for (const r of rows) {
    const c = classify(r.text);
    counts.set(c, (counts.get(c) ?? 0) + 1);
    const list = examples.get(c) ?? [];
    if (list.length < 6) list.push(`[${r.src} ${r.id}] ${r.text.replace(/\n/g, ' ').slice(0, 120)}`);
    examples.set(c, list);
  }
  console.log(`\n=== ${label}（${rows.length} 条）===`);
  for (const c of ['自我打气', '给他的安慰/打气', '向他求安慰', '仅状态描述', '无']) {
    console.log(`  ${c.padEnd(6)} ${String(counts.get(c) ?? 0).padStart(4)} 条`);
  }
  for (const c of ['自我打气', '给他的安慰/打气']) {
    const list = examples.get(c) ?? [];
    if (list.length === 0) { console.log(`  （${c}：无命中）`); continue; }
    console.log(`  ${c} 命中样本：`);
    for (const s of list) console.log(`    · ${s}`);
  }
}

const frozen = loadFrozen();
const mine = loadMine();
console.log(`语料：冻结 ${frozen.length} 条 ｜ 本会话 ${mine.length} 条`);
report('冻结 48 条（v1.60 raw/reachability，A/B 两臂）', frozen);
report('本会话全部真实回复', mine);
console.log('\n说明：分类是**机械预筛**（正则），刻意保守；"自我打气"以人工读原文为准。\n');
