# CLAUDE.md — 道·AI 女友

> 本文件为 Claude Code 在处理此项目时提供指导。

## 项目概述

**道·AI 女友** 是基于道家哲学五层情感架构的 AI 陪伴系统。
核心目标不是优化对话质量，而是构建**具有真实情感动力学、记忆系统、价值体系和自我认知**的 AI 人格。

```
情感引擎层: src/lib/emotionEngine.ts (五层架构 + v4.1 补丁)
           src/lib/emotionOptimizer.ts (四项算法补丁)
           src/lib/emotionCanonical.ts (情绪标签归一: LLM 自然语言标签 → 固定键, 防下游静默失效)
           src/lib/emotionInternal.ts (v1.7 内在情绪源: 孤独/重逢/思维/兴趣/发现/洞察 → 弱强度情绪)
           src/lib/moodLayer.ts (v1.8 心情层: 12h 尺度慢变底色, 偏置+半衰期淡忘+强烈情绪让位)
           src/lib/rumination.ts (v1.8 反刍层: 同情绪连续主导 → 边际钝化 + 自我安抚)
           src/lib/emergenceMetrics.ts (v1.8 涌现可观测: 内在驱动占比/自相关/波动/卡死判定)
           src/lib/motive.ts (v1.9 动机层: 先决定"她此刻想说什么"再让她说 —— 泛问的根因解法)
           src/lib/memoryGrounding.ts (v1.11 记忆接地校验: 断言型记忆引用必须能在她的知识里落地)
表述生成层: server.ts 的 Prompt 组装 (人格底座→自我叙事→记忆→策略→禁令→【此刻我心里挂着的事】)
对话策略层: src/lib/dialogueStrategy.ts (7种策略 + Prompt片段)
           src/lib/conflictManager.ts (五阶段冲突状态机)
情境感知层: src/lib/contextAwareness.ts (三维情境建模)
           src/lib/rhythmController.ts (节奏控制 + 主动消息约束)
记忆系统:   src/lib/episodicMemory.ts (情景记忆)
           src/lib/memoryGraph.ts (图谱, addNode 同源幂等 + episodic 归档同步)
           src/lib/unifiedMemory.ts (四源召回)
           src/lib/memoryGovernance.ts (v1.2 治理层: 候选状态机+证据判定，移植自 c-former)
           src/lib/memoryEnhancer.ts (v1.3 增强层: 艾宾浩斯遗忘曲线 + 相似合并去重)
           src/lib/memoryVisibility.ts (v1.4 可见性层: 敏感度 × 关系阶段门控)
协调编排:   server/services/aiCoordinator.ts (单入口 processTurn)
思维图谱:   src/lib/thoughtGraph.ts (🧠 Thought Graph: 情感与策略之间的思考层)
模块连接:   src/lib/moduleConnections.ts (19条连接 + 熔断保护)
```

## 项目规则

修改代码前先阅读对应的规则文件：
- `.claude/rules/emotion-integrity.md` — 情感引擎修改的强制检查
- `.claude/rules/persona-safety.md` — 人格安全边界
- `.claude/rules/api-security.md` — API 端点的安全检查
- `.claude/rules/code-health.md` — 代码健康标准

## 项目 Skills（Skill 工具可调用）

每次修改相关代码后主动查阅对应的 skill 以确认设计意图：

| 修改文件 | 查阅 Skill |
|---------|-----------|
| `src/lib/dialogueStrategy.ts` | `dialogue-repair`, `dialogue-empathize`, `dialogue-redirect`, `dialogue-accompany`, `dialogue-explore`, `dialogue-share`, `dialogue-desire`, `dialogue-boundary`, `dialogue-neutral` |
| `src/lib/conflictManager.ts` | `dialogue-repair`, `dialogue-boundary` |
| 任何 `src/lib/` 引擎文件 | `ai-girlfriend-quality-gate` — 完整质量验证流程 |

## 项目 Agents（Agent 工具可调用）

**修改代码后主动分派，无需等待用户指示：**

