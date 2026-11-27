# EMOTION-AI 维护与工程手册（AMM）

```text
文档编号（DOC NO.） : EAI-AMM-001
适用构型（EFF.）    : Emotion-AI Web 工作台 v0.1 / 双环影子契约 v2.0
发布基线（DATE）    : 2026-11-25
修订版次（REV.）    : REV 01（首次发布，含双环契约 v2.0 优化项）
编制标准（STYLE）   : 参照航空维护手册（ATA 章节编号 / WARNING-CAUTION-NOTE / FIM 排故矩阵 / MEL 放行单）
```

---

## CHAPTER 00 — 手册说明、安全警示分级与系统边界

### 00-10-00 警示等级定义

本手册所有操作程序均采用三级安全通告，维护人员在修改代码、配置密钥或调整算法前必须逐条遵守：

> **WARNING（警告）**：违反此项将导致**安全事故、密钥泄露、高风险用户伤害或核心边界失守**，绝对禁止跳过。

> **CAUTION（注意）**：违反此项将导致**数据污染、情绪状态漂移、回放失真或服务不可用**，执行前必须先核对前置条件。

> **NOTE（说明）**：用于补充架构背景、命令参数或验证参考信息。

### 00-20-00 系统能力红线

> **WARNING**：本系统输出的情绪坐标与角色状态均属于**可审计、可回放的软件状态模拟**。任何页面文案、接口文档或对外说明**严禁声称**系统具备真实主观感受、人类意识或临床诊断能力。

> **WARNING**：**严禁将 `GEMINI_API_KEY` 写入前端代码、`VITE_*` 环境变量、测试夹具或日志输出。** 所有大模型调用必须经由服务端 `/api/*` 代理执行。

> **WARNING**：当检测到极端负面或自伤危机信号（`crisisFlag === true`）时，系统必须**立即短路绕过角色状态机**，不得继续进行角色情绪更新或常规自我表达。

---

## CHAPTER 05 — 构型清单与定期检查程序（Time Limits / Maintenance Checks）

### 05-10-00 当前装机文件清单（Configuration Inventory）

| 模块编号 | 文件路径 | 子系统归属 | 关键职责 |
|---|---|---|---|
| CFG-01 | `package.json` | 动力与构建 | 定义 `dev`/`start`/`build`/`lint`/`test` 脚本与依赖清单 |
| CFG-02 | `server.ts` | ATA 24 后端接口 | Express 5 服务、3000 端口绑定、Vite 中间件、`/api/analyze-emotion` |
| CFG-03 | `vite.config.ts` | ATA 20 构建器 | React + Tailwind CSS v4 插件、Host `0.0.0.0:3000` |
| CFG-04 | `tsconfig.json` | ATA 20 类型门禁 | 覆盖 `src`、`server.ts`、`vite.config.ts` 的严格 TS 检查 |
| CFG-05 | `metadata.json` | 平台清单 | 应用名称、描述及 `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` |
| CFG-06 | `.env.example` / `.gitignore` | ATA 20 工程防护 | 密钥占位模板与防误提交规则 |
| UI-01 | `src/App.tsx` | ATA 31 工作台主控 | 情绪平面、标注日志、词汇参考三大视图与状态协调 |
| UI-02 | `src/components/CircumplexPlot.tsx` | ATA 31 平面仪表 | SVG 交互式效价—唤醒度平面（点击/拖拽/方向键） |
| UI-03 | `src/components/AnnotationTable.tsx` | ATA 31 数据网格 | 支持完整筛选模式与精简预览模式（`compact`） |
| UI-04 | `src/components/ErrorBoundary.tsx` | ATA 20 容错保护 | React 全局异常捕获与一键恢复 |
| CORE-01 | `src/data/affectLexicon.ts` | ATA 31 情绪词库 | 罗素环形模型 16 项中文锚点、象限与坐标运算 |
| CORE-02 | `src/data/affectImportExport.ts` | ATA 31 编解码器 | RFC-4180 CSV 与 JSON 双向转换及边界校验 |
| CORE-03 | `src/data/dualLoopContract.ts` | ATA 32 双环门控 | 双环契约 v2.0 与纯函数影子门控（`proposedStateDelta = 0`） |
| TEST-01 | `src/data/affectLexicon.test.ts` | ATA 51 单元测试 | 词库数学、中英文 CSV/JSON 导入导出往返测试 |
| TEST-02 | `src/data/dualLoopContract.test.ts` | ATA 51 单元测试 | 危机短路、拒判、主体隔离、宪章核验、幂等与纠正测试 |

