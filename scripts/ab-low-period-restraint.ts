// ── v1.42 A/B：她自己在低谷时，他说的是**平常事** —— 该不该少追问 ──
//
// 这是 v1.39 的**同题重做、换杠杆**，所以两跑的样本刻意用同三条话，可直接比：
//   v1.39 把「少追问」做在**动机层**（她沉时整块不给"关于他的待办"）⇒ 真管道结果是**反的**
//     （追问 +0.33、字数 +15.5）。机制：让位改的是"问什么"不是"问不问"，
//     而且拿掉的那块本身带着一条收窄指令（"问这件事的具体下文，不要泛泛的关心"）。
//   本跑把变量放回**策略片段**（本项目真正推得动行为的杠杆一直在内容块：v1.29/v1.30）。
//
// 变量只有一个：**同一批"他的平常事" + 同一个"她心里挂着的那件事"**下，
//   A = 基线（开关关）：该策略的**原始**片段。
//   B = 平常事片段（`ENABLE_LOW_PERIOD_RESTRAINT=true`）：她**已成段**在低谷、而他说的是平常事
//       ⇒ 换成"这一轮不要求你推进对话、不必为了话不冷而抛问题"（白名单只收 neutral / explore）。
//
// 为什么必须挑"他情绪不强"的话（否则又是一个没有下降空间的假终点）：
//   他**明确负面** + 她沉时，条路本来是 `empathize`/`accompany`，那两块片段里本来就不追问；
//   而 v1.31 刚把"他明确负面时的承认"从 0.13 提到 0.81，绝不能被这条改动碰到
//   ⇒ 片段只在「他这句话既不是好事、也不是负向键」（归一后 neutral）时才换（见单测）。
//
// ── 事先声明的判据（跑之前写死；**第三跑把那条坏护栏换掉了**，理由见下面 v1.45 段）──
//   主终点 `questions`（她这轮回复里的**问号个数**）：必须**下降** ——
//          均值差 < 0 且配对符号检验双侧 p ≤ 0.10（与 v1.39 同一把尺子，两跑可直接比）。
//   次终点 `probe`（追问句式计数）均值差 < 0（方向必须与主终点一致：
//          不允许"一种追问降了、另一种涨了"来充数）。
//   记录但**不当判据** `asked`（二值"这轮到底问了没有"）+ McNemar —— 降级理由见【第一跑记录】②。
//   不退化底线（任一破了就算输，与主终点是否达标无关）：
//     · `ack`（承认/接住他说的）均值差 ≥ 0
//     · `presencePhrase`（在场感）均值差 ≥ 0        ← v1.38 就是栽在这条（3→0）
//     · `echo`（回复有没有落在他那句话的**具体内容**上）均值差 ≥ 0
//     · `chars` 均值 ≥ A 臂的 70%                   ← 防"短到像敷衍"
//     · **① 复读她上一次那句话**（与她上一句的相似度）B ≤ A + 0.05 **且** 被 v1.32 查重
//       拦下的条数 B ≤ A                              ← **替换**了原来那条二值"逐字重复组数"
//     · **② 跨上下文开场复用**：B 的最多一种开场占比 ≤ max(0.2, A×1.5)  ← 新增（生产相关的另一面）
//   对照   静息（不在低谷）同一批话 ⇒ 两臂的**策略块**必须逐字节相同
//          （证明变量只有一个：不是"这些话不该问"，而是"她在低谷时才不问"）
//   操纵   低谷条件：A 臂策略块 = 该策略的**原始**片段；B 臂 = 平常事片段
//          ⭐ 且 B 臂必须覆盖**至少一半**样本 —— 否则这条改动根本没作用到样本上，读数无意义
//
// ── 【第一跑记录】（2026-09，--n=3，结果**作废重跑**；artifact 留在 …-rows-pass1.jsonl）──
//   ① **量具坏了：限流把 60 个格子里的 30 个静默丢掉。** `/api/chat` 是 **30 次/分钟**
//      （`server.ts` 的速率桶），我这条真管道连打 ⇒ 第 31 个格子起全部返回
//      `{"error":"Too many requests"}`（没有 `response` 字段），harness 当时把它们当"跳过"，
//      于是 n 从声明的 15 掉到 10，**而报告里照旧写 n=15**。已修：`postChat` 对 429 做指数退避重试，
//      重试用尽就**抛错中断整跑** —— 宁可不跑，也不要一个悄悄变小的 n。
//      （`ab-laya-strategy.ts` 早就踩过这个坑并写下了修法，我没照抄，这是我的失误。）
//   ② **主终点 `asked` 结构性没有余量。** 这是二值化"这轮问了没有"：预演里 A 8/8 都问、
//      B 6/8 也问 ⇒ 不一致对**上限**只有 2/8，**即使效果完美也够不到 p ≤ 0.10**。
//      第一跑实测不一致对只有 2/10（A 问 10/10、B 问 8/10）⇒ McNemar p=0.500。
//      也就是说：这个终点在**跑之前**就已经注定报"未达标"，而我在预演数据里没看出来。
//      ⇒ 改用**计数型** `questions`（= v1.39 的 `probe` 同型），它在预演里就是有信号的量。
//      （同 v1.37 的教训：一个**没有余量**的终点，测了也说明不了任何事。）
//   ③ 第一跑剩下的可用数字（仅 10 对、且主终点已换，**只当参考，不作裁定**）：
//      `questions` A 1.40±0.52 / B 0.80±0.42，符号检验 **6:0 p=0.031**。
//      ⇒ 第二跑是**独立重测**（同样的判据、修好的量具、n=3 完整 15 对），不是挑好看的重跑。
//
// ── 【第二跑记录】（--n=3 完整 15 对，artifact → …-rows-pass2.jsonl）──
//   主终点 **1.47 → 0.80，符号检验 9:0 p=0.004 ✓**；次终点 probe −0.33 ✓；
//   `echo` +0.13、`chars` 81.6%（≥70%）✓、`ack`/`presencePhrase` 两臂都 0（**没有余量**，
//   见【预演记录】① —— 他说的是平常事，本来就没东西可承认，"没掉"不构成证据）。
//   **但二值护栏"逐字重复组数 B ≤ A"破了（A 0 组 / B 3 组）⇒ 判未达标、默认关。**
//
// ── 【v1.45：那条护栏本身是坏的量具 —— 三次判"塌缩"都栽在它上面】──
//   建 `src/lib/replyDiversity.ts`（连续量）+ `scripts/measure-reply-diversity.ts`（**零 LLM 调用**，
//   拿历史 artifact 离线重打分）。结果：
//
//   | v1.42 第二跑（每组 3 条） | A | B |
//   |---|---|---|
//   | 同输入两两相似度均值 | **0.47** | **0.54** |
//   | 同输入逐字相同对 | 1 对 | 3 对 |
//   | 按时间（对她上一条） | 0.02 | 0.01 |
//   | 跨上下文开场：不同种数 / 最多占比 | 12/15，20% | 11/15，20% |
//
//   ⇒ ① **A 臂同一输入本来就"中等同形"（0.47）**，二值尺子把这件事整个隐藏了，
//      于是 0 组 → 3 组看起来像断崖，连续量上只是 0.47 → 0.54；
//   ⇒ ② 两把**生产相关**的尺子（对她上一条 / 跨上下文开场）**两臂基本没差**；
//   ⇒ ③ "开场复用 ×9"那件事查清了：**是我在每个格子种了同一句动机内容**、而动机块本来
//      就是给她直接引用的 ⇒ 装置产物（生产里动机池是变的）。
//   ⇒ 所以"复读机"在生产相关的口径上**量不出问题**；被它连着判掉的三个改动，
//      共用的是同一把**被混淆的尺子**。第一/二跑都没有"复读她上一次那句话"这一项。
//   第三跑：样本不变（n=3，15 对），**只换护栏**（换成上面那两条生产相关的），
//   并给每条话加一句"她上次就这个话题说过的话"（两臂逐字相同）当复读的靶子。
//
// ── 【第三跑记录】（--n=3 完整 15 对，artifact → …-rows-pass3.jsonl）──
//   主终点 **1.20 → 0.33，符号检验 10:0 p=0.002 ✓**（比第二跑更强）；
//   复读两把尺子**干干净净**（对她上一句 0.12/0.12、会被 v1.32 查重拦下 **0/15**；开场复用 20%/20%）
//   —— 也就是说"模板塌缩"那件事在生产口径上根本不存在（见 v1.45）。
//   **但 `echo`（落在他那件具体的事上）0.93 → 0.40（8:0 p=0.008）、`presencePhrase` 0.13 → 0 ⟹ 未达标。**
//   原文机制：**"少问"被她兑现成了"泛泛的安慰"** ——
//     A(1问) 嗯，我记着呢。是常规体检还是哪里不舒服去查的？
//     B(0问) 嗯，我记着呢。这几天要是心里发紧，就跟我说说，别一个人扛着。
//     B(0问) 嗯，去就去吧。你心里有数就行。      ← 这句放在谁身上都成立，p2/p3 还逐字重复
//   根因（是我片段自己的错，不是模型）：① `接住他的话、让他知道你在，就够了` 把"让他知道你在"
//   写成了**目标** ⇒ 泛泛的安慰就能满足它；② `就那件事说一句…不问也可以` 把"落在他那件事上"
//   写成了**许可** ⇒ 许可永远输给最省力的动作。
//
// ── 【第四跑】（本次）：**判据一个字不改**，只换片段文字（v1.46）──
//   改两处：把"落在他那件具体的事上"从**许可**改成**要求**（先把他那件事里最具体的一点
//   用她自己的话点出来），并撤掉"让他知道你在，就够了"那句许可；"冷淡的反面"从"安慰"
//   改指回"看着他这件事"。
//   ⇒ 这是**单变量**改动（片段文字），样本、判据、对照、操纵检查全部与第三跑相同，
//     所以两跑可直接比；`echo` 是这次的主看点（它要回到 A 的水平，而不是继续掉）。
//
// ── 【第四跑记录】（--n=3 完整 15 对，artifact → …-rows-pass4.jsonl）——**反过来了** ──
//   改法：把"落在他那件具体的事上"从许可改成要求（先点出那件事里最具体的一点），
//         并撤掉"让他知道你在，就够了"那句许可。
//   结果：`echo` **0.40 → 0.73**（回到 A 的水平附近），**但**主终点 `questions` **0.33 → 0.93**
//         （B胜0 A胜4 p=0.125 ⇒ 未达标）、`chars` 29.3/44.1 = **66% < 70%**、
//         `repeatSim` **0.06 → 0.19（14:1 p=0.001）**。
//   机制（读原文 + 追到具体那条）：**我在片段里写了"真要问，就落在那件事上"** ——
//     那等于**把问句的门又打开了**：模型用"问他一个关于那件事的问题"来满足"点出那件事"。
//     最刺眼的一条（h2/B4）：「嗯，周末那趟。是办事还是想出去走走？」——
//     `是办事还是想出去走走` **是她上一次那句的原话**（我种的 prevReply 里就有）
//     ⇒ 这就是 `repeatSim` 为什么从 0.06 跳到 0.19（`repeatHit` 仍是 0/15，够不到 0.7）。
//   另两条细节：B 的字数三跑都稳定在 **29~30 字**，是 **A 臂越写越长**（31.5 → 38.3 → 44.1）
//     把"70%"那条**相对**底线顶破的（第三跑 78.8% ✓ / 第四跑 66.4% ✗）——
//     这条判据是相对量，它动了也算破。
//
// ── 【第五跑】（本次，**这条杠杆的最后一轮**）：仍然只换片段文字 ──
//   精确改一处：把第四跑那句"真要问，就落在那件事上"**删掉**，换成
//   「也不必用一个问句来把你那句话说完整——这一轮不问他下文」。
//   判据、样本、对照、操纵检查**全部与第三/第四跑逐字相同**，所以三跑可直接比。
//   预期（事先写明，好让它可被证伪）：`questions` 应回到第三跑的水平（↓），
//   而 `echo` 应保持第四跑的水平（↑）—— 也就是**两件都要**。
//   ⚠️ 若这一轮仍只有一边成立，则结论是**这条杠杆在本管道里做不到"少问且接住"**，
//      杠杆结案（届时把结构原因写清：`open_loop` 动机块本身就是"问下文"的形状，
//      策略片段关不掉它 —— 见 docs 的 v1.46 节）。
//
// 用法：
//   node node_modules/tsx/dist/cli.mjs scripts/ab-low-period-restraint.ts --dry     # 预演（挑话）
//   node node_modules/tsx/dist/cli.mjs scripts/ab-low-period-restraint.ts [--n=3] [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { lowPeriodOf } from '../src/lib/lowPeriod.js';
import { STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';
import type { StrategyType } from '../src/lib/dialogueStrategy.js';
import { textSimilarity } from '../src/lib/memoryEnhancer.js';
import { normalizeForCompare, sameInputDiversity, openerReuse } from '../src/lib/replyDiversity.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const arg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const N = Math.max(2, arg('n', 3));
const KEEP = process.argv.includes('--keep');
const DRY = process.argv.includes('--dry');

/**
 * 候选"他的平常事"（都不是明确负面 ⇒ 旧让位路不会抢跑、也不会走 empathize/accompany），
 * 每条都配两样东西：
 *   · `seed` —— "她心里挂着的、与它对应的"事（那才是 A 臂会追问的东西）
 *   · `prevReply` —— **她上一次就这个话题说过的一句**（第三跑新加）。用来量**生产里真会发生**的那件事：
 *     他今天又把同一件事说了一遍，她会不会**把上次那句再说一遍**。
 *     v1.32 的生成后查重（`findDuplicateReply`，阈值 0.7）治的就是这个；两臂拿到的是**同一句**上次，
 *     所以这是公平对照。第一/二跑没有这一项 ⇒ 那两跑只能量到"同输入复现"。
 */
const POOL = [
  { id: 'h1', text: '我下周三要去医院拿体检报告。', seed: '他体检结果到底怎么样',
    prevReply: '下周三拿报告啊。那这几天你先别自己吓自己，等看了结果再说。' },
  { id: 'h2', text: '我周末可能要去趟外地。', seed: '他周末去外地那事定了没',
    prevReply: '要去外地啊？是办事还是想出去走走，你自己心里有数吗。' },
  { id: 'h3', text: '我最近一直在想要不要换个方向。', seed: '他说想换方向那事，后来怎么定的',
    prevReply: '换方向这事你想了挺久了吧。是越来越清楚，还是越想越乱？' },
  { id: 'h4', text: '我公司楼下新开了一家面馆，中午去试了下。', seed: '他说要去试的那家面馆到底怎么样',
    prevReply: '你说要去试的那家面馆，试了吗？值不值得再去第二回。' },
  { id: 'h5', text: '我们部门下个月要搬去新办公楼。', seed: '他部门搬办公楼那事安排得怎么样了',
    prevReply: '要搬新办公楼啦。离你现在住的地方远不远？' },
  { id: 'h6', text: '我今天把那个一直没装的柜子装好了。', seed: '他说要装的那个柜子装上没',
    prevReply: '那个柜子总算装上了？拖了挺久的，装完感觉怎么样。' },
  { id: 'h7', text: '我上个月报的那个线上课，明天开课。', seed: '他报的那个课到底是什么内容',
    prevReply: '明天就开课了。你报的时候最想学的是哪一块？' },
  { id: 'h8', text: '我昨天晚上去楼下的理发店剪了个头发。', seed: '他剪头发那事最后剪成什么样了',
    prevReply: '剪头发啦。剪成什么样了，你自己满意吗？' },
];

/** 预演（--dry）后按**实测**挑出的话；证据见文件末尾【预演记录】 */
const CHOSEN = ['h1', 'h2', 'h3', 'h4', 'h5'];
const MSGS = POOL.filter(m => (DRY ? true : CHOSEN.includes(m.id)));

const MEM = 'memories';
const BAK = 'memories.ab-lr-bak';
const DUMP = '.tmp-ab-lr-prompt.txt';
const ROWS = 'low-period-restraint-rows.jsonl';

/** 每一格的"最近对话"：最后一句 = 她上一次就这个话题说过的话（两臂逐字相同） */
const recentFor = (m: typeof POOL[number]) => [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
  { role: 'user', content: '还行，就是有点忙。' },
  { role: 'assistant', content: m.prevReply },
];

type Arm = 'A' | 'B';
function applyArm(arm: Arm) {
  if (arm === 'B') process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
  else delete process.env.ENABLE_LOW_PERIOD_RESTRAINT;
}

const RE = {
  questions: /[？?]/g,
  probe: /为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办|还是|怎么样|哪[个家]|什么时候|有没有|多久|去了吗|行不行/g,
  ack: /挺好|真不错|恭喜|替你高兴|值得|不容易|辛苦了|嗯嗯|我懂|知道了|听到了|真好|记得|会好的/g,
  presencePhrase: /我就?在|陪着你|我陪|不走|不用一个人|在这儿|在呢/g,
  advice: /别急|原因|其实|说明|应该|至少|会好起来|没关系|想开/g,
};

/** 虚词/代词：算"她有没有落在他那句话的具体内容上"时要排除，否则人称词就能刷分 */
const STOP = new Set(['我', '你', '的', '了', '是', '在', '和', '有', '就', '都', '也', '很', '要', '会',
  '去', '个', '这', '那', '一', '下', '吗', '呢', '吧', '啊', '嗯', '过', '把', '被', '给', '对', '到',
  '说', '想', '还', '没', '不', '他', '她', '它', '们', '之', '与', '着', '得', '地', '上', '里', '中']);

/**
 * 回复里最长的一段"与他那句话逐字重合的内容词"（≥2 字，且不是纯虚词）。
 * 这是**结构量**，与我这轮写的新片面文字无关 ⇒ 不会出现 v1.38 那种"量具就是我的词表"的自证。
 */
function longestEcho(reply: string, hisText: string): number {
  const content = (s: string) => [...s].filter(c => /[\u4e00-\u9fffA-Za-z0-9]/.test(c));
  const A = content(reply), B = content(hisText).join('');
  let best = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 2; j <= A.length; j++) {
      const sub = A.slice(i, j);
      if (sub.every(c => STOP.has(c))) continue;
      if (B.includes(sub.join(''))) best = Math.max(best, sub.length);
    }
  }
  return best;
}

