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
           src/lib/lowPeriod.ts (v1.37 低谷期时长: 跨轮/跨重启记"她沉了多久"; v1.43 结案带理由)
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
           src/lib/replyDiversity.ts (v1.45 复读尺子: 同输入/按时间/开场复用 —— **只测量，不进决策**)
模块连接:   src/lib/moduleConnections.ts
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
npx vitest run                    # 运行全部 1335 个测试
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

### Strategy Causal Ordering Invariants（v1.58，**改这条链之前必读**）

1. Proactive Recall **may** consume provisional strategy context.
2. Provisional strategy computation **MUST** have no commit side effects.
3. Motive **MUST** be resolved after recall/gating and before final strategy selection.
4. Final behavioral strategy **MUST** consume the resolved motive/action when one exists.
5. **Only** the final strategy may be committed.
6. Strategy commit occurs **at most once** per turn（`getStrategyCommitCount()` 可观测）.
7. **All** downstream consumers **MUST** use the committed final strategy（`/state`／Prompt／日志同源）.
8. Motive resolution occurs **at most once** per turn.

> 6/7/8 守的是"学一份、用另一份"那个危险。⚠️ `final ≠ provisional` **不是 bug**（那正是这刀的意义）；
> bug 是 `final ≠ committed` 或 `committed ≠ downstream`。生产管道结构断言：`scripts/smoke-c1-production-path.ts`。

### Experiment Modification Discipline（v1.60-p0，**改实验装置之前必读**）

- 源码只用 `edit`/`write`；脚本只执行、测量、断言 —— **禁止生成需再解析的源码**（regex/template/type/SQL/prompt 模板等）。
- 分类测试必须覆盖**语义类别**，不能只覆盖表面词汇（v1 的 12/12 只是"作者归属"一个类别的局部正确 ⇒ 那种绿**没有信息量**）。
- **ID 不承载语义**；`memoryId`/`candidateId` 等标识符本身不得作为 ownership/provenance 证据。
- **工具链故障不计入机制实验结果**：装置失败后先恢复干净仓库，再重跑。（P0-2 期间 5 次故障**全部**在"脚本生成源码"这一环，机制层一次都没错。）
- **先验证磁盘真值，再判断"文件被截断"**：区分**源文件实际截断**与**上下文注入截断**（后者只是注入预算，文件本身没坏）。装置报错先查真值，别直接"修文件"。


## 关键特性开关