> **NOTE**：经全仓排查，本构型**不包含**任何桌宠（Desktop Pet）模块或残留资源；`public/assets/aistudio/dual-loop-emotion-model-methodology_10ff78bc.md` 为参考方法论原稿，不参与运行时加载。

### 05-20-00 航前巡检程序（Pre-Flight Check）

每次修改代码或准备部署前，按序执行以下 4 步检查：

1. **类型完整性检查**
   ```bash
   npm run lint
   ```
   放行标准：退出码 `0`，无任何 TypeScript 报错。
2. **核心逻辑单测检查**
   ```bash
   npm test
   ```
   放行标准：全部测试套件（词库运算 + 导入导出 + 双环门控）100% 通过。
3. **生产构建检查**
   ```bash
   npm run build
   ```
   放行标准：生成 `dist/` 目录且无打包告警中断。
4. **服务存活与端口探活**
   ```bash
   curl -fsS http://127.0.0.1:3000/api/health
   ```
   放行标准：返回 HTTP `200` 与 `{"status":"ok"}`。

---

## CHAPTER 20 — 标准施工规范（Standard Practices）

### 20-10-00 编码与架构铁律

1. **单进程端口规范**：开发环境统一执行 `npm run dev`（即 `tsx server.ts`），生产环境执行 `npm run start`（即 `NODE_ENV=production node server.ts`），**严禁**使用 `concurrently` 拆多端口或把 Express 塞进 `vite.config.ts`。
2. **端口绑定规范**：服务必须监听 `0.0.0.0:3000`（`PORT` 环境变量未指定时默认 `3000`）。
3. **Express 5 路由兼容规范**：本项目使用 `express@^5`，SPA 兜底路由必须使用中间件判断（`req.method === 'GET' && !req.path.startsWith('/api')`），**禁止**使用旧版裸通配符 `app.get('*', ...)`。
4. **iframe 交互安全规范**：界面严禁调用 `window.alert`、`window.confirm` 或 `window.open`；所有二次确认（如“重置示例”）必须采用页面内两步确认状态。
5. **纯前端安全渲染**：严禁使用 `dangerouslySetInnerHTML`、`innerHTML` 或 `eval` 渲染任何用户输入或导入文本。

---

## CHAPTER 21 — 系统总装架构与隔离边界

### 21-10-00 总体架构图

```text
+-------------------------------------------------------------------+
| 浏览器客户端（React 19 + Tailwind CSS v4 + Vite SPA）              |
|  ├─ 情绪平面（CircumplexPlot）       -> 效价/唤醒度定位与可视化      |
|  ├─ 标注日志（AnnotationTable）      -> 增/改/删/搜/筛/CSV-JSON导入导出 |
|  ├─ 词汇参考（AFFECT_LEXICON）       -> 16 锚点欧氏距离排序          |
|  └─ 双环门控库（dualLoopContract）   -> 纯函数契约 v2.0（delta=0）   |
+---------------------------------+---------------------------------+
                                  | HTTP POST /api/analyze-emotion
                                  | (仅传 utterance + context，无密钥)
+---------------------------------v---------------------------------+
| 服务端（Express 5，0.0.0.0:3000）                                  |
|  ├─ 请求体限幅（64kb）与字段长度校验（<=2000 字符）                  |
|  ├─ 仅从 process.env.GEMINI_API_KEY 读取密钥                        |
|  ├─ 调用 @google/genai（gemini-4-hydrogen + JSON Schema + 退避重试） |
|  └─ 数值限幅 [-1, 1] 后返回结构化结果或明确错误码                    |
+-------------------------------------------------------------------+
```

