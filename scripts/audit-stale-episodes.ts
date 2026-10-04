// 存量情景记忆审计（只读，dry-run）—— 哪些"她记下的情绪"与他那句话明显不符？
//
// 背景：41 条存量记忆的 `dominantEmotion` 与 `narrativeFragment` 是**在 v1.13/v1.20 修好之前**
// 由「绝对值 argmax（calm 基调 0.8 通吃）」套模板生成的，而叙事会经
// 【相关记忆】/【主动回忆】注入 Prompt —— 她会把"生日的邀请让我厌恶"当回忆说给他听。
//
// ── 判据（两把**互相独立**的文本尺子，都不用情绪引擎状态）───────────────────
//   ① `SIGNIFICANT_PATTERNS` 正则标签（存下来的 `tags`）—— 只认 10 类词
//   ② 本地词典 NLU `analyzeUserSentiment()` —— 只认固定关键词表
// 两把尺子都窄，所以**"没抓到"不等于"没有情绪"**。因此每条都标注**证据强度**：
//   · 强 = 至少一把尺子**明确读出了**与他/她相反的方向
//   · 弱 = 只有"另一把尺子沉默"这一条依据 → **必须人工看**，脚本不下结论
// 脚本**不推断她当时真实的情绪**（存量没有九情向量，反推不出来的一律不编）。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/audit-stale-episodes.ts
//   本脚本**只读**：没有任何写文件分支。
import { readFileSync } from 'node:fs';
import { analyzeUserSentiment } from '../src/lib/emotionNLU.js';

const FILE = 'memories/episodic_memory.json';

interface Impact { valenceBefore: number; valenceAfter: number; valenceDelta: number; arousalPeak: number; dominantEmotion: string }
interface Episode {
  id: string; timestamp: number; roundNumber: number; eventSummary: string;
  emotionalImpact: Impact; narrativeFragment: string; recallWeight: number; tags?: string[];
}

/** 他这句话本身携带的**负向**信号（正则标签，由消息文本决定） */
const NEG_TAGS = ['悲伤', '冲突', '脆弱'];
/** 他这句话本身是**正向**信号 */
const POS_TAGS = ['温暖', '亲密', '首次', '承诺'];
/** 既非正也非负的"位次标签"：只说明正则没抓到别的，**不能**当作"中性"的证据 */
const NEUTRAL_TAGS = ['日常', '回忆'];
/** 她记下的负向情绪 */
const NEG_EMOTIONS = ['disgust', 'sad', 'anger', 'fear'];
/** 她记下的"静好"情绪 */
const SERENE_EMOTIONS = ['calm', 'resting', 'love', 'joy'];
const EMOTION_KEYS = ['joy', 'sad', 'anger', 'fear', 'love', 'calm', 'disgust', 'lust', 'greed'];
const NLU_NEG = ['sad', 'fear', 'anger', 'disgust'];
const NLU_POS = ['joy', 'love', 'gratitude'];

const inter = (a: string[], b: string[]) => a.filter(x => b.includes(x));
const txtTags = (tags: string[]) => tags.filter(t => !EMOTION_KEYS.includes(t));

interface Row {
  ep: Episode; label: string; narr: string; txt: string[]; rawKeys: string[];
  nlu: string; nluI: number; verdict: string; evidence: '强' | '弱'; action: string; note?: string;
}

const raw = JSON.parse(readFileSync(FILE, 'utf8'));
const key = Array.isArray(raw) ? null : Object.keys(raw).find(k => Array.isArray(raw[k]));
const episodes: Episode[] = Array.isArray(raw) ? raw : raw[key!];

const rows: Row[] = [];
const handled: Episode[] = [];