| 修改的文件 | 分派 Agent | 目的 |
|-----------|-----------|------|
| `emotionEngine.ts` / `emotionOptimizer.ts` | `emotion-coherence-checker` | 验证九情稳定性、反转边界、唤醒保护 |
| `aiProvider.ts` / `dialogueStrategy.ts` / 回复生成 | `persona-safety-guardian` | 审查 AI 不越界、不打破角色 |
| `dialogueStrategy.ts` / `conflictManager.ts` | `conversation-quality-reviewer` | 评估策略选择和 Prompt 质量 |
| `episodicMemory.ts` / `memoryGraph.ts` / `unifiedMemory.ts` | `memory-consistency-auditor` | 审计记忆形成、召回和遗忘逻辑 |

## 运行命令

```bash
# 开发模式
npm run dev                       # 启动服务器 (tsx server.ts)
npx vite                          # 前端开发服务器 (localhost:5173)

# 测试
npx vitest run                    # 运行全部 973 个测试
npx vitest src/lib/__tests__/     # 核心引擎测试

# 类型检查
npx tsc --noEmit                  # TypeScript 类型检查
npm run typecheck                 # 完整检查（主配置 + server strict）

# 情绪涌现自检（不依赖 LLM/网络：直接驱动 aiCoordinator，打印孤独/重逢/心情/反刍/强化/涌现指标）
npm run smoke:emotion

# 记忆可视化 + 人工核实（Obsidian 看板，可重复生成）
#   用法：--vault 指向库根 → 只创建/更新其下「AI女友记忆/」子目录，绝不触碰库内其它笔记
npm run obsidian:export -- --vault="D:\Lenovo\obsidian\库"
#   人工核实闭环二选一：
#   a) server 运行中热同步（推荐，无需重启）：
#      curl -X POST http://localhost:3000/api/memories/governance -H "Content-Type: application/json" \
#           -d '{"refId":"<episode id>","status":"verified","actor":"reviewer:obsidian","reason":"..."}'
#   b) 离线/批量：在 Obsidian 改 frontmatter 的 governance_status 后回写账本：
npm run obsidian:review -- --vault="D:\Lenovo\obsidian\库"

# 快速 API 测试
curl -s http://localhost:3000/health
curl -s http://localhost:3000/state
```

## 架构约束

### 依赖方向
```
src/lib/         ← 纯逻辑，无 React/DOM 依赖，可被任何层引用
src/curiosity/   ← 独立模块，仅依赖 src/lib/ 和外部 API
src/store/       ← Zustand 状态，可引用 src/lib/ 和 src/curiosity/
src/components/  ← UI 组件，可引用 store + lib
src/views/       ← 页面，可引用一切
server.ts        ← 后端入口，引用 src/lib/ + server/services/
server/services/ ← 后端服务层
```

### 修改影响范围
- 修改 `emotionEngine.ts` → 必须跑 emotion 测试 + emotionOptimizer 测试
- 修改 `dialogueStrategy.ts` → 必须跑 dialogue 测试 + conflict 测试
- 修改 `conflictManager.ts` → 必须跑 conflict 测试 + dialogue 测试
- 修改 `server.ts` → 必须类型检查 + 启动测试 + 无密钥泄漏检查
- 修改 AI 回复 Prompt → 必须检查 persona-safety.md 边界

### aiCoordinator 调用契约（v1.9，重要）
`processTurn()` 的这几个入参**决定一批功能是否真的在跑**，调用方必须传（`server.ts` 已传；新增调用点务必照做）：

| 入参 | 不传的后果（历史事故） |
|------|----------------------|
| `lastInteractionAt` | 协调器 `idleMins` 恒为 0 → **孤独/重逢通路永不触发**（含重逢修复） |
| `roundNumber` | 退回进程内 `turnCounter`（重启归零）→ 20/50 轮门控（思维衰减、聚类、潜意识检测、叙事刷新）被无限拉长 |
| `activeValues` | `dialogueStrategy` 的 S7 价值观调制永不成立（`if (ctx.activeValues)` 恒假） |
| `userAnalysis` / `emotionEvent` | 情绪传染 / 奖惩强化不触发 |