| 开关 | 文件 | 用途 |
|------|------|------|
| `USE_EMOTION_OPTIMIZER` | emotionOptimizer.ts | 设为 false 回退 v4.0 |
| `DISABLE_LLM_NLU` | server.ts / `.env` | **当前 = false（已开启 LLM 情感识别）**。设为 `true` 走本地规则事件（省掉每条消息一次额外 API 调用，实测单轮总耗时 1.5~2.6s）；两种模式产出的标签都会经 `emotionCanonical.ts` 归一为固定键 |
| `dynamicEmotion=false`（persona） | server.ts | 用户主动关闭动态情感 → 不产生情感事件（情感与记忆均停） |
| `DISABLE_PERSONALITY_DRIFT` | server.ts / aiCoordinator | **设为 `true` → 关掉人格漂移**（她的人格六参数冻结）。v1.13 才把这条通路接进主链，此开关用于 A/B 对照与回退 |
| `DISABLE_APPRAISAL` | aiCoordinator | **设为 `true` → 关掉评价层**（只保留情绪镜像，不评价"他这件事对**她**的意义"）。v1.14 接线，用于 A/B 对照与回退 |
| `DISABLE_HMR` | vite.config.ts | 关闭热重载 |
| `DISABLE_MEMORY_NARRATIVE_LLM` | server.ts | 设为 `true` → 记忆叙事不做 LLM 重写（不合格/关闭时**保留模板**）。v1.21 接线 |
| `DISABLE_LONG_TERM_DRIFT` | server.ts | 设为 `true` → 关掉长周期人格漂移（「被经历塑造」那条路）。v1.23 接线，`/state → longTermDrift` 可观测 |
| `DISABLE_BASELINE_DECAY` | server/index.ts | 设为 `true` → 九情衰减回 **0**（v1.24 之前的旧行为，仅供 A/B）；默认回归**人设静息基线**。⚠️ 它决定衰减的**目标**，不决定**做不做** —— 后者见 `DISABLE_SERVER_DECAY` |
| `DISABLE_SERVER_DECAY` | aiCoordinator 阶段 0 | v1.43：设为 `true` → **服务端不施加时间衰减**（回到 v1.41 探针记录的旧行为：一周与一天一模一样）。默认**施加**（修复了"只有前端在调 `processTimeDecay`"那个 bug） |
| `ENABLE_APPRAISAL_STANCE` | appraisal.ts / server.ts | v1.47：`true` → 把**评价结论**（"这件事对我来说意味着什么"）作为一块拼进 Prompt（策略片段之前）。**默认关**（真管道 A/B 未达标：主终点无余量、`echo` −0.20，且那一块与动机块**信息冗余**，见债务表 v1.47 行） |
| `ENABLE_ACTIVATION_STATE` | emotionActivation.ts / emotionEngine.ts / server.ts | v1.48：`true` → 她的状态块（进 Prompt 的那段）改读**激发态**：`底色: 平静 0.80` ＋ `此刻被激起: 难过 +0.18` ＋ 末尾一条 `【我此刻的状态】`（静息不注入）。**默认关**（两跑真管道 A/B 均未达标：她的话一个字都没动，见债务表 v1.48 行）。关着时**逐字节**与旧版相同（单测钉住） |
| `DISABLE_STATE_MOTIVE` | motive.ts / server.ts / motiveSpecificizer.ts | v1.49：**已上线（默认开）**——「她自己的状态」这条动机走**连续映射**（门槛 0.25→**0.10**、紧迫度常数 0.40→**0.44~0.72**）＋实例级 `Motive.base`，入选时用**着色**文案，内容走第 2 层**具体化**（`state` 自己一套校验：不要求指向他、**禁止**外部事件名词=防编造她自己的生活）。`=true` 回退到 v1.48 之前（门槛落在可达带之外 ⇒ 这条动机事实上从不形成） |
| `ENABLE_MOTIVE_KIND_SHAPE` | motive.ts | v1.50：`true` → 动机引导语**按类型分派**（`memory_echo`/`wish`/`curiosity`/`stance` 换成"说出来"型；`open_loop`/`worry` **一个字不动**）。**默认关**（真管道 48 格未达标：`memory_echo` 的问句反而 1.00→**1.75**，见债务表 v1.50 行） |
| `ENABLE_ECHO_LINE_FROM_SUMMARY` | motive.ts / server.ts | v1.54：`true` → `memory_echo` 的动机内容**从记忆原文造句**（`我想起他说过「…」`），而不是把 `generateProactiveInjection()` 的**元指令**截 60 字贴上"我想起"（那段带【】/引号/指令、还被截断）。**默认关**（真管道 16 格：主终点问句 2.00→1.88 未达标、`mentionsIt` 0.13→0.00；唯一动的是字数 +27%，见债务表 v1.54 行） |
| `ENABLE_MOTIVE_REASON_SHAPE` | motive.ts | v1.55：`true` → 动机块改**理由形状**（「我想让他知道：<内容>／因为<该类理由>／表达倾向：…」，与现状只差中间两行）。**默认关**（真管道 24 格：操纵通过，主终点**未达标**且**量具本身被污染**；策略层对两臂**完全免疫**，见债务表 v1.55 行） |
| `DISABLE_MOTIVE_REFERENT_SHAPE` | motive.ts | v1.56：**已上线（默认开）**——动机块**指代消歧**（只对 `REFERENT_SHAPE_KINDS = ['memory_echo']`）：把无指代的「这件事」换成「这一件是**我自己**心里的事 —— 跟他刚刚说的那件不是同一件／我自己心里挂着的就是：<内容>／我这一轮想把它说出来」。修的是 v1.55 量出的病：模型把「这件事」解析成**他刚说的那件**（阳台 24/24），而**她挂的那件**（海）0/24。`=true` 回退旧形状 |
| `ENABLE_MOTIVE_ACTION_STRATEGY` | dialogueStrategy.ts | v1.57：`true` → 策略层**消费动机的行动倾向**（`Rule 3.5`）：`wait→accompany`（想到了但这轮不说）／`ask→explore`／`share→share`；`comfort`·`celebrate` 今天无规则 ⇒ **只留白不改策略**。位置在 Rule 0/1/1.5/2/3 **之后**（安全线与他优先**永不被覆盖**）、Rule 4 **之前**。**默认关**（探针证明映射能分化 3 个策略，但真管道**送不到** —— 见债务表 v1.57 行） |
| `DISABLE_MOTIVE_RAW_GATE` | motive.ts | v1.52：**已上线（默认开）**——动机**门槛**看**加权前**的分（情境问题："这事值不值得开口"，含"刚说过"的重复惩罚），学习权重只用于**排序**（"够格的里面谁最该说"）。修的是 v1.51 量出的病：权重下界 0.5 把 `curiosity`(0.26)/`stance`(0.23) 压到门槛 0.28 之下 ⇒ 这两类**永远开不了口**。`=true` 回退到"门槛看加权后" |
| `DISABLE_MOTIVE_PER_KIND_OUTCOME` | motive.ts / server.ts | v1.53：**已上线（默认开）**——「他接住了她这句话吗」改成**双通道**：①共享实词锚点（他接着说这件事；＋本地加强"去掉虚词后要剩 ≥2 个实字"） ②他明确回应她这句（问 / 对着她说 / 表态），两条 OR。修的是：`wish`/`stance`/`state` 没有"这件事"可接 ⇒ `landed` 结构性恒为 0（`wish` 29/0）⇒ 权重被罚到下界。`=true` 逐字回退老判据 |
| `DISABLE_MODERATE_DEFER` | server.ts | 设为 `true` → 让位门槛回到 **0.6**（v1.30 行为）；默认按"他是否明确负面情绪"分档（0.4）。v1.31 |
| `STRATEGY_TUNING` | dialogueStrategy.ts | v1.34：13 个判定阈值的 JSON 覆盖（越界/非法**忽略并告警**，不钳制）。给"AI 提议阈值"的反事实重放与真管道 A/B 用 |
| `ENABLE_STRATEGY_DIRECTION` | dialogueStrategy.ts | v1.36：`true` → 他明确是好事（joy/gratitude/love）时不让 Rule 1 走"安静陪着"。**默认关**（A/B 没量到收益，见上表） |
| `ENABLE_LOW_PERIOD_STANCE` | dialogueStrategy.ts | v1.38：`true` → 她处在**已成段**低谷且他报喜时，策略片段换成「准许低位回应」（悬置"要跟他一样高"、不许假装高兴、也不许冷处理）。**默认关**（第一跑未达标） |
| `ENABLE_LOW_PERIOD_HOLD_BACK` | motive.ts | v1.39：`true` → 她**自己在低谷**时走让位路（本轮不给她"关于他的待办"）。与旧让位路**判据不同**：旧路由他触发，这条**只看她**。**默认关**（第二跑结论与预期相反） |
| `LOW_PERIOD_HOLD_BACK_GATE` | motive.ts | v1.39：`period`（默认）= **整段**（要求已成段，≥2 次落定）｜`turn` = **逐轮**（这一次落定沉就够）。拼错回落 `period` |
| `ENABLE_LOW_PERIOD_RESTRAINT` | dialogueStrategy.ts | v1.42/v1.46：`true` → 她**已成段**低谷 + 他这句话是**平常事**（归一后 neutral）时，策略片段换成「这一轮不要求你推进对话；但要把那件事里最具体的一点接住」。白名单只收 `neutral`/`explore`；**负向四键永不替换**（不碰 v1.31 的承认通路）。**默认关**（五跑结案，见债务表 v1.42/v1.46 行） |
| `DISABLE_LOW_PERIOD_PROACTIVE_HOLD` | proactiveMessenger.ts | v1.40/v1.44：**已上线（默认开）**——她**自己在低谷**时更矜持：空闲 **120→240 分钟**（推后）且**每日上限 2→1**（v1.44 加码；当天第一条照发 = "降低但不是没有"，两跑真管道均达标）。`=true` 回退到每 2h 可发 / 每日 2 条 |
| `LAYA_STRATEGY` | server.ts / layaClient.ts | `off`（默认，**一次网络都不发**）/ `shadow`（只记账：记下"模型想改判成什么"但不改）/ `on`（可改判）。v1.33；配套 `LAYA_ENDPOINT`(默认 `http://127.0.0.1:8790`)、`LAYA_MIN_CONFIDENCE`(0.5)、`LAYA_TIMEOUT_MS`(1500)、`LAYA_MODEL`(multilingual) |

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

