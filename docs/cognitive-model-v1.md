# Curiosity Cognitive Model v1

> 定义 Understanding Layer 的本体论：Interest → Pattern → Insight → Discovery 的边界、状态转换和成熟度计算。

---

## 1. 本体定义

### 1.1 Interest（兴趣节点）

**定义**：用户持续关注的对象或主题。属于感知层产出，是认知系统最基础的原子单元。

**是 Interest**：
- `摄影` — 用户在多次对话中提及
- `Minecraft` — 用户主动讨论玩法、更新
- `AI` — 用户关注技术动态
- `猫` — 用户反复提及宠物话题

**不是 Interest**：
- 单次提及且后续不再出现的实体
- 被动回应系统提问时提到的话题（"你喜欢什么？" → "还行吧"）
- 无具体指向的泛化词（"东西"、"那个"）

**数据来源**：`interests.ts` → `extractInterests()` 关键词匹配 + `updateInterestModel()` 积累

---

### 1.2 Pattern（模式结构）

**定义**：多个 Interest 节点或 Interest 与情境变量之间形成的稳定关联结构。Pattern 是事实，不是解释。

**是 Pattern**：
- `摄影 ↔ 压力` — 摄影和压力话题经常同时出现
- `摄影 → 夜晚时间段` — 摄影讨论集中在晚间
- `{摄影, 散步, 音乐}` — 三个兴趣形成共现集群

**不是 Pattern**：
- 单个 Interest 的高频出现（这只是强兴趣，不是结构）
- 随机共现（两个话题碰巧在同一条消息中出现一次）
- 因果关系断言（"压力导致摄影"——那是 Insight，不是 Pattern）

**关键约束**：Pattern 只描述"什么和什么关联"，不描述"为什么关联"。

---

### 1.3 Insight（解释性假设）

**定义**：对 Pattern 的解释性假设。Insight 是从"事实"到"理解"的跃迁，包含因果关系或功能解释。

**是 Insight**：
- `用户压力增大时倾向通过摄影调节情绪` — 解释了 Pattern `摄影 ↔ 压力`
- `用户的创造性兴趣（摄影、音乐）集中在非工作时段` — 解释了时间 Pattern
- `AI 话题出现后，用户的焦虑情绪下降` — 解释了情绪关联

**不是 Insight**：
- `用户经常谈摄影` — 这是事实，不是解释
- `摄影出现频率 8 次` — 这是统计，不是解释

**关键约束**：Insight 是可错的。它本质上是假设（hypothesis），后续可以被验证或推翻。

---

### 1.4 Discovery（可交付发现）

**定义**：经过筛选、值得向用户分享的 Insight。Discovery 是交付物，不是数据。

**筛选条件（Surprise Test）**：
1. **Novel** — 用户可能尚未意识到这个模式
2. **Useful** — 能帮助用户理解自己，而非八卦式的窥探
3. **Surprising** — 用户看到会产生一点点意外，而非"我知道啊"

**是 Discovery**：
- `你谈摄影的时候，情绪分数通常比平时高 20%` ✅ Novel + Useful + Surprising
- `你最近一个月对 AI 的关注度超过了其他所有话题` ✅ 用户可能没意识到

**不是 Discovery**：
- `你喜欢摄影` ❌ 用户显然知道
- `你提到猫 8 次了` ❌ 没有 Insight
- `你和女朋友吵架后更容易深夜上网` ❌ 八卦式，不 Useful

---

## 2. 状态机

```
                 ┌──────────┐
                 │ Interest │  (perception layer output)
                 └────┬─────┘
                      │ 满足: frequency≥N OR connectedness≥M
                      ↓
              ┌───────────────┐
              │ PatternCandidate│
              └───────┬───────┘
                      │ 满足: frequency≥N' AND persistence≥P
                      ↓
              ┌────────────────┐
              │ PatternConfirmed│
              └───────┬────────┘
                      │ 满足: 存在可解释关系
                      ↓
              ┌───────────────┐
              │InsightGenerated│
              └───────┬───────┘
                      │ 满足: Novel + Useful + Surprising
                      ↓
              ┌────────────────┐
              │DiscoveryShared │
              └────────────────┘
```

### 转换条件（初始阈值，后续通过 Discovery Yield 调参）

| 转换 | 条件 |
|------|------|
| Interest → PatternCandidate | `frequency ≥ 3` OR `connectedness ≥ 3` OR `persistence ≥ 2 个时间窗口` |
| PatternCandidate → PatternConfirmed | `frequency ≥ 5` AND `persistence ≥ 3 个时间窗口`，OR `connectedness ≥ 阈值` |
| PatternConfirmed → InsightGenerated | 存在可解释关系（关联节点的语义距离足够近，或情绪效价呈现系统性偏差） |
| InsightGenerated → DiscoveryShared | Novel + Useful + Surprising 三方都满足 |

---

## 3. 三维成熟度模型

### 3.1 Frequency（频率）

**定义**：Interest 节点在对话历史中的累计出现次数。

```
frequency(I) = count(mention(I))
```

**初始阈值**：Candidate ≥ 3，Confirmed ≥ 5