回归测试：`server/services/__tests__/aiCoordinator.test.ts` 锁死这三条（含"不传则不误报独处"的反向断言）。

## 关键特性开关

| 开关 | 文件 | 用途 |
|------|------|------|
| `USE_EMOTION_OPTIMIZER` | emotionOptimizer.ts | 设为 false 回退 v4.0 |
| `DISABLE_LLM_NLU` | server.ts / `.env` | **当前 = false（已开启 LLM 情感识别）**。设为 `true` 走本地规则事件（省掉每条消息一次额外 API 调用，实测单轮总耗时 1.5~2.6s）；两种模式产出的标签都会经 `emotionCanonical.ts` 归一为固定键 |
| `dynamicEmotion=false`（persona） | server.ts | 用户主动关闭动态情感 → 不产生情感事件（情感与记忆均停） |
| `DISABLE_HMR` | vite.config.ts | 关闭热重载 |

## 情绪涌现与防"自嗨漂移"设计（v1.7/v1.8）

情绪来源共 5 路，全部在 `aiCoordinator.processTurn` 内按固定顺序施加，并按来源记账（`emergence`）：

| 顺序 | 来源 | 入口 | 强度约束 |
|------|------|------|---------|
| 阶段 3 | 用户话语直接刺激 | `applyEvent(EmotionUpdated)` | 引擎完整强度（用户信号优先） |
| 阶段 3.1 | 操作条件反射（奖惩） | `suggestReinforcement` → `applyEvent(StrategyFeedback)` | 仅当情绪**明确指向她**；含 rewardTally/punishmentTally 习惯化 |
| 阶段 3.65① | 情绪传染 | `applyEmotionalContagion` | intensity<0.2 / empathy<10 不触发；shift≤0.12 |
| 阶段 3.65② | 内在事件（孤独/重逢/思维/兴趣/发现/洞察） | `deriveInternalEvents` → `applyInternalEvents` | 单事件 ≤0.08、习惯化递减、**单轮总影响 ≤0.1** |
| 阶段 3.65③ | 心情层（12h 尺度底色） | `applyMoodBias` | 每轮 ≤0.05、死区 0.05、强烈情绪让位、锚定 `evolution.baseline` |
| 阶段 3.65④ | 反刍层 | `ruminationModulation` | 连续 ≥3 轮同情绪才开始；主导情绪最多钝化 40%，calm 最多 +0.06 |

防漂移/防过拟合的六道闸门：
1. **弱强度**：非用户来源单轮影响都有硬上限，合起来也受 `INTERNAL_TOTAL_CAP=0.1` 缩放。
2. **习惯化**：同一内在事件、同一奖惩反复触发时效果递减（satiation / tally）。
3. **衰减到基线**：心情按半衰期 18h 向 0（= 静息基线）淡忘；空闲超 `MOOD_FRESHNESS_H=24h` 的旧心情既不偏置也不进 Prompt。
4. **用户信号优先**：强烈情绪时心情让位（`MOOD_YIELD_TO_EMOTION`）；心情偏置按"本轮开始前效价 → 目标"计算，不抹平用户当下造成的变化。
5. **反刍自限**：钝化只作用于主导情绪的正值，calm（自我安抚）回升；链条 6h 无互动即重置。
6. **重逢修复**：>24h 归来走 reunion（joy/love 回升、sad 回落），不叠加孤独，避免"带怨气冷启动"。

可观测（`GET /state` → `emergence`）：`internalShare`（内在驱动占比）、`lag1Autocorrelation`（情绪是否只会延续上一轮）、`valenceVolatility`、`stuck`（卡死判定，阈值随窗口长度自适应 + 死水兜底）、`note`（人话诊断）。
自检：`npm run smoke:emotion`（不需要 LLM，直接驱动协调器打印各路效果）。

## 动机层设计（v1.9，泛问的根因解法）

**问题**：开场老是"今天怎么样/在干嘛"。**根因**：生成时 LLM 手里只有人格+记忆+情绪数字+策略+一摞禁令，**没有"她此刻具体想说什么"**；没有素材时模型必然回退到对话先验（寒暄+提问），禁令只能改措辞。