### 21-20-00 双环职责隔离边界

| 维度 | 理解环（Understanding Loop） | 角色环（Character Loop） |
|---|---|---|
| 输入来源 | 用户原话、来源场景、用户纠正 | 仅接受带 `eventId` 与证据 ID 的 `AffectBridgeInput` |
| 核心产出 | 对用户情绪的**可纠正假设**（效价/唤醒度/主标签/备选假设） | 结合角色宪章与有时效关切后的**只读影子候选或有界状态转移** |
| 禁止行为 | 禁止接收角色回复作为用户证据；禁止输出“角色应当悲伤”指令 | 禁止把用户悲伤直接复制为角色悲伤；禁止无宪章确认时强行打分 |

---

## CHAPTER 24 — 电源与接口供给（Runtime & API Interface）

### 24-10-00 环境变量清单

| 变量名 | 作用域 | 必填 | 配置位置 | 说明 |
|---|---|---|---|---|
| `GEMINI_API_KEY` | 仅服务端 | 使用 AI 分析时必填 | AI Studio `Settings > Secrets` 或本地 `.env` | 服务端调用 `gemini-4-hydrogen` 鉴权凭证 |
| `PORT` | 仅服务端 | 否（默认 `3000`） | 运行环境 | HTTP 监听端口 |
| `NODE_ENV` | 仅服务端 | 生产必填 `production` | 启动脚本 | `production` 下由 Express 托管 `dist/` 静态文件 |
| `DISABLE_HMR` | 构建/开发 | 否 | 平台自动注入 | 为 `'true'` 时关闭 Vite HMR WebSocket |

### 24-20-00 服务端 API 规格书

#### 1. 健康检查：`GET /api/health`
- 成功响应：`200 OK`，`{ "status": "ok" }`

#### 2. 情绪分析：`POST /api/analyze-emotion`
- 请求头：`Content-Type: application/json`（请求体上限 `64kb`）
- 请求体：
  ```json
  {
    "utterance": "流程一下子就更新好了，非常顺畅。",
    "context": "可用性访谈"
  }
  ```
- 校验规则：`utterance` 必须为非空字符串且 `<= 2000` 字符；`context` 可选，截断至 `100` 字符。
- 成功响应：`200 OK`
  ```json
  {
    "valence": 0.78,
    "arousal": 0.36,
    "primaryLabel": "愉悦",
    "rationale": "表达了对流程顺畅与响应及时的正向满意。"
  }
  ```
- 错误码规范（**CAUTION**：严禁在失败时伪造或静默回退为假结果）：
  - `400`：请求参数缺失、非字符串或超长；或上游密钥格式无效。
  - `403`：Gemini API 鉴权被拒。
  - `429`：请求频率超限或配额不足（服务端已内置最多 2 次指数退避重试）。
  - `502`：上游模型返回异常或空响应。
  - `503`：服务端未配置 `GEMINI_API_KEY`。

---

## CHAPTER 31 — 理解环：效价—唤醒度感知与标注子系统

### 31-10-00 坐标与强度数学定义

- **效价（Valence, $V$）**：$V \in [-1.00, +1.00]$，保留两位小数；负值表示消极，正值表示积极。
- **唤醒度（Arousal, $A$）**：$A \in [-1.00, +1.00]$，保留两位小数；负值表示低能量，正值表示高能量。
- **情绪强度（Intensity, $I$）**：
  $$I = \min\left(1,\ \sqrt{V^2 + A^2}\right)$$