## 情绪表示层（v1.13）—— 「基调」不能当「情绪」

**问题**：`emotions` 是 9 维向量，里面**混着两种东西**——人格基调（`INITIAL_EMOTION_STATE`：calm 0.8 / greed 0.2，她"平时就是这样"）和本轮被激起的位移。任何对**绝对值**取 argmax 的读法，拿到的基本永远是基调。

实测（2026-09，`scripts/check-emotion-activation.ts` + `npm run smoke:emotion`）：

| 事实 | 数字 |
|------|------|
| 线上向量 | calm 0.439 / greed 0.359 / love .184 / lust .184 / joy .175 / sad .133 …→ argmax = **calm**，只领先 0.08 |
| 用户持续低落 8 轮（强度 0.80） | 她 sad 只到 **0.128**，calm 反被反刍推到 **0.92** → 旧读法越来越确信"她很平静" |
| 用户愤怒 0.90（"骂老板"） | 她 sad **0.007**、anger≈0 ← 单轮噪声量级 |
| **记忆污染** | 41 条记忆里 **32 条（78%）** 把当时的情绪记成 `calm`；"他说我今天特别难过"（valenceΔ −0.182）被记成「内心是平静的，像湖面没有一丝波澜」；"这几天过得不怎么好"（−0.255）被记成「安静中带着满足，这是一种踏实的幸福」 |

语音层当初被迫加的 `CALM_YIELD_MARGIN`（"否则声音永远平静"）也是同一个病：**不是声音的问题，是表示的问题。**

**修法**（`src/lib/emotionActivation.ts`，纯读法，**不改任何动力学**）：

| 件 | 说明 |
|---|---|
| `RESTING_EMOTION_BASELINE` | **直接取 `INITIAL_EMOTION_STATE.emotions`** —— 基线是人格常数，抄一份就会两处漂移且不报错 |
| `separateActivation(emotions, baseline?)` | 逐情绪算**相对各自基线**的偏离；`activeEmotion` 只从**正**偏离里取，负偏离归 `suppressed`（"基调被压下去"≠ 她平静） |
| `ACTIVATION_DEADZONE = 0.05` | **实测标定**：单轮噪声 +0.007 < 死区 < 真实共情累积 +0.128。与 v1.15「无信号即无误差」同一条原则 |
| `ACTIVATION_MARGIN = 0.05` | 主导要领先第二名才算"她自己说得清"，否则报"XX 与 YY 并存"（**不对噪声做动作**） |
| `clear` / `resting` / `suppressed` / `note` | 静息时明确说"她此刻没有明显情绪（下游不必硬演）"—— 这是旧读法表达不了的 |

**同一个向量，两种读法**：

```
线上真实向量：  旧 = 平静 0.44        新 = 爱意 +0.18 与 渴望 +0.18 并存；平静被压低 −0.36
静息：          旧 = 平静 0.80        新 = 静息（没有明显情绪）
他很难过：      旧 = 平静 0.80        新 = 难过 +0.18
被哄好但底色沉：旧 = 平静 0.55        新 = 开心 +0.22；平静被压低 −0.25
```

**已接线的下游**（`/state → activation` 全部可观测）：
- `episodicMemory` 的叙事情绪：原来写的是 `v - 0.1`（拿 0.1 当所有情绪的静息值），意图注释是"而非永远 calm"——但 **calm 0.92 − 0.1 = 0.82 依然全场最高，它从来没生效过**。改成 `separateActivation()` 后：「他说我今天特别难过」的记忆标签 `calm` → **`sad`**，叙事变成「那种无力感涌上来，什么都做不了」。
- **`personalityEvolution` 人格漂移**（v1.13 接进主链）：读激活态 + 门限按新尺度重标定。
- 设置页新增**情绪诊断**面板（两种读法并排，否则看不出旧结论多不可信）。

**已全部切换（v1.16）**：`memoryGraph` 召回打分、`selectRedirectTopic`（那 4 个分支此前是**死代码**）、`thoughtGraph.getDominantEmotion`、事件 `dominant` 记账都改读激活态。**刻意保留两处**：`contentInjector`（读的是**模式的情感签名**，不是她的状态）与 `/state` 兼容字段。
**v1.23 已接**：基线不再取全局常数，而是**状态自带**（`EmotionState.baselineEmotions`，随状态持久化）+ `activationOf(state)` 统一读取；人设切换时由 `baselineForPersona(id)` 盖章。
自检：`node node_modules/tsx/dist/cli.mjs scripts/check-emotion-activation.ts`

## 评价层（v1.14）—— 她对他的事的反应，不等于他的情绪

**问题**：在 v1.14 之前，"她的情绪"全部来自**他怎么样**：用户话语直接刺激、情绪传染（**镜像**：他也难过→我也难过）、奖惩强化（指向她时）、内在事件/心情/反刍。**没有一步在问"这件事对**她**意味着什么"。**

于是出现这个落差：他说"我面试又挂了"——
· 镜像给的是 `sad`（我也难过）；
· 但她**心里挂着这件事**（动机池里就有"他面试那事有消息了吗"），她真正的反应是**替他悬着**（`fear`）+ 想靠近他。旧链路只会产出前者。

**修法**（`src/lib/appraisal.ts`，接进 `aiCoordinator` 阶段 3.65①.5，`DISABLE_APPRAISAL=true` 可关）：

| 通路 | 判据 | 她的反应 |
|---|---|---|
| `for_him` | 他的情绪方向 + 强度 ≥ `APPRAISAL_MIN_INTENSITY`(0.40) | 负面 → `love`↑（心疼、想靠近）＋少量 `sad`；正面 → `calm`↑（安心）＋少量 `love`。**只给关系性的一半**，镜像那半交给传染，避免双重计数 |
| `touches_her_concern` | 他这句话与她**动机池里 `open_loop`/`worry`** 的词面锚点重合 | 负面 → `fear`↑＋`sad`＋`love`（替他悬着）；正面 → `calm`＋`joy`（松一口气）；**提到但没结果 → `fear`↑（她会留意后续）**。幅度 ∝ 那条动机的真实紧迫度 `salience` |