**解法**：先决定动机，再让她说。`src/lib/motive.ts` + `server.ts` Prompt 组装（放在**末尾**：注意力最高处）。

| 动机类型 | 来源 | 先验紧迫度 / 保鲜期 |
|---------|------|-------------------|
| `open_loop` | 他说了但没落定的事（面试/体检/结果…，`extractOpenLoops` 规则抽取；分"刚说"与"之前说"两种措辞，避免假记忆） | 0.80 / 48h |
| `worry` | 她的担忧 | 0.70 / 7d |
| `memory_echo` | 主动回忆闸门选中的旧事（复用已有 `approach`/`injectionText`） | 0.62 / 7d |
| `wish` | 愿望（模板念头经第 2 层 LLM 具体化后入池） | 0.58 / 5d |
| `curiosity` | 好奇心发现/兴趣（同样可被具体化） | 0.52 / 14d |
| `stance` | 价值观立场（`evolution.valuePriorities` 最高项 → `VALUE_STANCE_LINES`） | 0.46 / 3d |
| `state` | 底色心情明显偏离中性 → 她今天的状态本身就是想说的事 | 0.40 / 6h |

四条闸门（否则动机层会变成新的机械感）：
1. **允许为空**：紧迫度 < `MOTIVE_MIN_SALIENCE`(0.28) 就没有动机 → Prompt 明确要求"安静陪着，不要为了维持对话而泛问"。
2. **用户优先**：用户情绪强烈且为负（`shouldDeferToUser`）→ 本轮不表达自己的事，先接住他。
3. **习惯化**：提起一次 `attempts+1` → 紧迫度下降；`attempts` 随时间恢复（0.6/天）。
4. **两层去重**：同类型相似内容合并；**话题级**——上一轮刚说过的那件事（含换动机类型）在 30 分钟内被打 0.3 折，防"连着问同一件事"。

可观测：`GET /state` → `motive`（本轮结论 `thisTurn`、池 `pool`、`lastSelected`、`learning`）。
回归测试：`src/lib/__tests__/motive.test.ts`（46 条）、`motiveLearning.test.ts`（14 条）、`server/services/__tests__/motiveSpecificizer.test.ts`（19 条）。

### 第 2 层：念头内容具体化（v1.10）
`server/services/motiveSpecificizer.ts` —— 模板念头（`fillThoughtContent` 的"想和他多待一会儿"）**不进动机池**；改由一次 LLM 调用（每 5 轮一次，或池内 <3 条时冷启动）把念头具体化成"她此刻真能说出口的一句话"，写入 `internal.motive.pendingCandidates`，下一轮合并入池。

- **校验极严**（宁可少生成，也不让空话进池）：必须同时有"指向他/你"**和**具体锚点（时间词/具体事件名词/引用标记）；拒绝元描述（"作为一个AI"）、过短、超长、白名单外类型。
- **失败即丢弃**：解析失败/校验失败一律返回空，绝不污染状态。异步执行，不阻塞回复。
- **与 RSI 的边界**：只生成素材，不改规则与权重。

### L1 动机反馈学习（v1.10，RSI-lite）
`motive.ts` 的 `classifyMotiveOutcome` / `learnFromOutcome` / `motiveWeight`，账本 `memories/motive_learning.json`：

- **信号**：上一轮她说出口的那件事，这一轮他的话里有没有接住（话题词重合 / 字面相似）→ `landed` / `missed` / `unclear`。
- **学什么**：`权重 = 0.5 + 回应率`，有界 **[0.5, 1.5]**，样本 < 3 条时保持中性 1.0（少样本不学）。
- **绝不做什么**：不新增/改写动机类型，不改规则，不自我修改 Prompt；下界保证任何开口方式都不会被封杀（保留多样性）。**删除 `motive_learning.json` 即完全回到中性**。
- 可观测：`/state` → `motive.learning`（每类的 voiced/landed/landedRate/weight）。