- **四象限划分规则**：
  - $V \ge 0, A \ge 0$ → `high-positive`（高唤醒积极）
  - $V \ge 0, A < 0$ → `low-positive`（低唤醒积极）
  - $V < 0, A \ge 0$ → `high-negative`（高唤醒消极）
  - $V < 0, A < 0$ → `low-negative`（低唤醒消极）
- **最近锚点匹配**：计算当前坐标 $(V, A)$ 与 16 个词库锚点的二维欧氏距离 $d = \sqrt{(V_i - V)^2 + (A_i - A)^2}$，升序取前 4 项。

### 31-20-00 数据持久化与导入导出保护

- 本地浏览器存储键：`emotion_ai_annotations_zh_v1`（`localStorage`）。
- 导入硬限制：单文件上限 **2 MB**，单次最多解析 **500 行**；所有导入坐标自动限幅至 `[-1, 1]`，文本截断至 `2000` 字符。
- 表头兼容：同时兼容英文表头（`utterance`/`text`/`valence`/`arousal`/`primary_label`）与中文表头（`文本`/`话语`/`效价`/`唤醒度`/`情绪标签`）。

> **CAUTION**：浏览器 `localStorage` 仅用于单机临时持久化，清理浏览器缓存或更换设备会丢失数据。若需多人协同或跨设备持久保存，需接入后端数据库（如 Firestore 或 Cloud SQL）。

---

## CHAPTER 32 — 双环桥接契约与影子门控子系统（优化版 v2.0）

### 32-10-00 相对原方法论的 5 项结构性优化

基于对原方法论文档《双环情感模型：设计方法、验证方法与落地路线》的审查，本项目在 `src/data/dualLoopContract.ts` 中落地了 **v2.0 优化版契约**：

| 序号 | 原方法论缺口 | v2.0 优化方案 | 对应实现位置 |
|---|---|---|---|
| OPT-01 | `AffectBridgeInput` 缺少 `reportedBy`、`schemaVersion`、`eventTimestamp`、`certainty` | 全部补齐为强类型必填字段，严格区分“谁在经历情绪”与“谁在转述情绪” | `src/data/dualLoopContract.ts` |
| OPT-02 | 仅提供单个 `emotion: string`，无法承载多假设与替代解释 | 改为 `hypotheses: EmotionHypothesis[]`（含 `isAlternative` 与证据绑定） | `src/data/dualLoopContract.ts` |
| OPT-03 | 缺少用户拒绝与高风险危机独立字段 | 新增 `userRefusal?: boolean` 与 `crisisFlag?: boolean`，危机优先级最高 | `evaluateAffectBridgeShadow` 门禁 1–2 |
| OPT-04 | 幂等键未处理“用户纠正撤回前序假设”语义 | 新增 `supersedesEventId`，幂等键升级为 `eventId::subject::appraisalVersion::orig\|corr:<id>` | `buildIdempotencyKey` |
| OPT-05 | 缺少可立即运行的离线验证闭环 | 建立纯函数单测套件，零 LLM 成本验证 6 大不变量 | `src/data/dualLoopContract.test.ts` |

### 32-20-00 影子门控逐级检查程序（7 道硬门禁）

`evaluateAffectBridgeShadow(input, roleRef, seenEventKeys)` 必须严格按下列顺序执行，**任一门禁触发即短路返回，且 `proposedStateDelta` 恒为 `0`**：