**主题匹配换过一次实现（重要教训）**：一开始用 `textSimilarity`（动机/记忆召回那把 2-gram 尺子），实测它**对假阳性给的分更高**：

```
真命中：'他面试那事有消息了吗' <=> '面试又挂了'          = 0.083 ~ 0.200
假命中：'他今天面试怎么样'     <=> '今天吃了面'          = 0.250
        '他昨天说的那件事'     <=> '昨天看的那部电影不错' = 0.286
```

它被"今天/昨天/结果"这类高频虚词主导，**分不出"同一件事"和"碰巧都有今天"** → 改用**词面锚点**（最长公共子串 ≥2 且不在虚词表 `STOP_ANCHORS` 里）。保守偏向：**认不出来就不评价**（`readings: []`），绝不乱评价。

**实测**（`scripts/check-appraisal.ts`，确定性模式）：

| 情景 | fear | sad | love | joy | calm |
|---|---|---|---|---|---|
| ① 她挂着面试 + 他说面试挂了 | **+0.015** | +0.040 | +0.025 | −0.006 | 0 |
| ② 她**没**挂着 + 同一句话 | **0.000** | +0.039 | +0.040 | −0.006 | 0 |
| ③ 她挂着 + 他说面试过了 | 0 | 0 | +0.016 | +0.031 | +0.038 |
| ④ 她挂着 + 只提了去面试 | **+0.028** | 0 | 0 | 0 | −0.011 |

①②是同一句话、同一个他的情绪，唯一差别是**她心里有没有挂着这件事** —— ①多出来的 `fear` 就是"理解"。

**诚实的幅度说明**：单轮 `fear +0.015` **低于"被激起"的死区（0.05）**，所以那一轮激发态读数仍报"静息"；连着 6 轮他都在提这件事才爬到 **+0.105**（第 2 轮起读数变成"难过与爱意并存"→"难过 +0.20"）。这是**刻意的**：`APPRAISAL_TOTAL_CAP=0.08` 让它始终弱于"他当下这句话"，宁可"心里一沉"不喧哗，也不要她想得比他还多。若要让单轮就听得出来，得把上限抬到约 0.27（会超过内在事件的总上限 0.1）——**这需要单独决策**。

> **v1.18 已决策并实测**：上限抬到 **`APPRAISAL_TOTAL_CAP = 0.15`**（上表是 0.08 时的旧数）。
> 新数字：① fear **0.028** / sad **0.053** → 读数由"静息"变成 **"难过（+0.05）"**；③ calm **0.066** → **"平静（+0.07）"**；②④ 仍是"静息"。
> 即 **①与②的差别终于在状态读数上分开了**（靠 sad/calm 跨过 0.05 死区；`fear` 单独 0.028 仍未跨）。
> 一处必须记住：0.15 **已越过内在事件的上限 0.1**，语义上站得住 —— appraisal 是**用户触发**的（与传染的 0.12 同档），0.1 那个上限是给**自发**内在生活用的。

**刻意不做的两条**（不硬编）：①**价值观通路**（"他的话与她看重的价值冲突"）：需要价值→关键词表，而现成的 `VALUE_STANCE_LINES` 是"她想说的话"、不是判据表，靠关键词猜冲突会误伤；②**"冲着她"通路**：`suggestReinforcement`（阶段 3.1）已在处理指向她的奖惩，再加会双重计数。

可观测：`/state → appraisal`（`note` + `readings[].reason/evidence`）、`/state → emergence.breakdown.appraisal`。
回归测试：`src/lib/__tests__/appraisal.test.ts`（15 条）、`scripts/check-appraisal.ts`。

### 策略消费（v1.15）—— 共情的进退里要有**她**

评价层与表示层做完之后，还剩最后一个"只有他"的地方：`dialogueStrategy` 的 Rule 1。

```ts
// 改前：她什么样都不影响选择
if (userIntensity > 0.7) return { strategy: 'empathize', reason: `用户情绪强度 ${x} > 0.7` }
```

**加的一条**（`ACCOMPANY_WHEN_SHE_SINKS = 0.12`，用激活态量她的负情绪）：

| 情形 | 策略 | 理由（会出现在 `/state → strategy` 里） |
|---|---|---|
| 他很强 + 她没被带进去 | `empathize`（照旧） | 用户情绪强度 0.85 > 0.7 |
| 他很强 + **她也被带进去了** | **`accompany`**（安静陪着） | 「他情绪强度 0.85 > 0.7，**但我自己也被带进去了（sad +0.25 相对基调）—— 不再追着共情，安静陪着**」 |

为什么该改：**两个人都往下沉不是陪伴**。他很难过、她也被带到难过时，继续追着深挖共情只会双输；真实的伴侣这时会少说、靠近。

门限 0.12 的标定与 `ACTIVATION_DEADZONE` 同一批实测：单轮噪声 +0.007 < 死区 0.05 < **0.12** < 真实共情累积 +0.128（他持续低落 8 轮）。即"她真的被带进去了"，不是被轻轻碰一下。`sad`/`fear`/`anger` 任一越过即算。⚠️ **v1.27 更正**：那个 +0.007 量的是**传染**那一路；**阶段 3 的直接刺激**单轮就有 +0.10~+0.15，所以该门限必须读**本轮开始前**的状态（`herNegativeBeforeTurn`），否则恒成立 —— 见 v1.27 行。

回归测试：`src/lib/__tests__/dialogueStrategy.test.ts`（+6 条：她没被带进去照旧共情 / 被带进去转陪伴 / 门限两侧 / 他情绪不强不触发 / fear·anger 同样算 / **平静基调不算**）。

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

### 情绪低谷的根因修复（v1.15）——「没有消息 ≠ 坏消息」
**症状**：她长期停在 `valence≈-0.49 / disgust 0.55`，`positiveInteractions=0 / negativeInteractions=22`。
**根因**（`emotionEngine.ts` 的 `taijiUpdate`）：

```ts
let predictionError = eventValence - taiji.expectation;   // 修复前
```

全零事件（NLU 无信号、纯寒暄）的 `eventValence = 0`，而 `expectation` 初始为 **+0.2**（人格乐观基线）
→ 预测误差恒为 **−0.2**，再被损失厌恶（resilience 低时最高约 3×）放大 → **效价被无中生有地扣掉**。
`eventSalience` 明明算出来了，却只用于唤醒，**没有参与效价/预期的门控**。