**注意**：后期应升级为 weighted_frequency = Σ(出现次数 × 时间衰减因子)，避免"3 个月前密集讨论"和"最近持续讨论"被同等对待。

---

### 3.2 Persistence（持续性）

**定义**：Interest 跨时间窗口的分布广度。

```
persistence(I) = count(distinct_time_windows(mention(I)))
```

时间窗口建议：**自然日**（初期），后期可细化为"上午/下午/晚上"或"工作日/周末"。

**判别逻辑**：
- `persistence = 1`：同一天内密集出现 → 可能只是当天话题
- `persistence ≥ 3`：跨多天持续出现 → 更可能是真实兴趣

**初始阈值**：Candidate ≥ 2 个时间窗口，Confirmed ≥ 3 个时间窗口

---

### 3.3 Connectedness（关联性）

**定义**：Interest 节点与其他节点形成的关系网络密度。这是三维中最有价值但最难计算的维度。

```
connectedness(I) = |{J : cooccur(I, J) ≥ min_cooccur}|
```

即：与该 Interest 有显著共现关系的其他 Interest 数量。

**初始阈值**：Candidate 时 ≥ 3 个关联节点

**进阶方案**（后期）：
- **图密度**（graph density）：实际边数 / 可能边数
- **互信息**（mutual information）：PMI(摄影, 压力) 是否显著偏离随机
- **中介中心性**（betweenness centrality）：该节点是否是多个子图的关键桥梁

---

## 4. Discovery Yield（健康指标）

```
DY = DiscoveryShared / InterestDetected
```

| 区间 | 含义 | 行动 |
|------|------|------|
| 0% ~ 2% | 门槛过高，系统保守 | 降低成熟度阈值 |
| 2% ~ 5% | 偏保守，Discovery 稀缺 | 可接受，微调 |
| 5% ~ 20% | **健康区间** | 维持 |
| 20% ~ 50% | 门槛偏低，Discovery 贬值 | 提高阈值 |
| >50% | Interest = Discovery，系统失去了认知筛选能力 | 重构成熟度模型 |

---

## 5. 三模型协作架构

### 5.1 当前问题

`selectStrategy()` 是一个 **优先级路由器（Priority Router）**，不是决策编排器（Decision Composer）：

```
if 情感A → empathize
if 情感B → redirect
if interest → explore
if discovery → share
```

认知模型只能决定"做什么策略"，不能决定"策略里放什么内容"。结果：

```
用户: "今天被领导骂了"
情感: valence -0.6, arousal 0.4
认知: 摄影 PatternConfirmed(0.87) — 已知用户压力时倾向摄影
策略: R1 → empathize → "听起来真的很难受"
       ↑ 知道用户有摄影这个出口，但无法利用
```

### 5.2 目标架构

三个模型各司其职，在 Context Assembly 层融合：

```
Emotion Model          Cognitive Model
(实时感知)              (长期理解)
    ↓                       ↓
Constraints              Context
(允许什么/禁止什么)       (什么内容最有价值)
    ↓                       ↓
    └──────┬────────────────┘
           ↓
    Context Assembly
    (融合约束 + 上下文)
           ↓
    Strategy Model
    (选择行动 + 注入内容)
           ↓
    Response
```

**职责分离**：

| 模型 | 输入 | 产出 | 职责 |
|------|------|------|------|
| Emotion | 用户消息 + NLU | Constraints: 允许/禁止的策略集合 | 安全边界 |
| Cognition | 对话历史 + Interest[] | Context: 相关的 Pattern + Insight | 内容候选 |
| Context Assembly | Constraints + Context + 当前消息 | 融合上下文 | 编排 |
| Strategy | 融合上下文 | Action: 主策略 + 辅助内容 | 决策 |

### 5.3 Context Assembly 示例

```
用户: "今天被领导骂了"

Emotion Constraints:
  allowed: [empathize, accompany, repair]
  blocked: [share, challenge, explore]

Cognitive Context:
  relevantPatterns: [
    { topic: "摄影", score: 0.87, relevanceToCurrentEmotion: 0.91 },
    { topic: "散步", score: 0.62, relevanceToCurrentEmotion: 0.74 }
  ]

Context Assembly 输出:
  {
    primaryStrategy: "empathize",
    contentInjection: ["摄影"],     // 从 cognitive context 注入
    tone: "warm",
    constraint: "不要主动切换话题"
  }

最终回复:
  "听起来真的很不好受...
   我记得你之前提过，拍照似乎总能让你平静一点。
   今天要不要带上相机出去走走？"
```

### 5.4 认知模型对外接口（不暴露内部阈值）

认知模型对策略层暴露的是**查询接口**，不是**判断函数**：

```ts
interface CognitiveModel {
  /** 获取当前所有 PatternCandidate（按 score 排序） */
  getPatternCandidates(): Pattern[];

  /** 给定情绪状态，返回相关的 Pattern（内容候选） */
  getRelevantPatterns(emotionState: EmotionState): Pattern[];

  /** 获取当前可分享的 Discovery（已通过 Novel+Useful+Surprising 筛选） */
  getShareableInsights(): Insight[];
}
```

