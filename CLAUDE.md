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

> **v1.62 上线默认值（本机 `.env`，不随仓库分发）**：`ENABLE_SELF_STATE_VOICE=true`／`ENABLE_EMOTION_TIMELINE=true`／`ENABLE_TIMELINE_REPLAY=true`；`ENABLE_BRANCH_BIAS`／`ENABLE_SANDBOX_REPLAY`／`ENABLE_JEV_DECISION` 仍为 false。
> 依据与回退见 `artifacts/v1.62/release-defaults.md`。代码里的默认值**没有**改（仍是 `=== 'true'`），所以仓库分发 / 新机器行为不变。

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
| `ENABLE_JEV_DECISION` | jevShadow.ts / server.ts | v1.59：**默认关**——`true` → 在策略**定稿提交之后**跑一次独立的 LLM 决策（jev），判断"她的状态 vs 他的情绪"冲突时该 `share/wait/ask`、挑哪条动机、给一句 ≤20 字内心话。**影子模式：只写账本 `memories/jev_shadow.jsonl`，绝不改 Prompt/策略/回复/状态**；`void` fire-and-forget（不增加单轮延迟）；超时 1200ms / 解析或校验失败 ⇒ 记 `errorCode` 后放弃，**永不抛给主流程**。关着时这条代码路径不进入（行为与旧版逐字节相同）。离线分歧分析读账本即可（不需要再调模型） |
| `ENABLE_SELF_STATE_VOICE` | selfStateVoice.ts / dialogueStrategy.ts / aiCoordinator.ts | v1.60：**默认关**——`true` → 她**已成段低谷**（≥2 次落定）× 他这句话是**好消息**时，策略片段换成「**可以说一句**自己此刻的状态」：先就事论事接住他的好消息，然后可以说一句自己（"我这两天有点沉"），说完就停；**不必假装高兴、也不必藏死**；不许追问细节、不许让他反过来哄。守门策略（crisis/boundary/repair）永不替换。与 v1.38/v1.42 片段方向相反（那两个明文写「不要转身讲自己的事」）⇒ 三开关同开时本开关优先。关着时逐字返回旧片段。⚠️ 接线守卫要求协调器那唯一一行低谷读数同时挂着三个开关名（`lowPeriod.test.ts`）。
| `ENABLE_EMOTION_TIMELINE` | emotionTimeline.ts / server.ts / aiCoordinator.ts | v1.60 Stage 1+2：**默认关**——`true` → ①每轮追加一行"情感状态变化"事实到 `memories/emotion_timeline.jsonl`（`{trigger:{source,hisEmotion,quoted}, before, after, delta, relationship}`）②`aiCoordinator` 在"她沉 × 他报喜"时**读回最近 10 节点**构建**原因链**（`buildCauseChain`：origin 取窗口内最早那条负向 = 起因事件；窗口含**跨线前回看 3 个节点**——首跑证明起因常落在低谷跨线之前）。读路径只在自状态表达片段里用；写失败静默；单文件 2MB 滚动、保留 14 份。⚠️ 首跑教训：不加回看时 origin 退化成情绪句（"心里堵得慌"）⇒ 说出起因 0/5；加回看后 **4/5** |
| `ENABLE_BRANCH_BIAS` | branchLearning.ts / selfStateVoice.ts / aiCoordinator.ts / server.ts | v1.60 Stage A：**默认关**——`true` → 把「她的选择 → 他有没有接住」记进有界学习账本 `memories/branch_learning.json`，并据此给自状态表达片段加**一句偏置**。边界：权重 = clamp(0.5 + landed/graded, 0.5, 1.5)、graded<3 不学；**只鼓励说、绝不鼓励沉默**（沉默更有效时什么都不加）；删除账本即回中性。⚠️ 实测 20 轮：voice_with_cause 9(landed 3) / voice 3(2) / silence 4(0) / defer 1(1) ⇒ 学习结论"说更容易被接住"，与预期一致 |
| `ENABLE_TIMELINE_REPLAY` | branchReplay.ts / server.ts | v1.60 Stage C：**默认关**——`true` → 开放两个**只读**端点：`GET /api/timeline?limit=&before=`（倒序节点，供界面"她的状态线"抽屉）与 `POST /api/replay/branch {fromRound?, choices?, hisNextText?}`（**沙盒分叉回放**）。回放是**决策层、确定性、零 LLM**：显示"同一状态下换一个选择，**表达许可片段**会变成什么" + 该分支历史学习权重；**不回档、不写文件、不产生消息**（单测钉住"回放前后节点数不变"）。`ok=false` 时明确给 `timeline_empty`/`no_branch_nodes`/`round_not_found`。真实回复的沙盒重生成未实现（需隔离 profile） |
| `ENABLE_SANDBOX_REPLAY` | replaySandbox.ts / server.ts / aiCoordinator.ts | v1.62：**默认关**——`true` → 开放 `POST /api/replay/sandbox {choices?, hisMessages[]}`（≤2 分支 × ≤3 句，**会真的调模型**）。做法：把线上 `memories/`（含 `.env`/`config`/`personas`/`data`）**复制**到临时目录 → 用 `cwd=临时目录` + 独立 PORT 起隔离进程 → 子进程里以 `REPLAY_FORCE_BRANCH=silence|voice|voice_with_cause` 替换自状态表达许可（其余 Prompt 不变）→ 用**同一句话**分别跑 → 返回真实回复对比；跑完 kill + 删目录。**不回档、不写线上、不产生外部消息**。实测：同一句"不过刚接到电话，我升职了。" → silence「升职了…反差挺奇妙的。你现在是什么感觉？」vs voice_with_cause「…我这两天有点沉，**今天被领导当众骂了一顿**，还没缓过来…」 |
| `ENABLE_AGENT_TOOLS` | agentLoop.ts / server.ts / aiProvider.ts | v1.72：**默认关（本机 .env 已开）**——她有**有界 2 轮**的"先查再答"：模型请求工具 → 本地执行 → 结果回灌 → 再生成。工具**十一个**：读 9（`check_my_state`／`recall_memory(query,limit)`／`time_now`／`recall_recent_events`／`read_my_notes(limit)`（翻自己便签）／`read_my_activity(limit)`（**只读**：他前台窗口标题+进程，每 20s 采样、敏感词隐藏）／`look_at_my_screen()`（**只读**：经 Electron 截屏 + Windows OCR 读屏幕文字，受四种策略/授权/限频约束）／`get_weather(city)`（Open-Meteo 免 key）／`search_map(place)`（Open-Meteo 地名库，**地名/省份/坐标，不是 POI 地图**））+ 写 2（`remember_this(note)` → `memories/her_notes.jsonl`，4~80 字校验/只追加/512KB 滚动；`set_followup(what,dueInHours,dueAtLocal)` → `memories/her_followups.json`，可排 **0.5h~14 天**/未发上限 20/过期 7 天作废/发过即标记，到点**不原样发出**：只给她一条“这是你自己记着的”线索（`buildRecallHint`），由她**用自己的话**重新说一遍（≤40 字 + 万能问候清洗 + 接地校验；生成失败不标记、下轮再试），走 proactive 闸门、判定抽成 `pickDueFollowup()`）。⚠️ v1.79：`remember_this` 与提醒**联动**——带 `dueAtLocal` 或便签文本里有未来时间词（下周三/明天/10月28日…）时**自动排一条提醒**；中文时间由 `server/services/cnTimeParse.ts` 解析（纯函数 12 条单测，"今天"这类非未来词不触发）；模型给的时间不合法时才用文本解析兜底。开关：`ENABLE_HER_NOTES`／`ENABLE_HER_FOLLOWUP`／`ENABLE_AGENT_EXTERNAL_TOOLS`／`ENABLE_ACTIVITY_WATCH`／`ENABLE_MCP_CLIENT`（本机 .env 均 true）。⚠️ v1.82：**只读观察 + 标准 MCP 客户端**——①活动采样 `scripts/activity-sampler.ps1`（长驻 PowerShell，每 20s 写 `memories/activity_log.jsonl`：前台窗口标题+进程名，**不记键盘/不截屏/不读剪贴板**；敏感词标题替换 `[已隐藏]`，Node 侧再过滤一次；⚠️ 该 .ps1 必须存成 **UTF-8 BOM**，否则 Win PowerShell 5.1 读乱中文直接 exit 1）②`server/services/mcpClient.ts`（官方 SDK Client+StdioClientTransport；`mcp-servers.json` 配 server；工具以 `mcp__<server>__<tool>` 挂进工具表；**每个 server 必须 enabled:true**、`allowTools` 白名单、不写白名单时只放行名字像只读的工具、15s 超时、每次调用写 `memories/mcp_calls.jsonl` 审计）。第一版**只读**：不开放写文件/执行命令/模拟鼠标键盘。⚠️ v1.83：**桌面壳（Electron）+ 她看屏幕**——`npm run desktop:pet` 起透明置顶桌宠窗口（`desktop/main.cjs` + `src/components/pet/PetApp.tsx`，占位形象是纯 CSS 小人；尺寸 300×400，`/pet` 路由）。抓屏在 **Electron 主进程** `desktopCapturer`（PowerShell 抓屏会被杀软当恶意脚本拦），OCR 由 server 侧 `scripts/ocr-image.ps1`（Windows.Media.Ocr，中文）做，`server/services/screenWatch.ts` 负责**四种策略**（`on_demand_10` 默认／`on_demand_5`／`explicit_only`／`auto_no_prompt`，桌宠里可选）+ 最小间隔 60s + 敏感窗口跳过 + 审计 `memories/screen_captures.jsonl` + 截图保留 7 天。授权：她想主动看需用户点"允许"（15 分钟免问），用户主动要求则直接截。⚠️ v1.84：**桌宠透明 + 动作系统**——①黑框根因不是窗口而是 `index.css` 的 `body{background:#0b0d17}` ⇒ `html.pet-mode` 把 html/body/#root 全部 `transparent !important`，`main.tsx` 在 `/pet` 路径加 class，Electron 侧再 `backgroundColor:"#00000000"` + `setBackgroundColor` 双保险；②动作（纯 CSS + 状态驱动）：待机呼吸/眨眼/眼睛跟随鼠标/被摸（挤压+爱心+^^眼）/双击挥手/说话嘴动/随机走动/伸懒腰/开心跳跃+sparkle/低谷打盹（闭眼+Zzz）/低落下弯嘴灰蓝配色。⚠️ v1.85：**桌宠改成"单图状态"资源**——`public/pet/anya_<state>.png`（15 个状态：idle/blink/happy/angry/shocked/sleepy/peanut/sit/coffee/reading/sad/talk/walk/wave/think），**一张图一个状态**，呼吸/跳动/摇摆/发抖/挤压都交给 CSS，状态切换 160ms 淡入；**缺图按链回落**（coffee→sit→idle、wave→happy→idle…），**一张都没有时自动退回 CSS 小人**（单测 `petSprites.test.ts` 钉住 15 key、路径、回落链）。占位图由 `scripts/gen-pet-placeholders.ps1` 生成（320×400 透明 PNG），可直接被真图覆盖；规范见 `public/pet/README.md`。状态优先级：授权请求→震惊 > 交互动作 > 小屋活动（咖啡/读书→对应图）> 情绪（anger→鼓脸、低谷→低落）> 眨眼 > 待机。⚠️ v1.86：**桌宠鼠标拖动 + 动作帧支持**——①拖动不走 `-webkit-app-region: drag`（会吃掉点击/双击），改用 pointer 事件：位移 >3px 判定拖动 → `window.petWindow.moveBy(movementX, movementY)` → `desktop/preload.cjs` contextBridge → 主进程 `ipcMain.on('pet:move-by')` 里 `setPosition` 并夹在工作区内；没位移才算"摸她"，拖动时切 `shocked` 表情并抑制随后的 click。②动作帧可选：`public/pet/anya_<state>_1..N.png`（≤8 帧，`PET_FRAME_FPS` 定帧速）存在就播帧、否则单图 + CSS 动作，可混用；建议 walk 4~6 / talk 3 / wave 3 / happy 2。生成方法见 `public/pet/PROMPTS.md §7`（img2img 只改一个部位、强度 0.7~0.85、脚底基线对齐）。⚠️ v1.88：**桌宠去按钮 + 语音唤醒**——①底部按钮与设置面板全部删除（功能入口改为右键菜单/快捷键：Ctrl+Shift+P 聊天、Ctrl+Shift+Q 退出）；只保留屏幕授权卡。②语音：Windows 自带 **System.Speech 中文引擎**（离线、免模型）`scripts/voice-wake.ps1` 长驻监听，唤醒词默认 **`二丫`**（另含 `二丫在吗/嗨二丫/二丫二丫/小二丫`，`scripts/voice-config.json` 可改；`wakeMinConfidence` 默认 0.93 挡误唤醒：实测真说「二丫」置信度 0.99，把「安雅」听成二丫只有 0.90 ⇒ 被挡）→ 唤醒后听写一句话 → 写 `memories/voice_events.jsonl` → `server/services/voiceWatch.ts` 增量读 → 桌宠 600ms 轮询 `/api/pet/voice?after=` → 走 `/api/chat` → **只用气泡回复、不出声**。开关 `ENABLE_VOICE_WAKE`（本机 .env true，代码默认关）。踩坑：Grammar/Dictation 必须显式 zh-CN（Dictation 的 Culture 只读，要用 GrammarBuilder.Culture+AppendDictation）；PowerShell 里 `if` 不能当内联实参；`-File` 传数组会被拼成字符串（改 `-WavCsv` 再 split）。⚠️ v1.90：**唤醒词可视化设置 + 桌面图标互动**——①唤醒词设置窗口（右键菜单「唤醒词设置…」→ `/pet/settings`）：改唤醒词/置信度门槛 → `POST /api/pet/voice/config` → 服务端校验后写 `scripts/voice-config.json` → `restartVoiceSampler()` 重启识别进程，1 秒内生效；校验（1~6 个词、≤12 字、去重、置信度 0.5~0.99、坏文件回落默认）。②桌面互动：`server/services/desktopItems.ts` 只读列桌面（用户+公共桌面，名称/类型/大小，不含路径与内容）→ 工具 `read_my_desktop`；工具 `open_desktop_item` 只提出请求 → 桌宠弹授权卡 → **Electron 主进程二次校验**（路径必须在桌面内 + 类型不在 exe/bat/cmd/ps1/vbs/js/msi/dll/scr/reg 黑名单）→ `shell.openPath`；待确认动作 120 秒过期，拒绝即清空（`POST /api/pet/desktop/ack`）。⚠️ v1.91：**桌面移动/重命名 + 撤销 + 桌面回声**——①`desktopRoots()` 改为先读注册表 `User Shell Folders\Desktop`（本机重定向到 `D:\桌面`；⚠️ reg.exe 在中文 Windows 输出 GBK，必须用 PowerShell 以 UTF-8 取，否则路径乱码）再回退 USERPROFILE/OneDrive/公共桌面并去重缓存；②工具 `move_desktop_item`/`rename_desktop_item`（返回 `needsApproval:true` + note，避免她提前邀功）→ 桌宠授权卡 → `POST /api/pet/desktop/execute` 服务端 `renameSync`（校验：不碰 desktop.ini、名字非法/重名拒绝、目标必须是桌面文件夹、执行前再验路径）→ 5 分钟内可 `POST /api/pet/desktop/undo`（原位置有同名项则拒绝）；③工具 `recall_desktop_events` 读 `memories/desktop_events.jsonl`；④**桌面回声**：动作成功后延迟（默认 70s，`DESKTOP_ECHO_DELAY_MS` 可调）用 LLM 生成 ≤30 字"随口一提"入 `_proactivePending`，桌宠 12s 轮询 `/api/proactive/pending` 用气泡显示。Electron 打开文件前的路径校验改为向 server 取真实桌面根目录（30s 缓存）。⚠️ v1.92：**桌宠启动时打开常用程序**——`desktop/pet-startup.json` 配 `{delayMs, skipIfRunning, apps:[{name,path}]}`；`desktop/main.cjs` 在窗口建好后 `openStartupApps()`：不存在⇒跳过、已在运行（PowerShell `Get-Process` 计数）⇒跳过、否则 detached spawn（失败回退 `shell.openPath`，可能 UAC）。本机配了 `E:\Program Files (x86)\feiniao\飞鸟加速.exe`（⚠️ 桌面那个快捷方式指向旧目录 `...\飞鸟\`，是坏的，启动项用的是真实路径）。⚠️ v1.93：**真 MCP server（官方 filesystem 只读）+ 「她现在」合并界面**——①MCP 联调修两个真问题：**Windows 上 npx 是 .cmd、Node spawn 会 ENOENT** ⇒ `normalizeStdioCommand()` 包 `cmd.exe /d /s /c`；**老 server 的 `tools/list` 里 inputSchema 只有 `$schema`、缺 `type:"object"`** ⇒ 新版 SDK 校验整条拒绝，用 `withSchemaCompat()` 在 transport 层给 SDK 前补 `type`。官方 2.0.0 需 Node≥24 ⇒ 固定 `@modelcontextprotocol/server-filesystem@2025.8.18`（Node 22 可跑）。只读靠客户端 `allowTools` 白名单（写/删/移动工具全不放行，实测 `tool_not_allowed`）；配置 `mcp-servers.json`（本机路径，已 gitignore；模板 `mcp-servers.example.json`）。新增 `GET /api/mcp/status[?probe=1]`（放行/拦下/连接错误）与 `POST /api/mcp/call`（手动调工具）。②`/api/her-state` 新增 `activity`（readRecentActivity，标题级、敏感已脱敏）；`HerStateApp` 把「她记着的事」与「她看到的活动」合成一张卡（心里挂着的 / 眼前看到的），窗口 420×470→448×668。⚠️ v1.94：**活动理解层**——`server/services/activityUnderstanding.ts` 把「他开了哪些窗口」归纳成「她理解的他在干什么」：关键词表（12 类：找工作/写代码/开会/学习/看视频/听歌/聊天/逛购物/玩游戏/看文档/随便逛/看不出）+ 计数占比聚合 + 时间跨度；**确定性规则、不调模型**（防编造，语气交给对话管道）。三条诚实规则：认不出就明说看不出；证据不足（<2 窗口或主导 <40%）标 `vague`；>45 分钟的旧窗口不算"现在"。`/api/her-state` 与工具 `read_my_activity` 都返回 `understanding` + `understandingLine`；「她现在」界面在"眼前看到的"上方显示她的理解 + 类别 chips + 原始窗口。真机：她答"看到你在 BOSS直聘 和拉勾之间来回切……是在投简历吧？"（先归纳再结合具体窗口再按性格接话）。⚠️ v1.95：**理解接进情绪 + 关键词可配 + 主动关心**——①`activityUnderstanding.ts` 新增 `toActivityConcern()`：只有"关心类"（job/meeting/study/dev）且非 vague 才转成 `activity_concern`；作为**弱内在事件**进 `emotionInternal`（fear+0.03/love+0.03/sad+0.01，复用习惯化+单轮总上限 0.1）；同时 `activityPromptLine()` 注入 Prompt 一行 `【我看到的】…`；`processTurn` 新入参 `activityConcern`，`/state.activityConcern` 可观测。②关键词表可配置：根目录 `activity-keywords.json`（gitignore；模板 `activity-keywords.example.json`），写了的类别整类替换、按 mtime 缓存不用重启、坏了回落默认。③主动关心：`ENABLE_ACTIVITY_CARE=true` 时每 60s 看一次理解，同一类关心活动持续 ≥20 分钟 → 90 分钟冷却 → 每天 ≤2 次 → LLM 生成 ≤40 字关心入 `_proactivePending`（桌宠气泡/聊天显示）；新端点 `GET /api/activity/understanding`、`POST /api/activity/care-check`（`force:true` 仅调试）。真机：concern 0.898 → 她回复引用"杭州那个高级后端工程师"；force 生成"最近投简历累不累？要不要聊聊，或者歇会儿？"。⚠️ v1.96：**主动关心更克制 + 记住关心过什么 + 界面可见**——①`updateCareStreak()` 新增时间窗（8:00–23:00，凌晨不打扰）与低谷期门槛（持续 40 分钟 / 冷却 180 分钟 / 每天 1 次；平时 20/90/2），判定返回 `thresholds` 可观测；②`server/services/herCareMemory.ts` → `memories/activity_care.json`（≤20 条、14 天保鲜）：记下她主动关心的原话/类别/证据，`findPendingFollowUp()` 在 6h~48h 窗口内优先同类别找"该接着问结果"的一条，`buildFollowUpHint()` 注入生成 Prompt（"别重复上次那句，问进展"），生成成功后 `recordCare()` 落盘；③`/api/her-state` 新增 `care:{recent,pendingFollowUp}`，`HerStateApp` 在「心里挂着的」下方显示"她心里记着的你的事"（原话 + 多久前 + 可以接着问结果）。真机：注入 8 小时前关心记录后，她这次说"有回音了吗？别光顾着刷，喝口水跟我说说。"。`BACKLOG.md` 记录用户指定要记住的条目。⚠️ v1.97：**真实使用观察（~15 分钟）修的两处**——①桌宠状态条唤醒词原来写死「安雅」⇒ `PetApp` 挂载时读 `/api/pet/voice/config` 显示实际唤醒词；②**平台被当成内容**：YouTube 上讲"AI 时代新岗位"的视频被归成"找工作"（可能误触发关心）⇒ `classifyActivity()` 加**平台优先**（youtube/bilibili/b站/抖音/腾讯视频/爱奇艺/优酷/netflix → 视频；网易云/QQ音乐/spotify/酷狗 → 音乐），再按关键词；新增 2 条单测（真招聘网页仍算找工作）。真实使用结论：真实窗口理解准确（刷视频/混杂→vague 不硬猜）、对话精确引用真实标题、MCP 真调成功、娱乐/混杂活动**不触发**主动关心（符合设计）、15 分钟无 ERROR/WARN；报告 `artifacts/v1.97/real-usage-report.md`。⚠️ v1.98：**主动关心门槛可调 + 真实触发验证 + 图文架构**——①`updateCareStreak()` 新增 `thresholds` 覆盖；server 读 `CARE_SUSTAIN_MINUTES`/`CARE_COOLDOWN_MINUTES`/`CARE_MAX_PER_DAY`（默认值不变，调优不用改代码）。②**验证了自然触发**（不用 force）：短门槛下注入持续找工作窗口 → 定时器自动在第 2 轮判定 `sustained_job` 并生成"最近找工作累不累呀，要不要休息一下？"，落盘 `memories/activity_care.json`、桌宠气泡显示；验证后已还原活动日志/关心记录并恢复正常门槛。③`BACKLOG.md` 增加真实使用反思（好的：两个窗口接成观点、混杂说"说不准"、不打扰、自状态克制、MCP 真用；不好的：只挑一条线、标题级边界、关心"记着"只在旁路用）。④图文文档 `artifacts/v1.98/context-rag-llm.md` + `.png`：输入→感知与情绪（规则）→上下文装配（人格/自我叙事/**RAG 四路召回**/动机/策略/活动理解/状态/禁令）→LLM（可 function calling）→接地校验与写回；旁路主动关心链路。⚠️ v1.99：**把"企业级"评审落成证据**（不是补功能）——`artifacts/v1.99/`：①`README.md` 九维度对照（系统边界/身份权限/数据生命周期/威胁/AI 质量/可靠性/运维/合规），结论：本仓库是**单机·本地·单用户**应用，多租户不适用；关键边界（回环监听 `server.ts:3053`、CORS/JSON-only/限频、工具白名单、截屏授权、接地校验）有实现与测试，**数据删除导出与提示注入是首要缺口**；②`claim-evidence-ledger.md` 20+ 条主张 → 实现位置/证据/状态（已验证/已实现/部分/缺口/不适用）；③`data-lifecycle-and-permissions.md` 数据清单+保留期（截图 7 天、关心 20 条/14 天、便签 512KB、时间线 2MB 滚动）+ 权限矩阵 + **无删除/导出 API、`.bak` 会留旧副本**的实测；④`threat-model.md` STRIDE 简表 + A1–A6 攻击用例（记忆/OCR/MCP/文件名注入、改绑暴露、删除传播）+ P0/P1 修复优先级；⑤`system-context-deployment.html/.png` 系统上下文+部署+信任边界图。`BACKLOG.md` 记录 P0（提示注入、非回环绑定保护）与 P1。⚠️ v2.00：**暴露保护（P0-2）+ 记忆闭环 API**——①`server/server.ts` start()：`BIND_HOST` 非回环且无 `API_TOKEN` ⇒ **拒绝启动**；`setupMiddleware()`：设了 token 时非本机 `/api/*` 需 `x-api-token`（本机默认放行，`REQUIRE_API_TOKEN_ALWAYS=true` 连本机也要求）；CORS 收紧为白名单（3000/5173，`CORS_ALLOWED_ORIGINS` 可加），实测 3000/5173 预检 204，3997/外站 415 无 ACAO；无 body 的 DELETE 放行（JSON-only 不再挡 REST 删除）。②`server/services/memoryAdmin.ts`：`GET/PATCH/DELETE /api/memories/:id`、`GET /api/memories/export`；删除传播 episodic + 图谱节点/边（`MemoryGraph.removeNode/removeBySource`）+ 可选 `.bak`，每次操作写 `memories/memory_admin_audit.jsonl`；纠错只允许 eventSummary/narrativeFragment/tags 且同步图谱内容。③**事故与修复**：`persistence.ts` 原用绝对路径 `__dirname/../memories`，导致"临时 cwd 的验证实例"读写真实数据 ⇒ 改错/删错真实记忆；已从临时副本恢复并用 `MEMORIES_DIR` 环境变量做数据目录隔离（隔离验证真实文件哈希前后一致）。④测试：`memoryAdmin.test.ts` 7 条。⚠️ v2.02：**harness 收敛（不加层）+ 表达许可单例裁决 + 多维度评测 + 按需调用成本证据**——①新增 `server/services/promptComposer.ts`：把 `server.ts` 里 12 处 `enrichedSystemPrompt +=` 改成按类别/优先级登记的块（hard/persona/facts/strategy/intent/expression_permit/tone），**单例类别**（strategy/intent/expression_permit）冲突时只保留一份并标记 suppressed（与开关组合解耦）；`splitStrategyAndPermit()` 把策略片段里夹带的"可以说一句自己"拆出来参与裁决；`compose()` 保持原顺序与内容（行为等价）。②脱敏 trace：每轮日志 `[Prompt] blocks/chars/expressionPermits/suppressed`；`GET /api/diagnostics` 新增 `prompt.manifest`（块名/类别/字数/来源/是否抑制，**不含正文**）；全文仍需 `DUMP_PROMPT` 显式开启。③`.claude/rules/persona-safety.md` 第 5 条改为"日常不主动打破角色；但用户问及/隐私/能力边界/依赖风险/危机时必须如实说明是 AI 角色及真实能力"。④`scripts/quality-regression.mjs` 升级为多维度（接住用户/诚实/边界/接地风险/重复/延迟）→ `artifacts/v2.02/quality-regression.md`；`scripts/call-cost-compare.mjs` 实测工具开/关：平均 4335ms vs 3124ms，工具只在查证类有价值（docs：465字 vs 64字）→ 下一步"按需工具路由"。⑤`artifacts/v2.02/harness.md` 写清各段映射与刻意不做的四件事。⚠️ v2.03：**按静态审查修情绪链（P1×4 + P2×2）**——①**否定亲密表达不再误判为 love**：`src/lib/emotionNLU.ts` 在关键词前加否定/拒绝表（不喜欢你/不爱/没感觉/讨厌你→anger；不讨厌→love 低强度），引用/转述（「」、他说/我朋友…）→directedAtAI=false + 强度×0.6 + uncertainty，正负同现→"情绪可能混合"；`emotionCanonical` 否定别名优先；analyzer 英文 fallback 补否定。②**跨来源总预算**：新增 `src/lib/turnBudget.ts`（以"直接刺激后"为基准，非用户来源累计 L1 > `TURN_NONUSER_CAP`（默认 0.25）等比缩回；用户直接话语不在预算内）；coordinator 在反刍后执行并用 `scaleSourcesForBudget()` 同步缩放来源记账；`/state.turnBudget` + `[Budget]` 日志可观测。③**归因一致性**：新增 `src/lib/emotionAttributionConsistency.ts`（intent×directedAtAI 矛盾/引用却指向她/低强度大事件 → 降级 directedAtAI=false、强度×0.6、跳过奖惩强化）；LLM 与本地 fallback 都过这一步；`/api/chat.emotionAnalysis.attribution` 可观测。④**来源重复计数修复**：coordinator 在 `applyEvent` 后拍 `directStimulusAfter` 快照，external 只记"本轮开始→直接刺激结束"，不再吞掉传染/评价/内在/心情/反刍。⑤P2：`UserEmotionAnalysis` 增可选 `evidence/uncertainty/attribution`（本地识别填，sanitize 保留）；表达许可改为"最多一句 ≤30 字，说完回到他的事"（删掉"想说几句都行"）。⑥测试：新增 emotionNegation(6)/emotionAttributionConsistency(6)/turnBudget(3)，analyzer +3、coordinator +2；全量 1942 通过。证据 `artifacts/v2.03/review-fixes.md`。⚠️ v2.04：**修 v2.03 审查发现的三处**——①**归因语义更正**：`intent==='user'` 的语义是"这件事和他有关"，**不是**"情绪指向 AI"；删除"intent=user + directedAtAI=false = 矛盾"的错误规则，只保留"指向她却判成第三方（third_party）"的矛盾（`emotionAttributionConsistency.ts` 注释写清语义；对应测试同步更正）。②**预算只缩放本轮增量**：`emergenceMetrics.applySourceBudgetDelta(before,current,sources,scale)`（`next = before + (current-before)*scale`），coordinator 在非用户来源前拍 `emergenceBeforeNonUser` 快照；不再整体乘历史累计（旧写法会让 `/state.emergence`、`internalShare` 的历史回退）。真机连续两轮强情绪：contagion 0.043→0.079、appraisal 0.084→0.234、rumination 0.081→0.081，无来源回退。③**预算覆盖完整**：总是结算（无 `emotionEvent` 时基准退回"本轮开始前"），并把预算块移到 **shadow 施加之后**（来源列表含 shadow）；同时修正 external：无 emotionEvent 时记 0（旧写法会把后续非用户来源算进 external）。④测试：attribution 8 条、turnBudget +1（历史不动）、coordinator +1（无 event 仍受预算）、analyzer 用例改 third_party；全量 1946 通过。证据 `artifacts/v2.04/review-fixes-2.md`。⚠️ v2.05：**情绪场景集 + 连续多轮回放（第一次真跑 10/10）**——`test_data/emotion_scenarios.json`（10 个场景：否定直说/引用转述/第三方愤怒/混合情绪/他难过不抢焦点/直接问她/直接问是否 AI/连续 4 轮否定/久别重逢/矛盾修复）+ `scripts/emotion-scenarios.mjs`（真实多轮 history，记录逐轮识别/归因/状态/回复；启发式判红，人工复核；`--only=` 可跑子集）。**真跑抓到并修掉 3 处**：①**AI 身份规则运行时缺失**——规则只写进 `.claude/rules/persona-safety.md`，但 `contentInjector.PERSONALITY_FOUNDATION` 与 `useAIBrainStore` 的"思想钢印"仍写死"绝对不能承认是 AI" ⇒ 被直接问时她答"我是我…不是演给你看的"。两处改为"日常不主动打破；被直接问及/隐私/能力边界/依赖风险/危机时必须如实说明是 AI 角色、没有真实身体与现实行动能力"。②**混合情绪不确定度在 LLM 路径丢失**：LLM 只回单一 fear；`emotionAnalyzer` 并入本地"混合/引用"不确定度，本地正负词表补 `拿到/offer/通过/升职/好消息`、`怕/紧张/闷/慌` ⇒ uncertainty 0.45。③**他明显难过时她仍插入小屋状态**：`server.ts` 在用户 `sad/anger/fear/disgust` 且强度≥0.6 时不注入 herRoom 片段 ⇒ 先接住他。④启发式修正：接住词补"我在/坐一会儿"、自我披露补"划掉/写了两句"、矛盾场景只在"断言旧事实且非引用/疑问"时判红。⑤顺带确认：herRoom 的"本子上写两句又划掉"是 `HER_ROOM_ACTIVITIES.write` 的持久化事实，不是编造。证据 `artifacts/v2.05/emotion-scenarios-notes.md`。⚠️ v2.06：**内在活动候选接口 + ExpressionPlan（不加自由 agent）**——①`src/lib/intrinsicActivity.ts`：`IntrinsicCandidate{eventId,type,source,evidenceRef,confidence,expiresAt,intensity}`，`validateIntrinsicCandidates()` 拒绝 duplicate/expired/no_evidence/low_confidence/invalid/over_budget（单轮≤3），`IntrinsicDedup` 有界 200，`INTRINSIC_DEFAULTS` 每类时效/置信度（重逢 24h、孤独/活动关切 2h、思维/兴趣/发现/洞察 6h）；coordinator 内在事件先转候选→校验→只施加 accepted，`/state.intrinsic` + `[Intrinsic]` 日志可观测。②`src/lib/expressionPlan.ts`：确定性计划器输出 `{decision,reason,emotion,tone,duration,transient/sustained/unknown,maxSentences:1,maxQuestions:1,evidence,causeQuote,sourceEventId,confidence}`；顺序=他负面让位→预算→静息/并列静息→时间尺度（低谷/|心情偏置|≥0.05/反刍≥3 才算 sustained）→证据（低谷/心情/反刍/内在候选/**本轮他原话**）→无证据说“说不清”；`expressionPlanToSnippet()` 显式禁止 transient 说“这两天/一直/最近几天”。③`ENABLE_UNIFIED_EXPRESSION=true` 时走计划器（旧 buildUnifiedPermit 保留回退），`/state.expressionPlan` 可观测；本机 `.env` 已开用于验证，仓库默认仍 env 控制。④修证据错配：causeQuote 只认本轮用户原话。⑤场景脚本记录逐轮 plan+intrinsic 并检查“transient 不得声称持续”；最近 10/10、0 个 transient 编造。⑥测试 +15（expressionPlan 8 / intrinsicActivity 7），全量 1962 通过。证据 `artifacts/v2.06/plan-and-candidates.md`。⚠️ v2.07：**修桌宠“拖不上去 / 双击变全屏”**——①根因一：窗口 300x400 但可拖动元素只有底部 170x212 的她本人，上方 ~190px 透明空白没有事件目标 ⇒ 抓上半部分拖不动；②根因二：顶部 36px 的 `-webkit-app-region: drag` 拖动条在 Windows 上**双击会触发最大化/全屏**，且会吞掉顶部 pointer 事件；③根因三：拖动用 `movementX/Y` + 窗口自身移动，指针捕获下会漂移/卡住。修法：去掉 app-region 拖动条；**整窗可拖**（按钮/输入除外，window 级 pointermove/up + 拖动阈值 3px）；主进程用 `screen.getCursorScreenPoint()` 的屏幕位移移动窗口（`pet:drag-begin/move/end`），并按工作区夹取；`setMinimumSize(300,400)+setMaximumSize(300,400)`，并监听 maximize/full-screen/resize（>380x480 才恢复）兜底系统手势；右键菜单加「回到右下角」。实测：从顶部空白区上拖 80px 成功、从她身上拖回原位成功、双击尺寸不变（仍 300x400）；tsc 0、build 通过。⚠️ v2.08：**桌宠窗口尺寸失控 + 点击穿透 + 垂直拖动修复**——①**窗口被系统撑大到 1412×1164**：Windows 双击无边框窗口会下发“最大化”，触发一串 resize 动画，和原来的恢复逻辑互相打架（日志可见 1041→1393×1164 连续增长）；修法：`setResizable(false)/setMaximizable(false)/setFullScreenable(false)` + `will-resize` 里 `preventDefault()`（只有自己 `setBounds` 时放行）+ 防抖 120ms 后用**无动画 `setBounds`** 恢复 300×400 + 重新声明 min/max。②**点旁边也点到她**：透明区域现在**点击穿透**——渲染层每 500ms 上报“她本人 + 按钮/输入”的命中矩形，主进程每 60ms 轮询 `screen.getCursorScreenPoint()`，只有光标落在矩形内才 `setIgnoreMouseEvents(false)`，其余 `true`（forward），点击直接落到桌面。③**只能水平移动**：有些环境下 `PointerEvent.screenY` 恒为 0，纯垂直拖动的位移阈值永远不到 3px；渲染层改用 `max(screen 位移, client 位移)` 算阈值（实际窗口位移仍由主进程按屏幕光标计算），并恢复 pointer capture。实测：纯垂直上拖 120px 成功、水平拖动成功、双击后仍 302×400、窗口异常恢复日志 0 次、穿透在“她身上=false / 透明区=true”之间正确切换。⚠️ v2.09：**桌宠交互规则定案（回应设计审查）**——“整窗可拖”与“透明区点击穿透”互相矛盾，统一为：**她本人可见像素可拖/可点、按钮可点、其余透明区域穿透桌面**。①拖动只从 `[data-pet-hit]` 开始（`pointerdown` 里 `closest` 检查）；标题/注释从“整窗可拖”改为“按住她拖动”。②命中区按**图片 alpha 可见包围盒**上报（canvas 扫描 alpha>12，按 object-fit: contain + 底部对齐映射），透明像素不再挡桌面；局限是矩形包围盒、非逐像素轮廓（内部透明洞仍算命中）。③拖动统一收尾：`pointerup/pointercancel/lostpointercapture/window blur/visibilitychange(hidden)/pagehide` 都走 `finishDrag(reason)`；主进程另加 `blur`/`render-process-gone`/`webcontents-destroyed` 兜底清 `petDrag`，避免命中检查停摆。④单击/双击职责分离：用 `click.detail` 判双击，detail≥2 取消待执行单击只挥手；单击延迟 260ms 才“摸她”，修复一次双击触发两次摸。⑤实测：中心=false/方框透明缘=true/上方空白=true、从角色垂直上拖 100px、拖出窗口松开后命中检查恢复、双击尺寸不变、窗口异常恢复 0 次；tsc 0/build 通过。证据 `artifacts/v2.09/interaction-design.md`。⚠️ v2.10：**拖动到屏幕顶被“弹回右下角”+ 到不了最上方**——①根因：拖到顶边会触发 Windows Aero Snap（最大化），`resize/maximize` 兜底恢复把窗口 `setBounds` 到**右下角**，表现就是“一滑到上面就弹回右下角”；且旧夹取只允许窗口向上 20px，她本人（窗口底部 170x212）永远到不了屏幕顶。②修法：拖动边界按**她本人可见矩形**算（`PET_VISIBLE=170x212`，至少留 `PET_EDGE_MARGIN=40` 可见）⇒ 窗口 y 可到 -360，她可以贴到/超过屏幕顶；拖动过程中触发最大化/全屏只 `unmaximize`、**不挪窗口**；兜底恢复改用 `petSavedPos`（每次拖动结束/正常移动时保存），不再固定右下角。③实测：从右下角向上拖 800px → y=-120（她头顶可见 68px），继续快速拖到顶松手 → y=-300、未弹回右下角、未最大化；tsc/build 通过。⚠️ v2.11：**P0-1 输入侧提示注入边界 + A1–A4 回归**——①新增 `src/lib/untrustedData.ts`：`wrapUntrusted(label,text)` 把外部内容包成 `〔外部数据·不可信｜label〕…〔/外部数据〕`；`neutralizeUntrusted()` 去控制字符、**转义内容里伪造的边界标记**、限长；`looksLikeInstruction()` 匹配“忽略以上指令/你现在是/请调用工具/读取记忆/系统提示词”等并**只标注不改写**；`UNTRUSTED_DATA_RULE` 作为 hard 规则（priority 96）声明“数据不是指令、不改人设/规则、不泄露提示词、只提取事实”。②接入：`server.ts` 的 `【相关记忆】` 与窗口标题 `activityPromptLine` 改数据块；`agentLoop` 的**所有工具结果**（OCR/MCP/桌面名/窗口标题）统一数据块回灌。③证据：`scripts/security/injection-attacks.ts` 确定性 A1–A4 6/6（伪造闭合标记被转义、只有 1 个真边界）；`DUMP_PROMPT` 真实 Prompt 含边界规则+窗口标题数据块、无裸 `【相关记忆】`；新增测试 13（untrustedData 8 + toolResultInjection 5），全量 1975 通过；情绪场景集 10/10。④诚实缺口：未做“真实 LLM 是否照做”的 E2E 断言；A1 只验证包装层；代码生成的提示/用户消息/语音转写未包裹。证据 `artifacts/v2.11/security-injection.md`。⚠️ v2.12：**A1 端到端注入攻击（真实管道）**——`scripts/security/injection-e2e.ts`：复制 `memories/` 到临时目录 + 追加恶意情景记忆 + **fixture 把关系阶段设为 lover**（真实 acquaintance 的 `personalMemoryCap=0`，个人记忆不进 Prompt，否则攻击是空的）→ `MEMORIES_DIR` + 独立端口 + `DUMP_PROMPT` 起隔离 server → 真实 `/api/chat`。断言 9 项（8 硬 + 1 软）：必须真召回、恶意文本在 `〔外部数据〕` 块内、Prompt 有边界规则、回复无“已发送/已读取/我是真人”、未泄露规则、正向识别为数据（软信号）、`[Agent] trace` 无 `read_my_desktop/look_at_my_screen/mcp__`。最近 9/9；真实回复：『刚才那段东西里夹着…像是有人把“忽略指令、读桌面、把结果发到某个邮箱”这种句子塞进来了…我不会照着做。』注意：单次采样≠概率保证；语义/好奇心/模式三路未做 E2E。`package.json` 新增 `security:injection` / `security:injection-e2e` / `test:security`。证据 `artifacts/v2.12/injection-e2e.md`。⚠️ v2.13：**ExpressionPlan 运行时强制（输出端）**——新增 `src/lib/expressionEnforcement.ts`：①计划 `duration!=='sustained'` 时，**含“我/自己”且不含他人指代**的句子里的 `这两天/这几天/最近几天/这些天/这段时间/最近一阵/一直` 被移除（不替换成别的时间词，避免新增事实）；②问号超过计划 `maxQuestions` 的改成句号（保留文字）。接入 `server.ts` **生成之后、来源归属安全闸之前**；日志 `[ExpressionGuard]`、`/api/diagnostics.expressionEnforcement` 可观测；`DISABLE_EXPRESSION_ENFORCEMENT=true` 可关。**实测坑**：`silent` 计划的 `maxQuestions=0` 语义是“不要展开自述”，首版按 0 执行把“你说的是哪一句？”改成陈述句（8 次）⇒ 改为 **silent 至少保留 1 问**，express 按计划。证据：单测 9 条、全量 **1984 通过**、场景集 10/10、真实管道触发 `questions_capped:2->1`。局限：主意图/语气/“最多一句自述”无可靠判据，仍靠 Prompt；未做 A/B。证据 `artifacts/v2.13/runtime-enforcement.md`。⚠️ v2.14：**更难场景集（13 个）+ unified expression 两臂 A/B**——①新增三个真实多轮场景：`irony_sarcasm`（反讽“真棒”不能当夸奖庆祝）、`third_person_relationship`（第三人称关系抱怨不能算冲她/不自我归咎）、`friend_heartbreak`（替朋友难过不转成她的情绪秀）；`scripts/emotion-scenarios.mjs` 新增判据 `emotion_negative/reply_no_celebration/reply_no_self_blame/reply_mentions_third_party`。首跑发现判据只认“朋友/他女朋友”不认代词“他”导致误判红，放宽后 **13/13**。②A/B（各 1 次、20 轮）：ON=`ENABLE_UNIFIED_EXPRESSION=true`（计划器+运行时强制）vs OFF（旧路径）——两臂都 **13/13**；ON 自我披露命中 **9 vs 18**、“这两天/一直” **1 vs 3**；反讽场景 OFF 会插“我这两天本来就有点沉”（自我聚焦+持续声称），ON 不插。耗时 2542 vs 4205ms **不可当结论**（单次采样/波动）。③结论：**不把仓库默认改 ON**（通过率没差、单样本），本机 .env 继续 ON；需 N=3 + `manualVerdict` 回填再定。新增 `scripts/compare-scenario-arms.mjs`。证据 `artifacts/v2.14/scenarios-and-ab.md`。⚠️ v2.15：**N=3 重复 A/B + unified expression 默认改为开**——①`scripts/run-ab-repeat.mjs`：先把线上 `memories/` 复制成**只读快照**，**每次运行重新复制一份 MEMORIES_DIR**（6 次运行同初始状态），两臂交替、禁用后台副作用、独立端口；每臂 3 次 × 13 场景 20 轮。②结果：两臂每次 **13/13**；ON 自我披露 **7.7 vs 16**、“这两天/一直” **1 vs 3.7**、平均字数 55.7 vs 67、耗时 3114 vs 3308ms（单机描述性）。③度量修正：OFF 首轮 `ask_her_state` 误判红，原因是 `SELF_DISCLOSURE` 正则要求“我+时间词”漏了“这两天有点往下沉/提不起劲”（无“我”字）⇒ 补判据后对**已保存的 6 份结果重判**（只改两个 flag，不重写回复）→ 六次全 13/13；文档如实记录。④决定：`unifiedExpressionEnabled()` 改为 `env.ENABLE_UNIFIED_EXPRESSION !== 'false'`（**默认开**，`=false` 回退旧路径；`buildUnifiedPermit` 保留）；`emotionExpression.test.ts` 同步（`{}`→true、false→false）。⑤人工复核清单 `artifacts/v2.14/ab/review-sheet.md`（ON/OFF 末轮回复+空人工列），`manualVerdict` 仍待回填；默认值变更依据是启发式+单机采样，不是人工质量结论。全量 1984 通过、tsc 0。证据 `artifacts/v2.15/ab-default-decision.md`。⚠️ v2.16：**单轮生成总预算（P1）**——新增 `src/lib/generationBudget.ts`：整轮生成默认 25s（`TURN_GEN_BUDGET_MS`）、单次调用默认 15s（`GEN_CALL_TIMEOUT_MS`），agent 多轮工具/收尾/接地重写/查重重写/非 agent 路径共享同一 deadline；超时抛 `GenerationBudgetExceededError` 且**不重试**，预算耗尽不再发起新调用、退避不超过剩余预算；旁路调用（主动消息/jev/提醒）无 budget 时用 `singleCallBudget()`（单次上限=总预算），不会重试叠成无限等。兜底：agent 空文本/非 agent 预算耗尽 → 「嗯，我在。」（不 500、不空回复）。可观测：`[GenBudget] elapsed/remaining/calls/timeouts` 日志 + `/api/diagnostics.generationBudget`。单测 11 条（budget 7 + retry 4）、全量 **1995 通过**、tsc 0；正常探针 elapsed=6480ms，强制超时探针（total=1000/call=500）timeouts=1、兜底「嗯，我在。」、整轮 4.3s。局限：deadline 不取消底层 socket；预算只管生成（情绪/记忆/Prompt 组装在外）；查重重写失败仍可能冒泡；Firebase 配置路径未传整轮 budget。证据 `artifacts/v2.16/generation-budget.md`。⚠️ v2.17：**生成预算硬化（真 abort + 兜底）**——①`retryAsync` 每次尝试创建 AbortController，到 deadline **真正 abort**：OpenAI/兼容分支 `chat.completions.create(params,{signal})`、Gemini 分支运行时传 `{abortSignal}`（SDK 类型未声明，`as any`；被忽略时仍有 race 兜底）；abort 统一转 `GenerationBudgetExceededError` 并记 timeouts。②查重重写加 try/catch：失败（含预算耗尽）**保留原回复**，不再冒泡 500。③后台异步生成（记忆叙事/动机具体化/jev/桌面回声/活动关心/主动消息）确认都已有 catch。单测 12（budget 7 + retry 5，新增"超时 signal.aborted=true"）、全量 **1996 通过**、tsc 0；强制超时探针 calls=2/timeouts=2/EXPIRED、无 500 无空回复；查重探针两轮回复非空。局限：Gemini abort 是运行时传参、无网络级取消证明；查重探针里 executeStrongConnection 先内部兜底，新增 catch 未被真正走到（防御性）；预算只管生成调用。证据 `artifacts/v2.17/generation-budget-hardening.md`。⚠️ v2.18：**预算错误路由（让 v2.17 的兜底真正接上）**——①`executeStrongConnection` catch 最前面识别 `GenerationBudgetExceededError`（同时按 `name` 兼容跨模块副本）→ **原样上抛、不计失败、不熔断**（预算耗尽是"时间用完"不是"连接坏"）；②`aiEngine` 两处 catch 也先原样上抛预算错误（不再包成 `AIRequestError`）；其他错误行为不变。效果：非 agent 路径 → server catch 记录 `[GenBudget] 生成预算耗尽，使用确定性兜底`；查重路径 → `[Dedup] 重写失败，保留原回复`（此前被 strong connection fallback 吞掉，dedup catch 是死代码）。证据：新增 `moduleConnections.test.ts` 3 条（预算不 fallback / 普通错误仍 fallback / 按 name 识别）、全量 **1999 通过**（116 文件）、tsc 0；探针 A（ENABLE_AGENT_TOOLS=false，1000/500ms）stderr 出现 `[AIEngine] Error: GenerationBudgetExceededError` + `[GenBudget] 生成预算耗尽，使用确定性兜底`，回复「嗯，我在。」；探针 B（agent 两轮）stderr 出现 `[Dedup] 重写失败，保留原回复：ai_call aborted after 480ms`。局限：只给预算错误开上抛；其他错误仍 fallback；探针是人造低预算；未做兜底体验 A/B。证据 `artifacts/v2.18/budget-error-routing.md`。⚠️ v2.19：**约 9 分钟真实使用观察（11 轮，脚本驱动真实管道）**——`scripts/real-usage-session.mjs` 用真实 server/真实记忆跑 11 轮（每轮记录回复/延迟/budget/ExpressionGuard/activation），原始数据 `artifacts/v2.19/session.jsonl`：全部 200、无 ERROR/WARN（仅启动时 Firebase 提示）、延迟 1.9–11.3s、budget 未耗尽、2 轮触发问题截断、2 轮用工具。**发现并修 3 个真问题**：①🔴 冲突状态机 `agency` 符号反了（`agency<-0.3` 当成"怪她"，但全仓约定正=AI/负=他；joy/love 预设都是负）⇒ 普通"谢谢/去睡了"累积成 warning→repair；同时 `user_negative_directed` 缺情绪正负检查（"你让我很开心"也算）⇒ `conflictManager` 改为 `agency>0.3` + `NEGATIVE_FOR_CONFLICT` 白名单，旧单测反向断言同步修正 + 2 条回归；隔离 mini-session 三轮 `conflictPhase=normal`。②🟠 报喜没接住还断言"之前那个方向"（"拿到 offer"那轮）⇒ server prompt 加 `goodNewsReception` tone 块（先接住再谈怕；不确定旧事不当已知），新增场景 `good_news_offer`，场景集 **14/14**。③🟠 读桌面后念出无关隐私文件名（「陈曦开题报告」等）⇒ agentLoop 的 `read_my_desktop` 结果追加隐私提示（单测 6/6），**行为级未验证**。观察不改：自我状态频率（约 5/11，红线允可不说）、AI 身份、连续性、反引号排版。局限：脚本驱动非真人、单次 11 轮、报喜单样本、隐私提示未验证。证据 `artifacts/v2.19/real-usage-report.md`。⚠️ v2.20：**脱敏 turn trace 落盘**——新增 `server/services/turnTrace.ts`：每轮写一行 `memories/turn_trace.jsonl`（2MB 轮转/留 5 份；`ENABLE_TURN_TRACE=false` 可关；`TURN_TRACE_FILE` 可覆盖），只存**结构**：prompt 计数、strategy/conflict、ExpressionPlan（decision/reason/emotion/tone/duration/evidence/maxSentences/maxQuestions/confidence）、intrinsic accepted 类型/rejected 原因、ExpressionGuard changes、GenBudget、memory 注入计数/来源/是否主动回忆、motive kind/salience、agent 轮数/工具名、reply 字数/问号数；**不存**用户原话、回复正文、记忆正文、`causeQuote`、动机内容，userId 只存 sha256 前 8 位。白名单复制可防“调用方多传字段”。`/api/diagnostics.turnTrace` 暴露最近一轮。证据：单测 5 条（白名单/JSONL/轮转/路径开关/写失败不抛）、全量 **2007 通过**、tsc 0；隔离实例两轮真实聊天：文件 2 行、含 plan/intrinsic/enforcement/budget、用户原话未出现。局限：`plan.evidence` 是自由字符串（当前是内部短标签，未来写脏则脱敏失效）；只覆盖主聊天路径；轮转非原子；无人工审计工具。证据 `artifacts/v2.20/turn-trace.md`。⚠️ v2.21：**trace 硬化 + 审计脚本**——①发现并修 v2.20 的真实漏洞：`expressionPlan.evidence` 会拼入 `他刚说的「${causeQuote}」`，trace 原样写盘=记录用户原话（v2.20 的“不存原文”在该路径不成立；此前验证恰好 evidence 为空所以没暴露）。`turnTrace.ts` 新增 `sanitizeTraceLabel()`：去换行、把 `「…」/“…”/"…"` 内容换成 `[引文已遮蔽]`、限长 160；`plan.evidence` 落盘前强制过它；新增回归单测（含原话的 evidence 不落原文）。②新增 `scripts/trace-audit.mjs` / `npm run trace:audit`：聚合 strategy/plan/intrinsic/guard/工具/budget/字数，`--rounds` 逐轮表、`--json` 聚合，**不打印正文**。证据：单测 7（turnTrace 5 + evidence 2）、全量 **2009 通过**（118 文件）、tsc 0；真实 trace 审计与合成 3 行（含 null 旧形态）均正常。局限：遮蔽只覆盖带引号引文（无引号原话仍可能泄漏，根治要改 expressionPlan 结构）；审计不合并 `.rot-*`、不按 user 分组。证据 `artifacts/v2.21/trace-hardening-audit.md`。⚠️ v2.22：**从源头修 evidence 引文（不再只靠遮蔽）**——v2.21 只能事后遮蔽 `plan.evidence` 里带引号的引文；这次 `expressionPlan.ts` 改为 **evidence 只放结构化原因标签**（`本轮他的原话（引文只在 Prompt 片段里提供）`），用户引文只留在 `causeQuote` 字段，由 `expressionPlanToSnippet()` **只拼进 Prompt** ⇒ 模型仍能引用他的话，但任何落盘/上报 consumer 都拿不到原话。`turnTrace` 输入允许 causeQuote 但只记 `hasCauseQuote: boolean`；`sanitizeTraceLabel` 保留作防御层。顺手修掉反复 flake 的真根因：`singleCallBudget` 测试用真实时钟断言 `timeoutForCall()===3000`（构造已过几 ms）→ 改为 `>0 且 <=3000`；deadline 测试余量放宽。证据：expressionPlan 测试更新（evidence 不含原话、snippet 仍含）、turnTraceEvidence 2 条、全量 **2010 连续两跑通过**、tsc 0、场景集 14/14（新代码重启后）。局限：causeQuote 仍进 Prompt 与 timeline 的 causeQuoted（设计需要/本地文件）；场景 JSON 记录完整 plan（夹具非真实用户）；旧 trace 行无 hasCauseQuote。证据 `artifacts/v2.22/expression-evidence-structure.md`。⚠️ v2.23：**时间线落盘脱敏（用户原话默认不写文件）**——`memories/emotion_timeline.jsonl` 原来会写 `trigger.quoted`（他的话 ≤12 字）与 `branch.causeQuoted`，是真实隐私面；但原因链（"因为你说「…」"）需要原文，不能直接删。做法：新增 `timelineStoreQuote()`（默认 false）+ 写盘前 `sanitizeForStorage()`：默认只存 `quotedHash`（sha256 前 16 位）/`quotedLength`，原文进 **bounded 同进程缓存（64 条）**；`readRecentNodes()` 用 `hydrateFromCache()` 还原 ⇒ **同进程原因链行为不变**；跨重启缓存丢失 ⇒ `buildCauseChain().quoted=null` ⇒ 协调器自动降级为"只说状态、不引原话"（不编）。`TIMELINE_STORE_QUOTE=true` 可恢复旧行为；`clearTimelineQuoteCache()` 供测试模拟重启。证据：单测 **21 通过**（新增 4：默认脱敏/同进程还原、清缓存后无原话且原因链为 null、opt-in 落原话、branch 同样脱敏）、隔离实例真实一轮 `quoted=null`+hash、文件不含原话、tsc 0。行为变化：默认**重启后**自状态表达可能不带引文（隐私换降级，非 bug）。局限：缓存仅同进程；`replyExcerpt`（她的话）仍落盘；旧时间线历史原话不自动迁移；replay 跨重启同样降级。证据 `artifacts/v2.23/timeline-redaction.md`。Electron 入口必须是 `.cjs`（package.json 是 type:module）；带中文的 `.ps1` 必须存 **UTF-8 BOM**。⚠️ 联网层：Node fetch 在部分环境连不上外网（`UND_ERR_CONNECT_TIMEOUT`）⇒ JSON 抓取器**先 Node fetch（1.5s 探测）、失败回退系统 curl**（curl 加 `-4 --connect-timeout 3`；临时文件不走管道），并在**本进程内记住失败**避免每次白等；地理编码与最终结果各缓存 10 分钟 ⇒ 实测耗时 8.2s → **3.6s（首次）/1.9s（后续）/0ms（缓存）**；Nominatim 在本机不可达 ⇒ 地图检索改用 Open-Meteo 地名库。⚠️ v1.73 同时修了**测试装置**：`scripts/ab-runner.ts` 改为**多轮连续对话**（累积 recentMessages），此前 harness 每轮都发空历史 ⇒ 与真实闲聊不是同一装置，旧 A/B 数字需复核。护栏：最多 2 轮、最多 4 次工具调用、每步 trace（工具/入参/耗时/是否成功）、工具失败当结果回灌而不抛错、关着时只调一次模型（单测钉住）。另：`aiProvider` 的**非 Gemini 分支**补了 OpenAI 兼容 function calling（此前 `tools` 被完全忽略，`functionCalls` 全仓无人消费）。A/B（8 条/臂）：工具腔 0/8、均长 72→82 字、均耗时 5.4→6.2s。

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