实测（修复前，12 轮全零事件）：`valence 0.2 → −0.31`、`disgust 0 → 0.353`、`expectation 0.2 → 0.014`
（乐观基线被侵蚀殆尽）。

**修法**：按信息量门控预测误差（`emotionTypes.ts` 的 `SALIENCE_DEADZONE=0.20` / `SALIENCE_FULL=0.60`）：

```ts
const infoFactor = clamp((eventSalience - DEADZONE) / (FULL - DEADZONE), 0, 1);
predictionError *= infoFactor;   // 无信号即无误差；显著性 ≥ FULL 时行为与修复前完全一致
```

语义：**误差必须先有信息量**；弱证据 → 弱反应；无证据 → 不动情绪（顺带让"纯寒暄"不再消耗她的能量）。

死区为何是 0.20（**按实测 NLU 输出标定**，线上 NLU 是粗量化的）：

| 输入类型 | 实测 event | 显著性 | infoFactor |
|---|---|---|---|
| 纯寒暄（"嗯"/"好的"/"我在想晚饭吃什么"） | 全零 | 0 | 0 |
| 轻微正面闲聊（"哈哈有意思"/"看到一只小猫"） | GC=0.1, ΔA=0.05, ΔB=0.02 | ≈0.17 | 0（死区内） |
| 真实情绪（本地规则 intensity 0.5 / LLM 明确情绪） | GC≥0.3 | ≥0.4 | 0.5~1 |

若死区取 0.03，则"哈哈有意思"这类消息仍会产生负误差（她的预期 0.13 > 事件效价 0.06），
**乐观预期会被日常闲聊一点点磨掉**——这正是实测发现并修掉的第二层问题。

修复后实测：

```
12 轮全零事件：valence 0.199 → 0.188（只剩自然衰减），expectation 稳在 0.200（不再崩塌）
线上 8 条日常闲聊：valence 0.130 → 0.149（心情层轻推），expectation 固定 0.130 无流失
随后一句真情绪（"我今天特别难过，什么都做不好"）：valence 0.149 → −0.033、expectation 0.130 → 0.072、sad 0.133（真实情绪仍全额响应）
```

回归测试：`src/lib/__tests__/emotionSalienceGate.test.ts`（10 条：零信号/微噪声/强信号未被打哑/单调性/受损状态不再恶化）。
**已造成的损伤不会自动复原**（回升需真实正面信号），可用一次性脚本抹平残余：

```bash
npx tsx scripts/repair-emotion-state.ts           # dry-run 诊断
npx tsx scripts/repair-emotion-state.ts --apply   # 太极回人格基线 + 九情复位 + 清损伤期学到的心情/反刍（先备份 .bak）
```

## 语音系统（v1.6~v1.12）