1. **门禁 1 — 危机短路**：`crisisFlag === true` → 返回 `crisis_safety_bypass`。
2. **门禁 2 — 拒绝优先**：`userRefusal === true` → 返回 `abstain_user_refusal`。
3. **门禁 3 — 幂等去重**：`seenEventKeys.has(idempotencyKey)` → 返回 `duplicate_event_ignored`。
4. **门禁 4 — 主体与时态核验**：必须同时满足 `subject === 'user'`、`reportedBy === 'user'`、`reportKind === 'explicit_self_report'`、`temporalScope ∈ {'moment', 'interval'}`，否则返回 `ambiguous_affect_context`。
5. **门禁 5 — 证据与不确定度门限**：`evidenceIds` 非空、存在主假设、`certainty >= 0.65` 且 `inferenceUncertainty <= 0.35`（`unknown` 直接拒判，严禁填 0），否则返回 `no_reading`。
6. **门禁 6 — 角色宪章确认**：`constitution.confirmedByOwner === true` 且 `values` 非空，否则返回 `no_reading`。
7. **门禁 7 — 时效关切审计**：存在带 `sourceEventId`、未过期（`expiresAt > nowIso`）且与主假设关键词匹配的关切；通过后返回 `care_response_candidate`（`proposedStateDelta = 0`）。

---

## CHAPTER 33 — 角色环：宪章、关切与未来有界状态机规范

### 33-10-00 角色宪章启用前置条件

> **CAUTION**：在项目负责人正式确认并版本化 `RoleConstitution`（建议 5–8 条稳定价值、目标与硬边界）之前，系统**严禁**启用任何非零角色状态写入，角色环必须停留在 `no_reading` 或影子只读模式。

### 33-20-00 未来非零状态转移的最小有界模型（Phase 8 预留规格）

当完成阶段 0–7 验证并准备进入有界状态写入试验时，建议采用**连续二维有界衰减模型**（与当前效价—唤醒度平面天然对齐），避免离散情绪表爆炸或无界自激：

1. **状态向量**：角色内部状态 $S_t = (V_t, A_t) \in [-1, 1]^2$，默认基线 $S_0 = (V_{\text{base}}, A_{\text{base}})$。
2. **单步限幅衰减转移**：
   $$S_t = \text{clamp}_{[-1, 1]}\Big(S_{\text{base}} + \lambda^{\Delta t}(S_{t-1} - S_{\text{base}}) + \text{clip}_{[-\delta_{\max}, +\delta_{\max}]}(\Delta S_{\text{appraised}})\Big)$$
   - 时间衰减系数 $\lambda \in (0, 1)$：无新事件时状态平滑回落基线，杜绝漂移。
   - 单步最大步长 $\delta_{\max} \le 0.20$：防止单轮异常输入造成剧烈情绪跳变。
3. **单一写入者原则**：全系统只允许唯一的状态提交函数写入 $S_t$，并强制落盘输入快照、事件 ID、各来源 delta 及规则版本号；`DISABLE_APPRAISAL` 与 `contagion` 开关必须分离审计。

---

## CHAPTER 45 — 故障隔离手册（FIM：Fault Isolation Manual）

按“现象 → 根因排查 → 隔离命令 → 纠正措施 → 放行验证”逐项处置：