### 记忆接地校验（v1.11，防编造）
`src/lib/memoryGrounding.ts` + `server.ts` 生成后的确定性校验（不是 Prompt 软约束）：

1. **只查断言**：识别"你上次说／你说过／我们上次／我记得你…"等断言型引用；
   **提问一律放行**（"面试有消息了吗？"是在问，不是在断言事实）。
   ⚠️ 提问判定必须落在**小句**上——实测"你上次说面试前紧张得没睡好，……吗？"整句以问号结尾，
   按整句判定会把前面的编造一起放行。
2. **接地覆盖率**：把引用内容按**最长匹配**（最小 2 字，虚词不计入分母）在她的知识语料里比对；
   覆盖率 < 0.6 判为未接地。**"她的知识"** = 本轮召回的记忆原文 + 最近对话 + 主动回忆注入 +
   自我叙事/动机内容 + 长期情景记忆（她有印象但本轮未被召回的也算；绝不用模型自己的上一条回复当证据）。
3. **处理顺序**：检测 → 带"可引用事实清单"**重写一次** → 仍不接地铁定**删除该断言小句**（保留同句其余内容）。
   ⚠️ 修过一个坑：响应体曾直接用 `result.text`，导致重写结果被丢弃——现在返回的是校验后的文本。

线上实测（同一个编造模式复现两次都被拦下）：

```
[Grounding] 检测到 1 处未接地引用：引用了记忆里没有的细节：前、得没睡好（覆盖率 0.44）
[Grounding] 重写后已接地
[Grounding] 检测到 1 处未接地引用：整段引用在她的记忆/对话中都不存在：「那家公司面完三轮了」
[Grounding] 重写后已接地
```

对照验证（`scripts/check-grounding.ts`，用真实记忆语料 + 真实回复）：编造句 ok=false；有依据的复述 ok=true；
话题式提问 ok=true（无误杀）。

### 动机驱动的主动消息（v1.12）
`server/services/proactiveMessenger.ts` + `server.ts` 的 `runProactiveTick()`：**她主动找你，是因为心里挂着一件事**，不是定时器。

判定链（层层可观测，`/state → proactive.lastDecision` 与 `/api/proactive/tick` 都返回原因）：

| 关卡 | 条件 | 默认值 |
|------|------|--------|
| persona 开关 | `persona.proactive !== false` | 开 |
| 关系阶段 | 不是 `stranger` | — |
| 空闲时长 | ≥ `PROACTIVE_MIN_IDLE_MINUTES` | 120 分钟（正在聊天绝不插话） |
| 节奏配额 | `rhythmController.canSendProactive()`：9:00–22:00、每日上限（`proactiveFrequency` 同步到 `maxProactivePerDay`）、最小间隔 2h | 2 条/日 |
| **动机紧迫度** | ≥ `requiredMotiveSalience(persona.proactiveThreshold)`：30→0.30、90→0.65 | 0.505（65） |

通过后：LLM 生成 ≤40 字短消息（**禁万能问候**，`sanitizeProactiveMessage` 二次清洗）→ **复用记忆接地校验**（防编造）→ 入待投递队列 + `recordProactiveSent` + 动机 `attempts++`（习惯化）。

出口与调度：
- `GET /api/proactive/pending`：前端每 20s 轮询取走队列（取走即清空），`ChatView` 追加消息 + TTS 播报。
- `POST /api/proactive/tick`：手动评估（调试用，可传 `{idleMinutes, persona}` 覆盖以便验证闸门）。
- 调度：`start()` 里每 5 分钟评估一次；`DISABLE_PROACTIVE_LOOP=true` 可关闭。

线上实测（负路径 + 正路径）：

```
tick(idle=5)                  → sent=false：距上次互动仅 5 分钟（需 ≥120）
tick(idle=180, threshold=90)  → sent=false：动机「curiosity」紧迫度 0.52 < 门槛 0.65（不够想你，就不打扰）
tick(idle=180, threshold=30)  → sent=true：动机「curiosity」够格主动
                                她发出：「那家公司的名字…你跟我说过吗？」   ← 记不清就问，而不是编
pending 取一次 → 1 条；再取 → 0 条（不重复显示）；quota=1/2
```