function score(reply: string, hisText: string, prevReply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  const questions = count(RE.questions);
  const repeatSim = textSimilarity(normalizeForCompare(reply), normalizeForCompare(prevReply));
  return {
    chars: [...reply].length,
    questions,
    asked: questions > 0 ? 1 : 0,
    probe: count(RE.probe),
    ack: count(RE.ack),
    presencePhrase: count(RE.presencePhrase),
    advice: count(RE.advice),
    echo: longestEcho(reply, hisText) >= 2 ? 1 : 0,
    /** 与她**上一次那句话**的相似度（v1.32 查重的口径）—— 生产里真会发生的那件事 */
    repeatSim: Math.round(repeatSim * 1000) / 1000,
    /** 是否会被 v1.32 的生成后查重拦下（阈值 0.7） */
    repeatHit: repeatSim >= 0.7 ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['questions', 'asked', 'probe', 'chars', 'ack', 'presencePhrase', 'echo', 'repeatSim', 'repeatHit', 'advice'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
const C = (a: number, b: number) => fact(a) / (fact(b) * fact(a - b));
/** 配对符号检验（双侧精确） */
function signTest(diffs: number[]) {
  const win = diffs.filter(d => d > 0).length, lose = diffs.filter(d => d < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  let tail = 0;
  for (let k = Math.max(win, lose); k <= n; k++) tail += C(n, k);
  return { win, lose, p: Math.min(1, (2 * tail) / 2 ** n) };
}
/** McNemar 精确检验（二值配对；只用不一致对） */
function mcnemar(pairs: Array<[number, number]>) {
  const b = pairs.filter(([a, x]) => a === 1 && x === 0).length;   // A 问了、B 没问
  const c = pairs.filter(([a, x]) => a === 0 && x === 1).length;   // A 没问、B 问了
  const n = b + c;
  if (n === 0) return { b, c, n, p: 1 };
  let tail = 0;
  for (let k = 0; k <= Math.min(b, c); k++) tail += C(n, k);
  return { b, c, n, p: Math.min(1, (2 * tail) / 2 ** n) };
}
const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

/** 策略块的提取：`【当前策略：…` 到下一个块头（`\n【`）或 Prompt 末尾 */
const STRAT_MARKER = '【当前策略：';
const RESTRAINT_HEADER = '【当前策略：你自己这几天在低谷，他说的是平常事】';
function strategyBlockOf(prompt: string): string {
  const i = prompt.indexOf(STRAT_MARKER);
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}
/** 片段头 → 策略键（从片段表本身反查，不手抄一份映射） */
const HEADER_TO_KEY: Record<string, StrategyType> = {};
for (const [k, v] of Object.entries(STRATEGY_PROMPT_SNIPPETS)) {
  const m = (v as string).match(/^【当前策略：(.+?)】/);
  if (m) HEADER_TO_KEY[m[1]] = k as StrategyType;
}
const strategyNameOf = (block: string) => (block.match(/^【当前策略：(.+?)】/) ?? [, ''])[1] as string;

interface Row {
  arm: Arm; cond: 'treat' | 'ctl'; id: string; pair: number;
  metrics: Metrics; reply: string;
  strategyName: string; strategyKey: StrategyType | null;
  isRestraint: boolean; baseMatches: boolean;
  /** 策略块原文 —— 对照检查比这一块，不比整个 Prompt（整份会随状态/时间/NLU 变，是量具错） */
  strategyBlock: string;
  lpEstablished: boolean;
}
const rows: Row[] = [];

function restore() {
  if (KEEP) { console.log(`\n[保留] --keep：${BAK}/ 未还原（看完请手动删）`); return; }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

{
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑（会同时写 memories/）—— 先停掉它。'); process.exit(3); }
}
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });
writeFileSync(DUMP, '', 'utf8');
process.env.DUMP_PROMPT = DUMP;
writeFileSync(ROWS, '', 'utf8');

let listener: { close: () => void } | null = null;
try {
  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  listener = srv.app.listen(0, '127.0.0.1');
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}（不与 3000 冲突）`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
    internal?: Record<string, unknown>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;

  /** 造一个起始状态：可选地把她沉下去 + 钉住一段低谷 + 钉住"她心里挂着的那件事" */
  const makeState = (opts: { sunk: boolean; low: boolean; seed: string }) => {
    const s = structuredClone(real) as typeof real & { lowPeriod?: Record<string, unknown> };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + (opts.sunk ? 0.20 : 0) };
    s.baselineEmotions = { ...baseline };
    if (opts.low) {
      const now = Date.now();
      s.lowPeriod = {
        since: now - 30 * 3_600_000, lastEvaluatedAt: now,
        peakDepth: 0.25, lastDepth: 0.20, lastDelta: 0, turns: 6, selfRecovery: 0,
      };
    } else {
      delete s.lowPeriod;
    }
    // 钉住"她心里挂着的那件关于他的事" ⇒ 保证 A 臂**有东西可追问**（否则又是没有下降空间）
    s.internal = {
      ...(s.internal ?? {}),
      motive: {
        pool: [{
          id: `seed-${opts.seed}`, kind: 'open_loop', content: opts.seed, source: {},
          salience: 0.8, formedAt: Date.now() - 3_600_000, expiresAt: Date.now() + 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  /**
   * 发一轮对话。**限流必须重试，不能当成失败样本**（`/api/chat` 是 **30 次/分钟**，见 server.ts 的
   * 速率桶）：第一跑第 31 个格子起全被 `{"error":"Too many requests"}` 挡掉，
   * 于是 60 个格子里 30 个**静默消失**、n 从 15 掉到 10 —— 那种情况下这一轮根本**没发生过**，
   * 重发不是"重试一个样本"。重试不改样本身份（同一句、同一臂、同一 pair）。
   * 重试用尽就**抛错中断整跑**：宁可不跑，也不要一个悄悄变小的 n。
   */
  async function postChat(url: string, payload: unknown, tries = 6): Promise<{ response?: unknown }> {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      const rateLimited = res.status === 429 || /too many requests|rate limit/i.test(err);
      if (!rateLimited || i === tries) {
        console.error(`[中断] /api/chat 没有返回 response（第 ${i} 次，HTTP ${res.status}）：`
          + `${JSON.stringify(data).slice(0, 200)}`);
        throw new Error('chat 调用失败（见上）—— 不许静默缩小样本');
      }
      console.warn(`   ⏳ 触发限流（${err}），等 ${Math.round(wait / 1000)}s 后重发（第 ${i}/${tries} 次）`);
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  async function callOnce(arm: Arm, cond: 'treat' | 'ctl', m: typeof POOL[number], pair: number): Promise<Row | null> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState({ sunk: cond === 'treat', low: cond === 'treat', seed: m.seed })) as never;
    const c = aiCoordinator as unknown as Record<string, unknown>;
    c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat(url, {
      message: m.text, userId: 'ab-lr', recentMessages: recentFor(m),
    });
    if (typeof data.response !== 'string') {
      console.error(`   ✗ ${m.id}/${arm}/${cond} 没返回 response —— 中断整跑（不许静默缩小 n）`);
      throw new Error('no response');
    }
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = strategyBlockOf(prompt);
    const name = strategyNameOf(block);
    const key = HEADER_TO_KEY[name] ?? null;
    let lpEstablished = false;
    try {
      const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
      const lp = st.lowPeriod as never as { established?: boolean } | undefined;
      lpEstablished = Boolean(lp?.established);
    } catch { /* 记录失败不影响主流程 */ }
    const metrics = score(data.response, m.text, m.prevReply);
    const row: Row = {
      arm, cond, id: m.id, pair, metrics, reply: data.response,
      strategyName: name, strategyKey: key,
      isRestraint: block.startsWith(RESTRAINT_HEADER),
      baseMatches: key !== null && block === STRATEGY_PROMPT_SNIPPETS[key],
      strategyBlock: block, lpEstablished,
    };
    console.log(`   [${arm}/${cond}] ${pad(m.id, 3)} p${pair} ${pad(name || '?', 10)}`
      + `${row.isRestraint ? '→平常事片段' : row.baseMatches ? '（原片段）' : '（非原片段！）'}`
      + ` ${String(metrics.chars).padStart(3)}字 问号${metrics.questions} 追问${metrics.probe}`
      + ` 承认${metrics.ack} 在场${metrics.presencePhrase} echo${metrics.echo} 低谷${lpEstablished ? 'Y' : 'n'}`);
    return row;
  }

  const seedState = makeState({ sunk: true, low: true, seed: 'x' });
  console.log(`[她的起始状态-低谷] ${activationOf(seedState as never).note}`);
  console.log(`[钉住的低谷] ${lowPeriodOf(seedState as never).note}`);

  if (DRY) {
    // ── 预演：只为挑话（开关打开，逐条看策略块有没有真换成"平常事片段"）──
    console.log(`\n[预演] 候选 ${POOL.length} 条 × 2 臂（低谷，开关开）—— 要挑的是`
      + `「B 臂真换成平常事片段、且 A 臂确实会问」的那些\n`);
    const keep: string[] = [];
    for (const m of POOL) {
      const a = await callOnce('A', 'treat', m, 0);
      const b = await callOnce('B', 'treat', m, 0);
      const ok = Boolean(a && b && b.isRestraint && a.baseMatches && a.metrics.questions > 0);
      if (ok) keep.push(m.id);
      console.log(`   ⇒ ${m.id} 可用=${ok ? 'Y' : 'n'}`
        + `${ok ? '' : '（原因：' + (!b?.isRestraint ? 'B 臂没换成平常事片段（他不是"平常事"或策略不在白名单）' : !a.baseMatches ? 'A 臂不是原片段' : 'A 臂没问 ⇒ 没有下降空间') + '）'}\n`);
    }
    console.log(`\n[预演结论] 可用 ${keep.length}/${POOL.length}：${keep.join(',') || '（无）'}`);
    console.log(`   挑法：取前 5 条可用（与 v1.39 同题的话优先），把 CHOSEN 改成它们，然后不带 --dry 跑。`);
  } else {
    for (let pair = 1; pair <= N; pair++) {
      for (const m of MSGS) {
        for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
          const r = await callOnce(arm, 'treat', m, pair);
          if (r) rows.push(r);
        }
      }
      for (const m of MSGS) {
        for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
          const r = await callOnce(arm, 'ctl', m, pair);
          if (r) rows.push(r);
        }
      }
    }
    for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

    const pick = (arm: Arm, cond: 'treat' | 'ctl', id: string) =>
      rows.filter(r => r.arm === arm && r.cond === cond && r.id === id);
    const treat = rows.filter(r => r.cond === 'treat');

    // ── ① 操纵检查 ──
    console.log(`\n${'='.repeat(88)}\n① 操纵检查（策略块是否真的换了 / 低谷是否真的成段）\n${'='.repeat(88)}`);
    let manOk = true, bCovered = 0, treatTotal = 0;
    for (const m of MSGS) {
      const a = pick('A', 'treat', m.id), b = pick('B', 'treat', m.id);
      treatTotal += b.length;
      bCovered += b.filter(r => r.isRestraint).length;
      const okA = a.length > 0 && a.every(r => r.baseMatches && !r.isRestraint);
      const okB = b.length > 0 && b.every(r => r.isRestraint && r.lpEstablished);
      if (!okA || !okB) manOk = false;
      const names = [...new Set([...a, ...b].map(r => r.strategyName))].join('/');
      console.log(`   ${pad(m.id, 3)}策略=${pad(names, 12)} A原片段=${okA ? 'Y' : 'n'}`
        + ` B平常事片段=${b.filter(r => r.isRestraint).length}/${b.length}${okB ? ' ✓' : ' ✗ 这条话没被改动作用到'}`);
    }
    const coverOk = treatTotal > 0 && bCovered * 2 >= treatTotal;
    console.log(`   B 臂覆盖率 ${bCovered}/${treatTotal}${coverOk ? ' ✓（≥一半）' : ' ✗ 改动没作用到样本上，读数无意义'}`);
    if (!coverOk) manOk = false;

    let ctlIdentical = 0, ctlTotal = 0;
    for (const m of MSGS) for (let p = 1; p <= N; p++) {
      const a = rows.find(r => r.arm === 'A' && r.cond === 'ctl' && r.id === m.id && r.pair === p);
      const b = rows.find(r => r.arm === 'B' && r.cond === 'ctl' && r.id === m.id && r.pair === p);
      if (a && b) {
        ctlTotal++;
        if (a.strategyBlock === b.strategyBlock && !a.isRestraint && !b.isRestraint) ctlIdentical++;
      }
    }
    console.log(`   静息对照：两臂策略块逐字节相同 ${ctlIdentical}/${ctlTotal}`
      + `${ctlIdentical === ctlTotal && ctlTotal > 0 ? ' ✓ 变量只有一个（是"她在低谷"而不是"这些话不该问"）' : ' ✗ 变量不止一个'}`);
    if (ctlIdentical !== ctlTotal || ctlTotal === 0) manOk = false;
    console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：下面的数字不能当结论用'}`);

    // ── ② 各臂均值 ──
    console.log(`\n${'='.repeat(88)}\n② 各臂均值（均值±SD，低谷条件 n=${treat.filter(r => r.arm === 'A').length}/${treat.filter(r => r.arm === 'B').length}）\n${'='.repeat(88)}`);
    console.log(pad('指标', 16) + pad('A 基线', 18) + pad('B 平常事片段', 20) + 'B−A');
    for (const k of KEYS) {
      const g = (arm: Arm) => treat.filter(r => r.arm === arm).map(r => r.metrics[k]);
      const [A, B] = [g('A'), g('B')];
      console.log(pad(k, 16) + pad(`${mean(A).toFixed(2)}±${sd(A).toFixed(2)}`, 18)
        + pad(`${mean(B).toFixed(2)}±${sd(B).toFixed(2)}`, 20) + (mean(B) - mean(A)).toFixed(2));
    }

    // ── ③ 配对检验 ──
    const pairsOf = (k: keyof Metrics): Array<[number, number]> => MSGS.flatMap(m =>
      Array.from({ length: N }, (_, i) => {
        const a = rows.find(r => r.arm === 'A' && r.cond === 'treat' && r.id === m.id && r.pair === i + 1);
        const b = rows.find(r => r.arm === 'B' && r.cond === 'treat' && r.id === m.id && r.pair === i + 1);
        return a && b ? [a.metrics[k], b.metrics[k]] as [number, number] : null;
      }).filter((x): x is [number, number] => x !== null));
    const diffs = (k: keyof Metrics) => pairsOf(k).map(([a, b]) => b - a);
    console.log(`\n${'='.repeat(88)}\n③ 配对检验（同句同 pair，对立面=基线 A）\n${'='.repeat(88)}`);
    for (const k of KEYS) {
      const d = diffs(k); const s = signTest(d);
      const dir = mean(d) < 0 ? '更低' : mean(d) > 0 ? '更高' : '持平';
      console.log(`   ${pad(k, 16)}B胜${String(s.win).padStart(2)} A胜${String(s.lose).padStart(2)} p=${s.p.toFixed(3)}`
        + ` 均值差 ${mean(d).toFixed(2)}（B ${dir}）`);
    }
    const mcn = mcnemar(pairsOf('asked'));
    console.log(`   ${pad('askMcNemar', 16)}A问B不问 ${mcn.b} ／ A不问B问 ${mcn.c} ⇒ 精确 p=${mcn.p.toFixed(3)}`);

    // ── ④ 复读（三把尺子分开，只有前两把当判据）──
    console.log(`\n${'='.repeat(88)}\n④ 复读（三把尺子分开量；第一/二跑只有第③把，而它量的是**装置产物**）\n${'='.repeat(88)}`);
    const textsOf = (arm: Arm) => treat.filter(r => r.arm === arm).map(r => r.reply);
    // ③ 同输入复现（**不作判据**）：同一条话 × 同一 pair 的组内两两相似度
    const sameOf = (arm: Arm) => {
      const groups = new Map<string, string[]>();
      for (const r of treat.filter(x => x.arm === arm)) {
        const k = `${r.id}`;
        groups.set(k, [...(groups.get(k) ?? []), r.reply]);
      }
      return sameInputDiversity([...groups.entries()].map(([key, replies]) => ({ key, replies })));
    };
    // ② 跨上下文开场复用（判据：B 的"最多一种开场占比"不许明显高于 A）
    const openA = openerReuse(textsOf('A')), openB = openerReuse(textsOf('B'));
    // ① 对她**上一次那句话**的复现（判据：这才是 v1.32 查重治的东西，生产里真会发生）
    const simA = mean(treat.filter(r => r.arm === 'A').map(r => r.metrics.repeatSim));
    const simB = mean(treat.filter(r => r.arm === 'B').map(r => r.metrics.repeatSim));
    const hitA = treat.filter(r => r.arm === 'A' && r.metrics.repeatHit === 1).length;
    const hitB = treat.filter(r => r.arm === 'B' && r.metrics.repeatHit === 1).length;
    for (const arm of ['A', 'B'] as Arm[]) {
      const s = sameOf(arm);
      console.log(`   ${arm} ③ 同输入（**不作判据**，装置产物）：两两相似度均值 ${s.meanPairwise.toFixed(2)}，`
        + `逐字相同 ${s.exactPairs} 对、≥0.7 近似 ${s.nearPairs} 对`);
    }
    console.log(`   A ② 开场复用（框架）：${openA.frame.distinct}/${openA.n} 种，最多「${openA.frame.top.text}」×${openA.frame.top.count}（${(openA.frame.share * 100).toFixed(0)}%）`
      + `｜前 12 字口径 ${(openA.head.share * 100).toFixed(0)}%`);
    console.log(`   B ② 开场复用（框架）：${openB.frame.distinct}/${openB.n} 种，最多「${openB.frame.top.text}」×${openB.frame.top.count}（${(openB.frame.share * 100).toFixed(0)}%）`
      + `｜前 12 字口径 ${(openB.head.share * 100).toFixed(0)}%`);
    console.log(`   A ① 对上一条：相似度均值 ${simA.toFixed(2)}，会被 v1.32 查重拦下 ${hitA}/${treat.filter(r => r.arm === 'A').length} 条`);
    console.log(`   B ① 对上一条：相似度均值 ${simB.toFixed(2)}，会被 v1.32 查重拦下 ${hitB}/${treat.filter(r => r.arm === 'B').length} 条`);

    // ── ⑤ 裁定 ──
    const mA = mean(treat.filter(r => r.arm === 'A').map(r => r.metrics.chars));
    const charsOk = mean(treat.filter(r => r.arm === 'B').map(r => r.metrics.chars)) >= 0.7 * mA;
    const sQ = signTest(diffs('questions'));
    const primary = mean(diffs('questions')) < 0 && sQ.p <= 0.10;
    const secOk = mean(diffs('probe')) < 0;
    const ackOk = mean(diffs('ack')) >= 0;
    const presOk = mean(diffs('presencePhrase')) >= 0;
    const echoOk = mean(diffs('echo')) >= 0;
    // 复读的两把**生产相关**尺子（替换原来那条二值"逐字重复组数"，理由见文件头 v1.45 段）
    const repeatOk = simB <= simA + 0.05 && hitB <= hitA;
    const openerOk = openB.frame.share <= Math.max(0.2, openA.frame.share * 1.5);
    console.log(`\n${'='.repeat(88)}\n⑤ 数据层面裁定（判据跑之前写死；最终裁定要人看过原文再下）\n${'='.repeat(88)}`);
    console.log(`   主终点 questions：均值差 ${mean(diffs('questions')).toFixed(2)}（B胜${sQ.win} A胜${sQ.lose} p=${sQ.p.toFixed(3)}）⇒ ${primary ? '✓ 明显收住' : '✗ 未达标'}`);
    console.log(`   次终点 probe：均值差 ${mean(diffs('probe')).toFixed(2)} ⇒ ${secOk ? '✓ 同向' : '✗ 没降（方向不一致，主终点不算数）'}`);
    console.log(`   （记录、**不当判据**）asked 二值 McNemar p=${mcn.p.toFixed(3)}（A问B不问 ${mcn.b} / A不问B问 ${mcn.c}）`
      + ` —— 降级理由见【第一跑记录】②）`);
    console.log(`   护栏   承认 ack ${mean(diffs('ack')).toFixed(2)} ${ackOk ? '✓' : '✗ 掉了 ⇒ 变成不接话，算输'}`);
    console.log(`   护栏   在场 presencePhrase ${mean(diffs('presencePhrase')).toFixed(2)} ${presOk ? '✓' : '✗ 掉了 ⇒ 算输（v1.38 死因）'}`);
    console.log(`   护栏   落在他那句话上 echo ${mean(diffs('echo')).toFixed(2)} ${echoOk ? '✓' : '✗ 掉了 ⇒ 她不再看他的事，算输'}`);
    console.log(`   护栏   字数 ${mA.toFixed(1)} → ${mean(treat.filter(r => r.arm === 'B').map(r => r.metrics.chars)).toFixed(1)}`
      + ` ${charsOk ? '✓ 没塌到 70% 以下' : '✗ 塌了 ⇒ 短到像敷衍，算输'}`);
    console.log(`   护栏   ① 复读上次那句：相似度 ${simA.toFixed(2)} → ${simB.toFixed(2)}，查重命中 ${hitA} → ${hitB}`
      + ` ${repeatOk ? '✓ 没更容易复读' : '✗ B 更容易复读 ⇒ 算输'}`);
    console.log(`   护栏   ② 开场复用占比（框架口径）${(openA.frame.share * 100).toFixed(0)}% → ${(openB.frame.share * 100).toFixed(0)}%`
      + ` ${openerOk ? '✓ 没更单调' : '✗ B 更单调 ⇒ 算输'}`);
    console.log(`   对照   静息条件下两臂策略块逐字节相同 ${ctlIdentical}/${ctlTotal}（见 ①）`);
    const pass = manOk && primary && secOk && ackOk && presOk && echoOk && charsOk && repeatOk && openerOk;
    console.log(`   ⇒ 数据层面：${pass ? '**达标**（仍须人看原文）' : '**未达标**'}`);
    console.log(`   回复原文：${ROWS}（人工过目；判官不参与本跑裁定）`);
  }
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}