**关键约束**：
- 策略层不调用 `isMature(topic)` — 阈值属于认知模型内部
- 策略层不关心 Candidate(0.45) vs Confirmed(0.75) — 只消费排序后的结果
- 认知模型内部可以随意调整阈值和权重，不影响策略层

---

## 6. 模块职责与边界

```
src/curiosity/
├── interests.ts     → 输出: Interest[]
│   职责: 注意到了什么？
│
├── patterns.ts      → 输出: Pattern[], 输入: Interest[] + 对话历史
│   职责: 这些兴趣之间有什么结构？
│   实现: Frequency + Persistence + Connectedness 三维评估
│   暴露: getPatternCandidates(), getRelevantPatterns(emotion)
│   不暴露: 阈值配置（内聚在模块内）
│
├── insights.ts      → 输出: Insight[], 输入: Pattern[]
│   职责: 这些结构意味着什么？
│   实现: 关系解释 + 因果假设生成
│   暴露: getShareableInsights()
│
├── explore.ts       → 输出: Discovery[], 输入: Insight[]
│   职责: 哪些 Insight 值得告诉用户？
│   实现: Novel + Useful + Surprising 筛选 + Discovery Yield 监控
│
├── evaluate.ts      → 已有
├── dedup.ts         → 已有
├── state.ts         → 已有
└── types.ts         → 已有
```

---

## 7. 可追溯性

任意一个 Discovery 应能回溯到原始用户消息：

```
DiscoveryShared
    ↓ (generatedFrom)
InsightGenerated
    ↓ (derivedFrom)
PatternConfirmed
    ↓ (composedOf)
PatternCandidate
    ↓ (basedOn)
InterestDetected
    ↓ (triggeredBy)
UserMessageReceived
```

这要求 `patterns.ts` 和 `insights.ts` 在产出数据结构中携带上游引用（parent IDs），与 EventBus 的 `causedBy` 机制保持一致。

---

## 8. 实现路线图

### Sprint A：Curiosity Cognitive Model v1（本文档）
- ✅ 定义 Interest / Pattern / Insight / Discovery 边界
- ✅ 定义状态机与转换条件
- ✅ 定义三维成熟度模型
- ✅ 定义 Discovery Yield 健康指标
- ✅ 定义三模型协作架构（Emotion Constraints + Cognitive Context + Strategy Action）

### Sprint B：patterns.ts — Interest → PatternCandidate
- 实现 Frequency 计算
- 实现 Persistence 计算（基于时间窗口）
- 实现 Connectedness 初版（共现计数）
- 实现 `getPatternCandidates()` 和 `getRelevantPatterns(emotion)`
- 所有阈值集中在 `PatternConfig`，不向外暴露
- **不碰 Insight，不碰策略层**

### Sprint C：Minimal Context Assembly — 策略层重构（优先于 Insight）
- 重构 `selectStrategy` 从 Priority Router → Decision Composer
- 实现 Emotion Constraints 产出（allowed/blocked strategies）
- 实现 Cognitive Context 注入：即使 Pattern 未升级为 Insight，`getRelevantPatterns(emotion)` 的结果也能参与内容决策
- R4 升级：`interestSignals` → `getPatternCandidates()` 过滤（成熟度门槛）
- R5 修复：`pendingDiscoveries` → `getShareableInsights()` 连通
- Context Assembly **输出解释**：`selectedPatterns[].reason` + `rejectedPatterns[].reason`，可追溯为什么选 A 不选 B
- **目标**：用户感受到"它记得我"，即使后台还没有 Insight/Discovery
- **约束**：认知模型只提供内容候选，不参与策略规则

### Sprint D：insights.ts — Insight Generation
- 实现关联关系解释（"共现 → 可能的功能关系"）
- 实现情绪效价偏差检测（"谈摄影时情绪比平时高 X%"）
- 实现 Surprise Test 初版（Novel + Useful + Surprising）
- 产出 `getShareableInsights()` — 此时 Insight 作为 content candidate 进入 Context Assembly

### Sprint E：DiscoveryShared 重构
- 将 DiscoveryShared 的触发源从 Interest 切换到 Insight
- 集成 Discovery Yield 监控
- 输出仪表盘：漏斗数据（Interest → Pattern → Candidate → Confirmed → Insight → Shared）

---

## 9. 设计原则

1. **每一层独立可验证**：Pattern 不依赖 Insight，Insight 不依赖 Discovery
2. **阈值可调不可硬编码**：所有成熟度阈值应集中管理，通过 Discovery Yield 反馈调参
3. **可追溯**：每个产出携带上游引用，形成完整 causal chain
4. **Insight 是可错的**：解释层产出的假设可以被后续数据推翻，这不是 bug 是 feature
5. **Discovery 是交付物不是数据**：分享给用户的发现必须通过 Surprise Test
6. **认知模型不暴露内部阈值**：策略层只消费排序后的结果（`getRelevantPatterns()`），不调用判断函数（`isMature()`）
7. **情感做约束，认知做内容，策略做行动**：Emotion → Constraints, Cognition → Context, Strategy → Action
