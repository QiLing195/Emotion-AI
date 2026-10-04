// ── v1.53 「他接住了她这句话吗」：**冻结的人工标注集** ──
//
// 为什么需要它：`classifyMotiveOutcome` 是**纯词面**的（共享实词锚点 / 相似度），它问的是
// 「他有没有**接着说这件事**」。而 `wish`（她想要什么）/`stance`（她的态度）/`state`（她自己的状态）
// **没有"这件事"可接** —— 他那句话再怎么回应，也不会复述她的愿望或态度
// ⇒ 真实账本里这三类的 `landed` 结构性地恒为 0（`wish` 29/0、`stance` 3/0）⇒ 权重被罚到 0.5。
//
// 标注规则（**先写标签、再看分类器输出**；标签按定义给，不按代码给）：
//   landed  = 他这一句**接住了她那句话**：回答/回应/追问/表态，对话顺着她那句走
//   missed  = 他那句**没接**：敷衍（短应答）、或者直接换了话题
//   unclear = 说不清（例如他也说了自己的状态，算不算"接住"没有共识）
//
// ⚠️ 一半的「他的话」取自 `memories/episodic_memory.json` 里**真实出现过**的句子
//（标注里注明 `real`），另一半是按常见回应手写的（注明 `hand`）。

export interface OutcomeCase {
  kind: 'open_loop' | 'worry' | 'memory_echo' | 'curiosity' | 'wish' | 'stance' | 'state';
  /** 她说出口的那句（动机内容） */
  voiced: string;
  /** 他紧接着的那句 */
  his: string;
  /** 人工标签（冻结） */
  label: 'landed' | 'missed' | 'unclear';
  /** 为什么这么标（给人工复核看的） */
  why: string;
  src: 'real' | 'hand';
}

export const OUTCOME_CASES: OutcomeCase[] = [
  // ── 话题型（他那件事）：现在的词面判据本来就成立 ──
  { kind: 'open_loop', voiced: '他面试那事有消息了吗', his: '还没消息呢，说下周一才有结果', label: 'landed',
    why: '他就是来交代这件事的进展', src: 'hand' },
  { kind: 'open_loop', voiced: '他面试那事有消息了吗', his: '今天下午把阳台收拾了一下，累是累，看着还行', label: 'missed',
    why: '整句换到别的事上，没接面试', src: 'real' },
  { kind: 'worry', voiced: '他是不是又熬夜了，我有点担心', his: '昨晚两点才睡，今天头有点晕', label: 'landed',
    why: '正面回答了"熬没熬夜"（**换了词：两点才睡**）', src: 'real' },
  { kind: 'worry', voiced: '他是不是又熬夜了，我有点担心', his: '嗯，知道了', label: 'missed',
    why: '短应答，没接', src: 'hand' },
  { kind: 'memory_echo', voiced: '他上次说想去看海，我记着呢', his: '等这个项目结束，我想去趟海边', label: 'landed',
    why: '他自己把"海"接起来了', src: 'hand' },
  { kind: 'memory_echo', voiced: '他上次说想去看海，我记着呢', his: '说实话最近只关注工作了，没有注意到带给我快乐的事', label: 'missed',
    why: '真实的一句：他在讲自己的状态，没接"海"', src: 'real' },
  { kind: 'curiosity', voiced: '他好像提过一家没去过的店', his: '那家店我查了，周末要排队', label: 'landed',
    why: '接住了"店"', src: 'hand' },
  { kind: 'curiosity', voiced: '他好像提过一家没去过的店', his: '哦', label: 'missed',
    why: '敷衍', src: 'hand' },

  // ── 非话题型（她自己的）：这正是现在判据**接不到**的那一半 ──
  { kind: 'wish', voiced: '想和他多待一会儿', his: '我明天早点下班，晚上陪你', label: 'landed',
    why: '她那句是**愿望**，他用行动接住了（词面上一字不重）', src: 'hand' },
  { kind: 'wish', voiced: '想和他多待一会儿', his: '你呢，今天过得怎么样？', label: 'landed',
    why: '他把话头递回给她', src: 'hand' },
  { kind: 'wish', voiced: '想和他多待一会儿', his: '嗯，我知道了', label: 'missed',
    why: '短应答，没接', src: 'hand' },
  { kind: 'wish', voiced: '想和他多待一会儿', his: '我跟你说个事，公司那边又改了方案', label: 'missed',
    why: '整句换话题到她之外', src: 'hand' },
  { kind: 'stance', voiced: '我在意的是真的连上，不是聊了多少句', his: '你说得对，我也觉得', label: 'landed',
    why: '直接回应她的态度', src: 'hand' },
  { kind: 'stance', voiced: '我觉得人得先对自己诚实', his: '我倒觉得有时候善意的谎也没关系', label: 'landed',
    why: '**表态回应**（不认同，但接住了她的观点）', src: 'hand' },
  { kind: 'stance', voiced: '我觉得人得先对自己诚实', his: '好的，我记下了', label: 'missed',
    why: '收下但不接', src: 'hand' },
  { kind: 'stance', voiced: '我在意的是真的连上，不是聊了多少句', his: '嗯', label: 'missed',
    why: '敷衍', src: 'hand' },
  { kind: 'stance', voiced: '我觉得人得先对自己诚实', his: '你这么说，我倒想起一件事', label: 'landed',
    why: '被戳动了，顺着她这句说下去', src: 'hand' },
  { kind: 'state', voiced: '我今天心里有点闷，说不太清楚', his: '怎么了？跟我说说', label: 'landed',
    why: '追问她的状态', src: 'hand' },
  { kind: 'state', voiced: '我今天心里有点闷，说不太清楚', his: '哦', label: 'missed',
    why: '敷衍', src: 'hand' },
  { kind: 'state', voiced: '我今天心里有点闷，说不太清楚', his: '我今天也挺累的', label: 'unclear',
    why: '他讲了自己的状态 —— 算"呼应"还是"没法接"没有共识', src: 'hand' },
  { kind: 'state', voiced: '我今天状态有点低，不太想强撑着说话', his: '那你早点休息，别硬撑', label: 'landed',
    why: '接住了她的状态并回应', src: 'hand' },

  // ── 几例"说不清"（第三类不能只有一个用例） ──
  { kind: 'wish', voiced: '想和他多待一会儿', his: '这周末可能要加班', label: 'unclear',
    why: '半接半推：像是在回应"待一会儿"，也可能是自己另起一句', src: 'hand' },
  { kind: 'open_loop', voiced: '他面试那事有消息了吗', his: '面试的事我们先别聊了', label: 'landed',
    why: '虽然回避，但他明确是在回应这件事', src: 'hand' },
  { kind: 'memory_echo', voiced: '他上次说想去看海，我记着呢', his: '你还记得那事啊', label: 'landed',
    why: '**他反问"你还记得"** ⇒ 接住了她这句回忆', src: 'hand' },
  { kind: 'curiosity', voiced: '他好像提过一家没去过的店', his: '你说的那家店在哪来着？', label: 'landed',
    why: '他反过来问那家店', src: 'hand' },
];