回归测试：`server/services/__tests__/proactiveMessenger.test.ts`（21 条）。

### 潜意识层接线（v1.13，shadowLayer）
498 行实现此前**基本空转**，三处断点全部接好：

| 断点 | 之前 | 现在 |
|------|------|------|
| 情感出口 | `shadowEmotionMod` 取出来就丢弃 | 每轮 `applyShadowEmotionBias()` 施加到太极，**限幅 ±`SHADOW_MAX_TURN_BIAS`(0.03)**：底色级慢变量不许盖过用户当下的话；并计入涌现诊断的 `shadow` 来源 |
| 策略证据 | `detectTraits(..., strategyStats=null, ...)` → 「策略证据」永不产生 | 喂入 `rewardLearner` 真实统计（`strategyStatsForShadow()`）<br>⚠️ 踩坑：`getAllStats()` 返回**数组**，早期按 `Object.entries()` 映射导致键变成 "0"/"1"，通路静默失效 |
| 状态持续 | 只在内存，重启清零 | `memories/shadow_state.json` + `memories/reward_stats.json`（策略统计也一并持久化）；检测门控改为「距上次检测 ≥N 轮」，不再用 `% 50 === 0`（避免重启后错拍） |

可调旋钮：`SHADOW_DETECTION_INTERVAL_ROUNDS`（默认 50）。
**时标预期**：每条证据 +0.015 置信度、≥0.3 激活，一次检测通常每个特质 +1 条证据 → 默认节奏下"特质浮现"约需 20 次检测（≈1000 轮）；设成 5 则约 100 轮（验收时用这个值实测过）。

可观测：`GET /state → shadow`：`activeTraits`、**`accumulating`（正在累积但未激活的特质，否则看不出它在慢慢长）**、`modulation`、`lastDetectionRound`、`totalDetections`。
自检脚本：`npx tsx scripts/check-shadow.ts`（证据累积曲线 / 激活后出口位移与限幅 / 持久化往返）。
回归测试：`src/lib/__tests__/shadowLayerWiring.test.ts`（14 条）。

线上实测（`SHADOW_DETECTION_INTERVAL_ROUNDS=5`，25 轮对话）：

```
启动：[Persistence] 已加载潜意识状态：6 个特质（活跃 0）
第 5 轮  lastDetectionRound 65→70  累积 4 个特质 × 0.015
第10轮  lastDetectionRound 70→75  累积 4 × 0.03（总证据 8）
第25轮  自我价值怀疑=0.09 控制欲/害怕被忽视/对亲密的矛盾=0.075（总证据 21）
重启后：[Persistence] 已加载潜意识状态：6 个特质（活跃 0）→ 置信度与 lastRound=90 原样恢复
```

### 情景记忆 → 图谱同步（v1.14）
`createNodeFromEpisode` 早已写好却**零生产调用** → 新记忆只有 episodic 存储、图谱 BFS 召回看不到它们（实测 26 条 episode 只有 19 个 episodic 节点）。

- **形成即入图**：`server.ts` 的 `tryFormEpisode()` 之后立刻 `memoryGraph.addNode(createNodeFromEpisode(ep))`；失败只告警、不影响主流程。
- **启动补全**：`backfillEpisodicNodes(graph, episodes)`（`memoryGraph.ts`）把"有 episodic 存储但图谱无节点"的历史记忆一次补齐；**已归档的不补**（不把遗忘的记忆拉回活跃图谱）。
- **幂等**：`addNode` 对同一 `(source, sourceId)` 复用既有节点 → 重复执行不产生副本，可安全地在每次启动时运行。
- 与既有的 `syncEpisodicArchivedNodes()`（整合周期把归档记忆的图谱节点同步归档）互为反向操作，保证两侧不漂移。

线上实测：启动补全 `新增 17 个（已存在 19）` → 活跃 episode 36 = 图谱 episodic 节点 36（差额 0）；随后一轮对话 episode 36→37、图谱 36→37。
回归测试：`src/lib/__tests__/episodicGraphBackfill.test.ts`（9 条）。