> **整节搬进 [docs/voice-system-v1.md](docs/voice-system-v1.md)**（链路、逐环节事实、五条"别再踩的坑"、
> 以及每条后面的实测数字全在那里）。这里只留三句结论：
> ① **韵律 100% 靠 instruct 文本** —— 参考音只给音色，`[laughter]`/`[breath]` 控制符无效；
> ② **段数由感情决定、不由配置决定** —— `resolveArcSegments()` 算，硬上限 3，每多一段 ≈ **+2.4s**；
> ③ **「开心」与「破音/哽咽」在本地 TTS 上推不动** —— 模型边界，非 Prompt 可解。
> 语音相关的历史裁定（v1.6/v1.7/v1.9：声音平 / 伤心听感 / 破音推不动 / 状态进声音层 /语速失控 / 句内状态移动）**整表在 docs 里**，不在这里重复。

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
| ✅ 已解决 | memoryEnhancer | v1.3：艾宾浩斯遗忘曲线（回想越多忘越慢、verified 几乎不忘）+ 相似副本合并归档；server 每 6h/首轮自动整合 |
| ✅ 已解决 | memoryGraph 对象库收敛 | v1.3 addNode 同源(source+sourceId)幂等复用不建副本；episodic 归档后图谱视图节点随整合周期同步归档（实测 19/19 匹配零误伤） |
| ✅ 已解决 | 记忆治理层 | v1.2 memoryGovernance.ts（c-former 移植）：候选状态机 proposed→supported→verified/rolled_back + 三条件证据判定；v1.3 热同步端点 POST /api/memories/governance（运行中生效，无需重启） |
| ✅ 已解决 | 情绪只由"用户当前这句话"驱动 **长版见 docs** |
| ✅ 已解决 | 死代码：传染 / 奖惩强化从未接线（已接阶段 3.65 / 3.1） **长版见 docs** |
| ✅ 已解决 | LLM 情绪标签导致下游静默失效（`emotionCanonical` 归一 + 入口兜底） **长版见 docs** |
| 🟢 低 | 本地规则 NLU 词表偏窄 | `DISABLE_LLM_NLU=true` 时「今天上班好累」判 neutral（0.04）⇒ 事件全零；开 LLM NLU 后不影响 |
| ✅ 已解决 | 情绪状态长期停在低谷（v1.15） | 根因：全零事件的 eventValence=0 而 expectation 基线 +0.2 ⇒ 预测误差恒为 −0.2 被损失厌恶放大（12 轮零信号把 valence 从 0.2 拖到 −0.31）。修法：按 `eventSalience` 门控预测误差（**无信号即无误差**）。残余可用 `scripts/repair-emotion-state.ts --apply` 抹平。**长版见 docs** |
| ✅ 已解决 | 前端未消费心情/反刍/涌现指标 **长版见 docs** |
| ✅ 已解决 | 「她的情绪」读不出来（基调冒充情绪） | 绝对值 argmax 里混着人格基调（calm 0.8）⇒ 41 条记忆 **32 条（78%）记成 `calm`**。修法：`separateActivation()` 按各自基线算偏离（死区 0.05 按实测标定），`/state → activation` 暴露。**长版见 docs** |
| ✅ 已解决 | **人格漂移在线上从未执行**（v1.13 接线） **长版见 docs** |
| ✅ 已解决 | 她对他的事的反应**只是镜像**（没有评价） **长版见 docs** |
| ✅ 已解决 | 其余 argmax 读数全部切到激活态（v1.16） **长版见 docs** |
| ✅ 已解决 | 近重复记忆并存（去重等不到） **长版见 docs** |
| 🟢 低 | `memorySimilarity` 的 embedding 分支从未执行 | 真实 episode 里没有 `embedding` 字段 ⇒ 一直只走文本分支（`memoryGrounding` 没用它，自带"最长匹配"那套，可靠） |
| ✅ 已解决 | 情绪基线不随人格演化更新（v1.23） | 基线改为**状态自带**（`baselineEmotions`，随状态持久化）+ `activationOf(state)` 统一读取；`baselineForPersona(id)` 供人设切换盖章。**长版见 docs** |
| ✅ 已解决 | 入口漏传字段导致 4 个模块静默空转 **长版见 docs** |
| ✅ 已解决 | 身份叙事零消费（每 20 轮生成 → 注入 Prompt + `/api/identity`） **长版见 docs** |
| 🟡 中 | 反机械化只是软约束 | 禁令保留为兜底（根因已由动机层解决）；**v1.32 起逐字重复**已由生成后查重兜住 |
| ✅ 已解决 | 具体化内容可能夹带编造细节（v1.11 后置接地校验：断言型引用按最长匹配覆盖率 <0.6 → 重写一次 → 仍违规则删该小句；**提问放行**） **长版见 docs** |
| ✅ 已解决 | 潜意识层（shadowLayer）空转（v1.13） | 三处断点接线：情感出口限幅 ±0.03／`detectTraits` 喂真实策略统计（修掉 `getAllStats()` 数组被当对象映射）／状态持久化 + 检测门控改「距上次 ≥N 轮」。**长版见 docs** |
| 🟢 低 | 潜意识激活时标偏慢 | 默认 `SHADOW_DETECTION_INTERVAL_ROUNDS=50` + 每条证据 +0.015、阈值 0.3 ⇒ 特质浮现约需 1000 轮；设 5~20 则约 100~400 轮 |
| 🟢 低 | `alphaVMultiplier` / `stickyEmotions` 仍未进引擎 | 潜意识调制目前只用了 `valenceBias`/`arousalBias` |
| ✅ 已解决 | 记忆图谱未收 episodic 节点（v1.14） | 形成即入图 + 启动 `backfillEpisodicNodes()` 补历史孤儿（已归档不补、幂等）。**长版见 docs** |
| ✅ 已解决 | 记忆层「基线 argmax」+「算完就丢」（v1.20） **长版见 docs** |
| ✅ 已解决 | 「她记得的事」用的是模板（v1.21/v1.22） **长版见 docs** |
| ✅ 已解决 | 静息基线不随人设走 + 长周期漂移零调用（v1.23） **长版见 docs** |
| ✅ 已解决 | 两个「静息」互相矛盾（v1.24） **长版见 docs** |
| ✅ 已解决 | 「被激起」的参照物：本性 → 她最近的常态（v1.25） **长版见 docs** |
| ✅ 已解决 | 「写好 + 有测试 + 从没接线」的导出清理（v1.19） **长版见 docs** |
| ✅ 已解决 | 端到端验收「她的情绪改变了她的话吗」+ 两处修复（v1.27） **长版见 docs** |
| ✅ 已解决 | `presence` 恒为 0 的追查 + 两处落地（v1.29） **长版见 docs** |
| ✅ 已解决 | 中等强度负面话"她越不接"（v1.31） **长版见 docs** |
| ✅ 已解决 | 她逐字重复上一轮那句话（v1.32） | 走**生成后查重 + 定向重写一次**（`antiRepetition.ts`，0.7）：**0/8**、护栏不动；`DISABLE_REPLY_DEDUP=true` 回退。⚠️ v1.45 复核：生产口径没问题（命中 0/15），当年那条"逐字重复组数"是坏量具 |
| 🟡 中 | **v1.32 查重漏掉"小句级复读"**（v1.46 挖出） | `findDuplicateReply` 比**整条 vs 整条**（0.7）⇒ 一条 18 字回复里嵌着上一句 27 字里的 10 个字，相似度只有 **0.19**，记 0/15。⇒ 要治得改度量（按小句/最长公共子串比；`topicAnchor`/`memoryGrounding` 有现成做法），**需要单独决策**（会改一条已上线通路） |
| ✅ 已解决 | 决策上加一个零样本 Laya 模型（v1.33，**默认 off**） **长版见 docs** |
| ✅ 已解决 | 阈值可被提议 + 反事实重放（v1.34，**只调阈值不动结构**） **长版见 docs** |
| ✅ 已解决 | 判官校验：回路的第一块地基（v1.35） **长版见 docs** |
| 📖 只读建模 | 低谷期时长（v1.37） | 落地撞上的不是策略而是**时标**：判定都逐轮，答得出"她此刻沉不沉"、答不出"她沉了多久"。`lowPeriod.ts`：进 0.12／出 0.05（**故意不同** ⇒ 施密特触发）／趋势死区 0.01；读**落定**状态 ⇒ 单轮推一下不立"一段"。**长版见 docs** |
| ✅ 已上线 | 低谷期「不主动发消息」（v1.40 推后 + v1.44 配额） | 第一版杠杆（抬动机门槛）被预演**物理性否掉**（可达带仅 ~0.07 宽）⇒ 改成**推后**（120→240 分钟）＋**每日上限 2→1**；真管道两跑均达标，静息对照照发（=「降低但不是没有」）。⚠️ 既有事实：persona `proactiveThreshold ≥ 90` 今天就永远发不出。**长版见 docs** |
| ⏸️ 未落地 | 低谷期「准许低位」片段（v1.38） | 两跑：高能档 **7:0 下降 p=0.016**，但主终点接住率 p=0.344、在场词 3→0 ⇒ 未达标。待人工定：13–17 字是"接住了"还是"像敷衍"。**长版见 docs** |
| ⏸️ 已结案 | 评价结论送进 Prompt（v1.47） | 修好了**投递**（消费者原本只有 `/state`），操纵检查干净；36 格真管道：主终点 `dread` **两臂 0.00（又选了没余量的终点）**、`echo` −0.20 ⇒ 未达标、默认关。⚠️ 与动机块**信息冗余** ⇒ **"这个对象没有消费者" ≠ "这个信息没送达"** |
| ⏸️ 未落地 | 低谷期「不追问」走**动机层**（v1.39） | 新增一条**只看她**的让位路，复用 v1.30 的 `omit`。三臂＋静息对照、操纵干净，**结论与预期相反**：追问 +0.33、字数 +15.5 ⇒ **"少追问"的杠杆不在动机层** |
| ⏸️ 未落地 | Rule 1 **只看强度不看方向**（v1.36） | 病灶真（好事 joy 被"她已沉⇒安静陪着"劫持），重放里精确（4/20 条翻、全正面）、**但真管道没量到收益**（`cheer` 1.25→1.00）。人设裁定后定性变了：**方向反了** —— 那等于要她用自己没有的情绪去服务他的好消息。`ENABLE_STRATEGY_DIRECTION` 默认关 |
| ⏸️ 已结案 | 低谷期「少追问」改走**策略片段**（v1.42/v1.46，五跑） | 最好一轮 `questions` **1.20→0.60（7:0 p=0.016 ✓）**、字数 78% ✓，但 `echo` 0.93→0.67 等护栏各差一点 ⇒ 未达标。**结构原因**：本管道里**"追问"就是"接住的载体"** |
| ✅ 已解决 | **"复读机"那把尺子是坏的**（v1.45） | 三次"未达标"共用一条**二值**护栏；离线重打分证明同一输入本来就"中等同形"（0.47）、两把生产尺子两臂**没差**。新建 `replyDiversity.ts` + 源码守卫 |
| ⏸️ 未落地 | **状态进 Prompt 的读法仍是绝对值**（v1.47 → v1.48 修好但**没量到收益**） | `buildEmotionContext()` 用绝对值排序 ⇒ **每轮**都对她「主导情绪: calm」。修法做完（`ENABLE_ACTIVATION_STATE`，默认关），**两跑都没量到她的话有移动** |
| ✅ 已结案 | 「把她的状态写进 Prompt」到底管不管用（v1.48，两跑） | 与 v1.47 合起来：三次加描述性状态文本**她的话都没动** ⇒ **描述性文本不操纵她的话**；真正操纵她的是末尾的**动机块与策略片段**。反过来她的状态**能**改变她的话——走**决策路径**（v1.27） |
| ✅ 已上线 | **「她自己的状态」这条动机（v1.49/49b/49c）** | 预演先推翻我的推论（门槛 0.25 在可达带外、紧迫度是**常数 0.40**）。修法：①实例级 `base`＋连续映射（0.10→0.44、0.28→0.72，**低于 `open_loop`**）②**着色**文案③内容走 v1.10 **具体化**。**四跑**：机制 8/8｜主终点 **4%→67%（15:0, p=0.000）**｜频率仿真 **2/20** ⇒ 正合「主动性降低但**不是没有**」 |
| ✅ 已解决 | **`state` 的内容来源是固定模板**（v1.49c） | `SPECIFICIZABLE_KINDS` 加 `state`（**禁外部事件名词** ⇒ 防编造她并没有的生活）；`hasStateMotive()` 防"两句自述同时在池里"。单测 19→26 |
| ⏸️ 未落地 | **动机引导语按类型分派**（v1.50/v1.50b） | 把「**问**它的具体下文」从回忆/愿望/态度上拿掉。**两跑同向未达标**；⚠️ **负对照（块逐字相同）问句也 +0.38** ⇒ 噪声地板 ~0.4、"否定式点着了追问"**证据不足** |
| ✅ 已解决 | **`memory_echo` 的内容形态**（v1.54） | `memoryEchoMotive()` 把 `generateProactiveInjection()` 的**元指令**截 60 字贴上"我想起"当成她想说的话（带【】/引号/被截断）。改成从 `eventSummary` 造句（`ENABLE_ECHO_LINE_FROM_SUMMARY`，默认关）。⚠️ 它单独**没**让那件事浮出来（0.13→0.00）—— 真因是 v1.56 的指代歧义 |
| ⏸️ 未落地 | **动机块「理由形状」**（v1.55） | 假说"内容缺动机力"⇒ 加理由＋表达倾向。**24 格**：操纵通过；**主终点 0.42→0.25 未达标且反向**；⚠️ **尺子本身坏了**（信号 100% 来自普通副词「一直」）；⚠️ 两臂各 12 格**只有 1 种开场**、提海 0/24。**长版见 docs** |
| ✅ 已上线 | **动机块「指代消歧」＝那堵墙找到了**（v1.56，**两跑**） | 「问的应该是**这件事**的具体下文」指代**歧义** ⇒ 模型读成**他刚说的那件**（阳台 24/24）、**她挂的那件**（海）0/24。改成"这一件是我**自己**的事／跟他刚说的不是同一件／我想**把它说出来**"。**两跑 24 格**：操纵三条全过（**Prompt 除块外逐字相同 12/12**）；`targetEventMention`（**零 LLM 结构尺子**）**0/12→11/12**（p=0.001）＋**0/12→12/12**（p=0.000）⇒ **合并 23/24 vs 0/24**；字数 +43~47%。形态：**先接他的阳台、再端出自己的事**。⚠️ 块内一次动了四件事 ⇒ 是**框架**，各占多少没分。⚠️ **类型门**：只放 `memory_echo` |
| ✅ 已上线（真管道） | **`action → selectedStrategy`**（v1.57 → **v1.58 真管道跑通**） | 3 臂 × n=8：`share→share` 8/8 ｜ `ask→explore` 8/8 ｜ `wait→accompany` 8/8，**护栏 24/24**（每格提交=1、事件=1）。开关默认**关**（上线与否待定，见 v1.58 行）|
| ✅ 已解决 | **`Motive → Strategy` 曾卡在"执行顺序"**（v1.57 量出） | 策略先选、动机后算 ⇒ 策略层看不到本轮动机。⚠️ v1.58 查明真形状是**一个环**，见下 |
| ✅ 已解决 | **抽出无副作用的 `resolveTurnMotive()`**（v1.58） | 候选构造（未完待续／记忆回响／价值立场／内在状态）＋ `selectMotive()` **逐字搬**进 `server/services/turnMotive.ts`（**纯函数、零副作用**）；**账本更新提出去**成一轮里恰好一次的显式步骤（否则"协调器算一次、server 复用一次"会**重复记账**）。`moderateDeferEnabled()` 同步搬进 `motive.ts`（不许两份实现）。**1446 tests 全绿且一条测试没改** ⇒ 行为保持 |
| ✅ 已解决 | **⚠️ 管线里有一个环：`策略 → 回忆 → 动机 → 策略`**（v1.58 → **已破**） | `decideProactiveRecall` 依赖策略，其产出喂动机，而动机本该喂策略 ⇒ **环**。破法=**两阶段 + 计算/提交分离**：`computeStrategyPlan()`（零副作用，可多次）／`commitStrategyPlan()`（一轮一次）／`processTurn({deferStrategyCommit:true})` 只算临时策略给回忆闸门／`commitFinalStrategyWithMotive()` 定稿并**一次性提交**。**长版见 docs（含 8 条 Causal Ordering Invariants）** |
| ✅ 已解决 | **动机块「这件事」的指代歧义**（v1.55 量出 → **v1.56 修好**） | 「问的应该是**这件事**的具体下文」被模型解析成**他刚说的那件**（阳台 24/24），而不是**她挂的那件**（海 0/24）—— 这就是 L3 的真因。修法见上一条 v1.56（**23/24 vs 0/24**）。⚠️ 未分解的残余：同段那句逃生口「…**可以下一轮再提**」与"指代消歧"是**一起改的** ⇒ 各占多少没量 |
| 🟡 中 | **量具：`一直` 不能当"关系意义"标记**（v1.55 自曝） | 预定主终点 `/海|一起|共同|经历|见证|一直|记得/` 的命中 **100% 来自「一直」**（"我一直觉得阳台挺神奇"）。⇒ 同族第 4 次：**先查指标词在普通行文里的出现率**，再进判据 |
| ✅ 已解决 | **"回忆/态度"那块动机从没进到她的话里**（v1.50b/v1.54 三形态全零 → **v1.56 修好**） | 试过三种内容形态（元指令／干净标签／造句）**全零** ⇒ 当时以为是"改写法解决不了"。**真因是 v1.56 的指代歧义**（模型把"这件事"读成他那件）⇒ 修好后 **23/24 vs 0/24** |
| 🟡 中 | **A/B 的`questions`指标在 n=8 下噪声 ~0.4**（v1.50b 用负对照量出） | `k1` 两臂动机块**逐字相同**（同一 Prompt），问句却 1.63→2.00 = **+0.38**。⇒ 该指标的噪声地板就在 ±0.4；凡是效应量小于它的判据（如 m1 的 +0.63, p=0.063）都**不能当结论**。对策：这类终点要么加样本（n≥24），要么像 v1.45 那样换更稳的尺子 |
| ✅ 已上线 | **动机门槛改看"加权前"**（v1.52） | 分工：门槛答"**值不值得开口**"（情境，含重复惩罚）／权重答"**够格的里谁最该说**"（排序）。修 v1.51 量出的病（下界 0.5 把 `curiosity` 0.26 / `stance` 0.23 压到门槛 0.28 之下）。零 LLM：七类**全部可达**；真管道三格两跑操纵全过，主终点合并 **10:0, p=0.002**。⚠️ 幅度不稳（A 臂 0.13 vs 0.50）⇒"更常开口"非"每次都开口"。**长版见 docs** |
| ✅ 已上线 | **「他接住了她这句话吗」按类型分派**（v1.53） | 老判据只有"共享实词锚点"一条 ⇒ 非话题型 `landed` 结构性恒为 0（`wish` 29/0）⇒ 权重被罚到下界。改**双通道 OR**。**冻结 25 条标注**：52%→**88%**；真管道 48 格读账本：A 全 0 / B 全 1（8/8） |
| ✅ 已解决 | **学习回路把 `curiosity`/`stance` 关在门外**（v1.51 → v1.52 绕过 → **v1.53 治本**） | 真实账本 `wish` 29/0、`curiosity` 10/0、`stance` 3/0 ⇒ 权重全 **0.50** ⇒ 过不了门槛。v1.52 改门槛看加权前、v1.53 治信号本身 |
| 🟡 中 | **「她的状态」该当"话题"还是"着色"**（v1.49） | 当话题会把他那件事挤掉；独立一块着色被稀释（v1.48）。基线臂自发出现过理想形态 1/8。⇒ 候选：**把着色放进动机块内部** |
| 🟡 中 | **A/B 的操纵检查有一条不可能 100%**（v1.48） | LLM NLU 两次分类可能不同（实测 26/28 = 93%）⇒ 放宽到 ≥90%，或钉 `DISABLE_LLM_NLU=true`（换 regime，不能与历史跑对照） |
| 🟡 中 | **harness"按内容词认动机类型"第 4 次咬我**（v1.50b） | 规律：**认类型要认表头/专属文案，不要认内容**（`state`、s1 stance 都栽在这。多次） |
| 🟡 中 | **A/B harness 与生产 Prompt 差 5.7 倍**（v1.47） | **1771 字** vs 生产 **10112 字** ⇒ 叠加稀释 ⇒ **harness 结果不能默认可搬到生产**。对策：新 A/B 两臂都带 persona 并记录 Prompt 长度 |
| 🟡 中 | **第一句开场被另一个机制钉死**（v1.56，**独立实验**） | 两臂**各 12 格只有 1 种开场**（「阳台收拾出来是什么样子的」**24/24**）；v1.56 修好指代后**第一句仍然一样**（变的是她**之后**加什么）⇒ 开场由**另一条**（提示词层）机制固定。**按纪律不顺手修**，登记为 `Prompt Lead-Anchor` 单独定性 |
| ✅ 已解决 | **服务端从不做时间衰减**（v1.41 → v1.43 修好） | `processTimeDecay` 只有前端在发 ⇒ 一周与一天一模一样。v1.43 接在协调器阶段 0，`DISABLE_SERVER_DECAY=true` 回退；旧臂极差 0 → 新臂 0.060/0.046/**0.043**。加 `closedBy: self/idle` |
| ✅ 已解决 | 让位那段话：**整块不给**（v1.30，真管道三档裁定） | **长版见 docs** |
| ✅ 已解决 | 「让位」的同款病 + 曾给锚（v1.28；②已在 v1.30 退役） | ① `shouldDeferToUser` 改读**本轮开始前**的激活量 ≥ `DEFER_HER_SINK`(0.12)；② 让位时借一条 `open_loop` 当锚 —— 实测把"陪着他"变成"处理那件事"，已退役。**长版见 docs** |