for (const ep of episodes) {
  const tags = ep.tags ?? [];
  const label = ep.emotionalImpact?.dominantEmotion ?? '?';
  const narr = ep.narrativeFragment ?? '';
  const vd = ep.emotionalImpact?.valenceDelta ?? 0;
  if (tags.includes('narrativeStale') || narr.length === 0) { handled.push(ep); continue; }

  const txt = txtTags(tags);
  const rawKeys = inter(tags, EMOTION_KEYS);           // 存了裸情绪键 ⇒ 旧标签兜底（argmax）留下的
  const nluRes = analyzeUserSentiment(ep.eventSummary);
  const nlu = nluRes.expressedEmotion;
  const nluI = nluRes.intensity;

  const negEvidence = [...inter(txt, NEG_TAGS), ...(NLU_NEG.includes(nlu) ? [`NLU:${nlu}`] : [])];
  const posEvidence = [...inter(txt, POS_TAGS), ...(NLU_POS.includes(nlu) ? [`NLU:${nlu}`] : [])];

  let verdict = ''; let evidence: '强' | '弱' = '弱'; let action = ''; let note: string | undefined;

  // A. 他说的是负面的事，她却记成静好 → 叙事与事实相反
  if (SERENE_EMOTIONS.includes(label) && negEvidence.length > 0 && vd < 0) {
    verdict = `负事记成静好（${negEvidence.join('/')} vs ${label}）`;
    evidence = '强';
    action = '叙事与事实相反 → 建议清空叙事并标 narrativeStale';
  }
  // B. 他说的是正向的事，她却被记成负向 → 说出口会伤人
  else if (NEG_EMOTIONS.includes(label) && posEvidence.length > 0) {
    verdict = `正向事记成负向（${posEvidence.join('/')} vs ${label}）`;
    evidence = '强';
    action = '被说出会伤人 → 建议清空叙事并标 narrativeStale';
  }
  // C. 静好情绪 + 一点情绪词都没有 → 多半是"静息被写成 calm"，方向不算错
  else if (SERENE_EMOTIONS.includes(label) && negEvidence.length === 0 && posEvidence.length === 0
    && txt.length === 0 && nlu === 'neutral') {
    verdict = `静息被写成 ${label}（两把尺子都读作中性）`;
    evidence = '强';
    action = '方向不算错，但叙事在 claim 她没经历过的"满足/幸福" → 可保留可清空';
  }
  // D. 上面都不成立，但她记的是负向情绪，而两把尺子都没读到负向 → 弱证据，交人看
  else if (NEG_EMOTIONS.includes(label) && negEvidence.length === 0) {
    verdict = `记成 ${label}，但两把尺子都没读出负向（正则标签 [${txt.join(',') || '无'}]${rawKeys.length ? `，裸键 [${rawKeys.join(',')}]` : ''}；NLU ${nlu} ${nluI}）`;
    evidence = '弱';
    action = '需人工判：他这句话到底是不是负面的？';
  }

  if (!verdict) continue;

  // 已知的设计性来源：自我暴露锚点**故意**映射成 sad（ANCHOR_NARRATIVE_EMOTIONS）
  if (label === 'sad' && txt.includes('坦诚')) {
    note = '注意：代码里 `self_disclosure → sad` 是**故意的**锚点映射，所以这条 sad 不是 argmax 的锅，是那条映射本身可疑';
  }

  rows.push({ ep, label, narr, txt, rawKeys, nlu, nluI, verdict, evidence, action, note });
}

const strong = rows.filter(r => r.evidence === '强');
const weak = rows.filter(r => r.evidence === '弱');

const show = (r: Row) => {
  const e = r.ep;
  console.log(`  ${e.id}  第${e.roundNumber}轮  权重 ${(e.recallWeight ?? 0).toFixed(3)}`);
  console.log(`      他说：「${e.eventSummary}」`);
  console.log(`      标签 ${r.label}（Δ${(e.emotionalImpact.valenceDelta ?? 0).toFixed(3)}）  正则标签 [${r.txt.join(',') || '无'}]${r.rawKeys.length ? `  旧裸键 [${r.rawKeys.join(',')}]` : ''}  NLU ${r.nlu}/${r.nluI}`);
  console.log(`      她记下：${r.narr}`);
  console.log(`      判定：${r.verdict}`);
  if (r.note) console.log(`      ⚠️ ${r.note}`);
  console.log(`      建议：${r.action}\n`);
};

console.log(`读入 ${episodes.length} 条情景记忆\n`);
console.log('═'.repeat(80));
console.log(`〔〇〕叙事已清空（上一轮 P0 处理，不再计入）：${handled.length} 条`);
for (const e of handled) console.log(`  ${e.id}  第${e.roundNumber}轮  ${e.eventSummary.slice(0, 32)}`);
console.log('═'.repeat(80));

console.log(`\n〔一〕证据**强**：${strong.length} 条（至少一把尺子明确读出了相反方向）\n`);
strong.forEach(show);

console.log('═'.repeat(80));
console.log(`\n〔二〕证据**弱**：${weak.length} 条（只是"两把尺子都没读到"，脚本不下结论，请你判）\n`);
weak.forEach(show);

console.log('═'.repeat(80));
console.log('\n── 汇总 ──');
console.log(`可疑 ${rows.length} / ${episodes.length}（另 ${handled.length} 条叙事已清空）`);
console.log(`  证据强 ${strong.length} 条 / 证据弱 ${weak.length} 条`);
console.log(`  建议动作：清空叙事 ${strong.filter(r => r.action.includes('清空叙事并标')).length} 条；可保留可清空 ${strong.filter(r => r.action.includes('可保留')).length} 条；待人工判 ${weak.length} 条`);

const proactive = episodes.filter(e => (e.recallWeight ?? 0) >= 0.35).length;
const maxW = Math.max(...episodes.map(e => e.recallWeight ?? 0));
console.log(`\n主动回忆门槛（recallWeight ≥ 0.35）：当前 ${proactive} 条够得着（全场最高 ${maxW.toFixed(3)}）`);
console.log('但【相关记忆】注入**不设权重门槛**（只看 top-cap 与情感一致性排序），所以这些叙事仍可能被说出。');

console.log('\n本脚本只读：没有 --apply，也没有任何写文件分支。');