// ── 【预演记录】（2026-09，--dry，8 条候选 × 2 臂）──
// 8/8 全通过"B 臂真换成平常事片段 ∧ A 臂是原片段 ∧ A 臂确实问"三条 ⇒ CHOSEN 取前 5 条
// （含与 v1.39 逐字相同的 h1/h2/h3，两跑可直接比）。
// 逐条（A 原片段 → B 平常事片段，括号是问号数）：h1 46字(1)→24字(0)、h2 10字(2)→18字(0)、
//   h3 36字(2)→43字(1)、h4 28字(1)→26字(1)、h5 40字(2)→27字(1)、h6 50字(3)→28字(0)、
//   h7 30字(1)→28字(1)、h8 26字(1)→18字(1) —— 8 条里 7 条下降或持平、**0 条上升**。
//
// ⚠️ 预演暴露的两条**量具问题**（在正式跑之前记下来，不是事后改判据）：
//   ① `presencePhrase` 与 `ack` 在这批话上**两臂都恒为 0** —— 他说的是平常事，本来就没有可承认的、
//      也不该出现"我在"那种在场话。⇒ 这两条护栏**没有余量**，跑出来的"没掉"不构成证据，
//      只是"没东西可掉"。本跑真正起作用的非退化护栏是 `echo` 与 `chars` 与模板塌缩。
//      （同 v1.37 学到的：一个**没有余量**的终点，测了也说明不了任何事。）
//   ② 这个起始状态下策略**恒为 `explore`**（`[Pattern] 探索兴趣: 宠物` → Rule 4），
//      `neutral` 分支没被这跑覆盖 ⇒ 本跑的结论范围**只到 `explore`**（而它正是明确写着
//      "像一个真正好奇的朋友那样追问"的那条，也就是追问的正面来源）。
//
// 见运行日志：只有通过"B 臂真换成平常事片段 ∧ A 臂是原片段 ∧ A 臂确实问"三条的候选才进 CHOSEN。