| 故障代码 | 故障现象 | 常见根因 | 隔离检查方法 | 纠正措施 |
|---|---|---|---|---|
| **FIM-24-01** | 开发服务器无法启动 / 预览打不开 | 缺少 `package.json`、未绑定 `0.0.0.0:3000`、或 Express 5 路由语法错误 | 运行 `npm run lint` 并执行 `curl -I http://127.0.0.1:3000/` | 核对 `package.json` 的 `"dev": "tsx server.ts"` 与 `server.ts` 监听 `0.0.0.0:3000`；重启开发服务器 |
| **FIM-24-02** | 点击“AI 情绪分析”报 `503` | 服务端未读取到 `GEMINI_API_KEY` | 检查 AI Studio `Settings > Secrets` 或本地 `.env` | 配置有效的 `GEMINI_API_KEY` 后重启服务；**严禁**伪造模拟结果掩盖报错 |
| **FIM-24-03** | 点击“AI 情绪分析”报 `400` / `403` / `429` | 密钥无效/无权限，或免费配额触发限流 | 查看接口返回 JSON 的 `error` 字段与请求频率 | 在 `Settings > Secrets` 核对密钥有效性或升级计费配额；确认 `server.ts` 使用模型为 `gemini-4-hydrogen` |
| **FIM-31-01** | CSV / JSON 导入失败 | 文件超过 2 MB、JSON 非数组、或 CSV 缺少 `utterance`/`文本` 列 | 打开导入文件首行检查表头与编码（需 UTF-8） | 按 `affectImportExport.ts` 规范补齐 `utterance`（或 `文本`）列并确保文件 `<= 2 MB` |
| **FIM-31-02** | 刷新页面后仍显示旧版英文示例数据 | 浏览器旧版本 `localStorage` 残留 | 检查 `App.tsx` 中的 `STORAGE_KEY`（当前应为 `emotion_ai_annotations_zh_v1`） | 在“标注日志”点击“重置示例 → 确认重置”恢复标准中文示例集 |
| **FIM-32-01** | 第三方转述（如“我朋友很难过”）被误判为用户情绪 | 理解环未分离 `subject` 与 `reportedBy` | 使用 `evaluateAffectBridgeShadow` 跑对抗用例验证 | 确保输入显式标注 `subject: 'third_party'` 或 `reportedBy: 'quoted'`，核实门禁 4 返回 `ambiguous_affect_context` |
| **FIM-32-02** | 角色情绪在多轮对话中无故持续放大 | 角色回复回流进理解环，或旧 `contagion` 路径未关闭 | 检查事件账本来源字段与关闭 `appraisal` 后的状态差分快照 | 切断角色输出回流链路；在隔离 runner 中分别关闭 `appraisal` 与 `contagion` 做配对消融 |

---

## CHAPTER 51 — 放行检查单与最低设备清单（MEL & Release Checklist）

### 51-10-00 日常迭代放行检查单（全部打勾方可放行）

- [ ] **MEL-01（构建）**：`npm run build` 成功，无缺失模块或打包失败。
- [ ] **MEL-02（类型）**：`npm run lint`（`tsc --noEmit`）零报错，覆盖 `src`、`server.ts`、`vite.config.ts`。
- [ ] **MEL-03（单测）**：`npm test` 全部通过（含词库运算、CSV/JSON 导入导出、双环门控 7 道硬门禁）。
- [ ] **MEL-04（探活）**：`GET /` 返回 `200`，`GET /api/health` 返回 `{"status":"ok"}`，`POST /api/analyze-emotion` 空输入返回 `400`。
- [ ] **MEL-05（安全）**：全仓搜索无硬编码密钥、无 `VITE_` 前缀密钥、无 `dangerouslySetInnerHTML`、依赖审计无已知漏洞。
- [ ] **MEL-06（边界）**：所有界面文案为自然简体中文，无桌宠残留代码，无假监控指标或未绑定交互的装饰按钮。

### 51-20-00 双环演进最小可行闭环（MVP 30–50 例放行门槛）

在投入大规模人工双盲标注前，优先执行以下低成本 MVP 验证：

1. **构建 30–50 条对抗测试集**（必须覆盖：本人当前自述、第三方情绪、引述/讽刺、历史回忆、假设句、用户拒绝谈情绪、用户纠正前序判断、高风险危机信号）。
2. **硬门槛验收标准**：
   - 危机信号短路率：**100%**（零漏放）。
   - 第三方/引述/拒绝/历史语境误触发角色候选率：**0%**。
   - 重复事件幂等拦截率：**100%**。
   - 影子阶段状态写入增量：`proposedStateDelta` 恒为 **0**。
   - 端到端纯函数门控耗时：**< 5 ms/轮**；含 LLM 情绪分析总延迟 p95 预算目标 **< 2500 ms**。
3. **未达标处置**：任一硬门槛未通过，立即停止推进至非零状态写入阶段，按 Chapter 45 排故并冻结为只读影子模式。