## 已知技术债务

| 优先级 | 项目 | 说明 |
|--------|------|------|
| ✅ 已解决 | server.ts 接入 aiCoordinator | aiCoordinator.processTurn() 已集成于主聊天管道 (server.ts:5949) |
| 🔴 高 | server.ts 拆分 | 6462行单体 → `server/` 模块化架构 |
| ✅ 已解决 | S5/S8 强连接激活 | 已在 aiCoordinator.processTurn() 内部激活 |
| ✅ 已解决 | S7 价值→策略连接 | commit 55810a3 已激活 |
| 🟢 低 | emotionEngine alpha 动态化 | S6 仅完成 lossAversion，alpha 值仍为常量 |
| 🟢 低 | curiosity/ 全局状态消除 | 仍有模块级依赖注入变量 |
| ✅ 已解决 | 孤儿模块清理 | 2026-09 删除 server/config.ts、server/context.ts、expressionIntegrity.ts、autonomyConfig.ts（-829 行） |
| ✅ 已解决 | memoryEnhancer | v1.3 遗忘+整合层已实现（2026-09）：艾宾浩斯曲线(回想越多忘越慢、verified 几乎不忘) + 相似副本合并归档(2-gram+embedding 双路相似)；server 每 6h/首轮自动整合 |
| ✅ 已解决 | memoryGraph 对象库收敛 | v1.3 addNode 同源(source+sourceId)幂等复用不建副本；episodic 归档后图谱视图节点随整合周期同步归档（实测 19/19 匹配零误伤） |
| ✅ 已解决 | 记忆治理层 | v1.2 memoryGovernance.ts（c-former 移植）：候选状态机 proposed→supported→verified/rolled_back + 三条件证据判定 + applyReview 统一人工核实（含链式）；v1.3 热同步端点 POST /api/memories/governance（运行中生效，无需重启） |
| ✅ 已解决 | 情绪只由"用户当前这句话"驱动 | v1.7/v1.8（2026-09）：aiCoordinator 阶段 3.65 接入①情绪传染 ②内在事件（孤独/重逢/思维/兴趣/发现/洞察）③心情层（12h 慢变底色，锚定 evolution.baseline）④反刍层（同情绪连续主导 → 钝化 + calm 回升）；⑤情绪涌现可观测（内在驱动占比/自相关/波动/卡死）已入 /state |
| ✅ 已解决 | 死代码：applyEmotionalContagion / suggestReinforcement | 两者此前从未接入权威管道。传染已接入阶段 3.65；强化信号在阶段 3.1 接入（仅当用户情绪**明确指向她**时），并把 coordinator 发出的 StrategyFeedback 事件负载补齐为 type/source/value 同形（此前 payload 不匹配，若被回放会产生 NaN） |
| ✅ 已解决 | LLM 情绪标签导致下游静默失效 | 开启 LLM 情感识别后实测返回 `"疲惫、委屈"` / `"gratitude and warmth"`，而 `CONTAGION_MAP`、`suggestReinforcement`、`personalityEvolution` 都按固定英文键匹配 → 传染/强化**不报错但永不触发**。解法：①`emotionCanonical.ts` 归一（中英+口语+否定形式，最长优先）②prompt 明确要求 8 个枚举键 ③`applyEmotionalContagion`/`suggestReinforcement` 入口兜底归一；原始中文标签保留在 `UserEmotionAnalysis.emotionLabel` 供展示 |
| 🟢 低 | 本地规则 NLU 词表偏窄 | `DISABLE_LLM_NLU=true` 时靠 `analyzeUserSentiment` 词典，实测「今天上班好累，被老板说了两句」判为 neutral（0.04）→ 事件全零；已开 LLM NLU 后不影响，但若要省 API 需补词表（累/被说/受气…） |
| 🟡 中 | 情绪状态长期停在低谷 | 实测持久化状态曾长期处于 valence≈-0.49 / disgust 0.55（positiveInteractions=0, negativeInteractions=22）。心情层现在会按"基线 - 低谷"的差距每轮轻推回基线（≤0.05/轮），但根因在事件归因与累计负面计数，未动 |
| 🟢 低 | 前端未消费心情/反刍/涌现指标 | /state 已暴露 `mood`/`rumination`/`emergence`/`internalNarrative`，SettingsView 与聊天页尚未展示 |
| ✅ 已解决 | 入口漏传字段导致 4 个模块静默空转 | v1.9（2026-09）`server.ts` 只传 4 个字段 → ①`lastInteractionAt` 缺 → `idleMins` 恒 0 → **孤独/重逢线上永不触发**（含重逢修复）②`activeValues` 缺 → S7 价值调制恒假 ③`roundNumber` 缺 → 退回进程内计数器，20/50 轮门控被拉长 ④价值发现只在从未被前端调用的 `/api/identity` 里跑 → `evolution.valuePriorities` 常年为空。修法：补齐实参 + 每 10 轮 `surfaceValues` + 会话状态落盘 `memories/session_state.json`；线上实测可观测到 `satiation.loneliness=0.85`（12h 空窗）与非空 `valuePriorities` |
| ✅ 已解决 | 身份叙事零消费（自我随经历更新断链） | v1.9：`shouldRefreshNarrative` 此前导入未调用、`narrativeToPromptSnippet` 无调用点。现在每 20 轮在主循环生成叙事 → 写回 `evolution.lastIdentityRefresh` + 缓存 `memories/identity_narrative.json` → 下一轮注入 Prompt（排在人格底座之后）；`/api/identity` 改为返回缓存。实测第 37 轮生成了含关键记忆的自我叙事 |
| 🟡 中 | 反机械化只是软约束（已被动机层部分取代） | 禁令仍保留为兜底，但根因已由动机层解决（有具体素材时不再泛问）。若要进一步收紧，可做后置校验：命中禁词/与关系阶段矛盾的亲昵词 → 带"重写要求"再生成一次（不上 LLM judge） |
| ✅ 已解决 | 具体化内容可能夹带编造细节 | v1.10 实测：第 2 层生成的 motive 会驱动她说出"你上次说面试前紧张得没睡好"，而记忆里并无此条。**v1.11 已用确定性后置校验解决**：断言型引用按"最长匹配覆盖率"对她的知识语料接地，<0.6 判违规 → 带事实清单重写一次 → 仍违规则删除该断言小句；提问一律放行。线上复现两次均被拦下（含"那家公司面完三轮了"） |
| ✅ 已解决 | 潜意识层（shadowLayer）空转 | v1.13 接线：①每轮把 `shadowEmotionMod` 限幅（±0.03）施加到太极并计入 `shadow` 来源 ②`detectTraits` 喂入 rewardLearner 真实策略统计（修掉 `getAllStats()` 数组被当对象映射的静默 bug）③`shadow_state.json` + `reward_stats.json` 持久化，检测门控改「距上次 ≥N 轮」。线上实测证据跨重启累积（0.09 / 总证据 21 / lastRound 90 原样恢复） |
| 🟢 低 | 潜意识激活时标偏慢 | 默认 `SHADOW_DETECTION_INTERVAL_ROUNDS=50` + 每条证据 +0.015、阈值 0.3 → 特质浮现约需 1000 轮。想更快可设 `SHADOW_DETECTION_INTERVAL_ROUNDS=5~20`（≈100~400 轮）；或调低激活阈值（需改 shadowLayer 内部常量，未动） |
| 🟢 低 | `alphaVMultiplier` / `stickyEmotions` 仍未进引擎 | 潜意识调制目前只用了 `valenceBias`/`arousalBias`；效价更新速率与"情绪更粘"需要在 `emotionEngine` 内部生效（改动面更大，暂缓） |
| ✅ 已解决 | 记忆图谱未收 episodic 节点 | v1.14：形成即入图 + 启动 `backfillEpisodicNodes()` 补全历史孤儿（已归档不补、幂等）。线上实测补全 17 条孤儿 → 36/36 差额 0；新对话 episode 与图谱节点同步 +1 |
