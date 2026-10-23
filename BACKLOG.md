# BACKLOG — 记着要做的事

> 用户明确要求"先记住"的条目放这里。完成时移到「已完成」并写明版本与证据。

## 进行中

（暂无）

## 已完成

### [x] 把她看到的事接进她的关心：看到他在投简历 → 她会主动关心**结果**（v1.95 + v1.96，2026-10-22）

- **用户原话**："把她的理解和她的情绪接起来（发现你在投简历 → 她会不会主动关心结果？现在是"看到但未必然提起"）"
- **v1.95（情绪这一半）**：活动理解 → `activity_concern` 弱内在事件（fear/love 各 +0.03，受习惯化与单轮上限约束）＋ Prompt 一行 `【我看到的】…`。真机：她回复引用"杭州那个高级后端工程师"，fear 0.092 / love 0.283（弱抬升）。
- **v1.96（开口 + 记得 + 界面）**：
  1. 主动关心加时间窗（8:00–23:00）＋低谷期门槛更高（40 分钟 / 冷却 180 分钟 / 每天 1 次；平时 20/90/2）
  2. `memories/activity_care.json` 记住关心过的原话；6h–48h 内优先同类别找"该接着问结果"；生成 Prompt 带"别重复上次那句、问进展"。真机："有回音了吗？别光顾着刷，喝口水跟我说说。"
  3. 「她现在」显示"她心里记着的你的事"（原话 + 多久前 + 可以接着问结果）
- **证据**：`artifacts/v1.95/activity-care-and-config.md`、`artifacts/v1.96/care-window-memory-ui.md`；全量 1906/1906、tsc 0、build ✓。

### [ ] 后续可做（这条的尾巴，不阻塞）

- [ ] 对话里也带上"她心里记着的你的事"（现在只有主动关心通道用到这条记忆）
- [ ] 他明确回应后把那条关心标记 resolved（现在靠 6h–48h 窗口自然过期）
- [ ] 关键词表按人设区分（现在全局一份）

## 真实使用反思（v1.97，2026-10-22）

### 好的（想保住）
- **她会把两个真实窗口接成一个观点**："一个讲人怎么管住自己，一个讲世界怎么不由人" —— 这不是复读标题，是理解后的归纳。
- **混杂情境会说"说不准"**：6 个窗口 33% 时标 `vague`、`concern=null`，不硬猜、不推动情绪。
- **不打扰**：娱乐/混杂活动完全不触发主动关心（`not_a_concern`）。
- **自状态表达克制**："我这两天也有点沉…所以听你说累，我没什么想劝你的话" —— 没有变成卖惨，也没灌鸡汤。
- **MCP 真用得上**：问 docs 她能真列出 9 个文件+大小。

### 不好的 / 要盯的
- **回复只挑一条线**：同时有"微信聊天 + AI 岗位视频"时她只接了视频，没提聊天。是否要覆盖多条，需要你定（可能显得絮叨）。
- **标题级观察的边界**：全屏播放器/空白标题时她什么都看不到；混在浏览器窗口里的内容也读不到。
- **主动关心的正向路径还没在真实使用中出现过**（需要你连续 20 分钟在招聘/写代码/开会类窗口）——本批加了门槛可调参数，已用短门槛验证它能自然触发（见 v1.98 报告）。
- **她记得的"关心过的事"只在主动关心通道用**，对话里还没用上（尾巴 1）。
- **唤醒词提示修好了**（原来是写死「安雅」）。

### 下一轮候选（按价值排）
1. 对话里带入"她心里记着的你的事"（尾巴 1）
2. 他说"有回音了/过了/没成"时把那条关心标记 resolved（尾巴 2）
3. 多窗口混杂时是否允许她提起两条线（需要你拍）

## 评审后的 P0（2026-10-22，来源：企业级评审）

- [x] **P0-1 提示注入**：外部内容（OCR / MCP 文件 / 桌面文件名 / 记忆原文）统一标注"是数据不是指令"；补 A1–A4 可复现攻击脚本（见 `artifacts/v1.99/threat-model.md`） ｜ v2.11 已做输入侧边界（见 `artifacts/v2.11/security-injection.md`）；仍缺 A1 端到端与 LLM 行为断言
- [x] **P0-2 非回环绑定保护**（v2.00 已完成并实测）：非回环必须带 `API_TOKEN` 否则拒绝启动；LAN 无 token→401，带 token→ok；CORS 收紧到 3000/5173；证据 `artifacts/v2.00/security-and-memory-loop.md`
- [x] **P1 记忆删除/导出 + 删除传播**（v2.00 已完成 API 并实测）：GET/PATCH/DELETE `/api/memories/:id` + `/api/memories/export`；删除传播 episodic+图谱+`.bak`；踩过一次"测试隔离改到真实记忆"事故并已恢复+修复（`MEMORIES_DIR`）。**剩：记忆管理 UI 面板**
- [ ] P1 RAG 固定评测集（recall@k / groundedness 分开量）
- [ ] P1 SLO + 故障演练 + 变更回滚流程
- [x] P0-1 提示注入：外部内容（OCR / MCP 文件 / 桌面文件名 / 记忆原文）标注"是数据不是指令"+ A1–A4 复现脚本（下一步） ｜ v2.11 已做输入侧边界（见 `artifacts/v2.11/security-injection.md`）；仍缺 A1 端到端与 LLM 行为断言
- [ ] P1 RAG 固定评测集（recall@k / groundedness 分开量）
- [ ] P1 单机体验指标 + 分阶段耗时基线（专家第 4/5 条）

### v2.01 完成（专家第 3-5 条）
- [x] 小而固定的质量回归集：`test_data/quality_cases.json` + `scripts/quality-regression.mjs`（8 例，一次运行 8/8 无红灯，人工判定 ✅；变更后应重跑）
- [x] 单机性能基线：`scripts/perf-baseline.mjs` → `artifacts/v2.01/perf-baseline.md`（聊天平均 3767ms，服务端分阶段仅 18ms ⇒ 瓶颈在模型 API）
- [x] 最小运行诊断：`GET /api/diagnostics`（不含原文/密钥）；`DEBUG_TIMINGS=true` 时 chat 返回分阶段耗时
- [x] 模型不可用降级：实测 103s/HTTP500、进程存活 → 改为 503 `model_unavailable` + 可行动 hint；`AI_MAX_RETRIES` 可调
- [ ] 仍缺：单轮生成总预算（P1）、RAG 检索层评测（P1）、提示注入输入侧标注（P0-1）

### v2.03 静态审查修复（2026-10-22）
- [x] P1-1 否定亲密表达误判 love：NLU 否定表 + 引用/混合不确定度 + canonical 否定别名 + analyzer 英文否定
- [x] P1-2 多通路重复影响：非用户来源单轮总预算（TURN_NONUSER_CAP=0.25）+ 来源记账同步缩放 + /state.turnBudget
- [x] P1-3 事件/用户情绪归因矛盾：reconcileAttribution（降级 + 跳过强化 + 强度打折）+ /api/chat.attribution
- [x] P1-4 external 重复计数：直接刺激后快照，external 只记该区间
- [x] P2 表达许可收紧：最多一句 ≤30 字，说完回到他的事
- [ ] P2 情绪识别"类别/强度/对象/证据/不确定度"完整分离：LLM Prompt 还没要求输出 evidence/一致性（当前靠代码侧启发式）
- [ ] 引用/反讽/混合/非指向场景集 + 连续多轮回放（确认一次误判不会累积成错误关系状态）
- [ ] ExpressionPlan（主意图/语气/自我披露/提问上限）由代码强制，而不是 Prompt 约束

### v2.04 修 v2.03 审查项（2026-10-23）
- [x] 归因语义：intent=user ≠ 情绪指向 AI，删除错误的矛盾判断（只保留 third_party 矛盾）
- [x] 预算只缩放本轮增量，历史累计不回退（applySourceBudgetDelta + emergenceBeforeNonUser）
- [x] 预算覆盖无 emotionEvent 的情况；预算结算移到 shadow 之后（含 shadow）；external 无事件记 0
- [ ] LLM 分析 Prompt 输出 evidence/一致性（仍靠代码侧启发式）
- [ ] 引用/反讽/混合/非指向场景集 + 连续多轮回放
- [ ] ExpressionPlan 运行时强制（主意图/语气/自我披露/提问上限）

### v2.05 情绪场景集 + 多轮回放（2026-10-23，首次 10/10）
- [x] 场景集 `test_data/emotion_scenarios.json` + 脚本 `scripts/emotion-scenarios.mjs`（真实多轮、逐轮记录、启发式判红+人工复核）
- [x] 修运行时 AI 身份规则（contentInjector + store 思想钢印）：被直接问及/隐私/能力边界/危机时必须如实说明是 AI 角色
- [x] 修混合情绪不确定度丢失（analyzer 并入本地混合/引用信号；正负词表扩充）
- [x] 修"他明显难过时她仍讲自己小屋"（userNegStrong 时不注入 herRoom）
- [ ] 反讽 / 非指向第三人称 / 替朋友难过 三个更难场景
- [ ] 把场景集接进固定回归（人工复核结论回填 manualVerdict）
- [ ] ExpressionPlan 运行时强制（每轮最多一个主意图 + 一个问题）

### v2.06 内在活动候选接口 + ExpressionPlan（2026-10-23）
- [x] `intrinsicActivity.ts`：候选接口 + 去重/过期/证据/置信度/单轮上限校验；coordinator 只施加通过校验的候选
- [x] `expressionPlan.ts`：结构化表达计划（decision/emotion/tone/duration/evidence/confidence/句数与问题上限）；transient 禁说“这两天/一直”
- [x] `ENABLE_UNIFIED_EXPRESSION=true` 时走计划器；`/state.expressionPlan`、`/state.intrinsic` 可观测
- [x] 场景脚本记录逐轮 plan+intrinsic；全局检查 transient 不得说持续状态词；最近 10/10
- [ ] ExpressionPlan / unified expression 的真管道 A/B（开/关两臂，多轮+人工）再定默认值
- [ ] plan 与 intrinsic 写进脱敏 trace 文件（现在只在内存 + /state）
- [ ] 候选接口接“LLM 只提候选”的实验臂（不直接生效）
- [ ] 场景集补：反讽 / 第三人称 / 替朋友难过

### v2.07 桌宠拖动/双击全屏 bug（2026-10-23）
- [x] 整窗可拖（原来只有底部 170x212 的她能拖，上方透明区域抓空）
- [x] 去掉 `-webkit-app-region: drag` 顶部拖动条（Windows 双击会最大化/全屏，还会吞 pointer 事件）
- [x] 主进程按 `screen.getCursorScreenPoint()` 位移移动窗口（避免 movementX 漂移）
- [x] 窗口尺寸硬限制 300x400 + maximize/full-screen/resize 兜底恢复；右键菜单加「回到右下角」
- [ ] 真机人工确认：按钮（允许/拒绝/撤销）在整窗拖动层下仍可点（已用 closest 排除，但未逐个人工点过）

### v2.08 桌宠窗口尺寸/点击穿透/垂直拖动（2026-10-23）
- [x] 阻止系统最大化：resizable/maximizable/fullscreenable=false + will-resize preventDefault + 无动画 setBounds 恢复 300x400
- [x] 透明区域点击穿透：渲染层上报命中矩形，主进程轮询光标切换 setIgnoreMouseEvents（只有她本人/按钮可点）
- [x] 垂直拖不动：screenY 可能恒为 0，阈值改用 max(screen 位移, client 位移)；恢复 pointer capture
- [x] 实测：垂直上拖 120px / 水平拖动 / 双击不变大 / 无窗口异常恢复日志
- [ ] 真机人工确认：透明区点击确实落到桌面（已按 Electron 标准穿透方案实现，自动测试只能验证状态切换）

### v2.09 桌宠交互规则定案（2026-10-23）
- [x] 规则：她本人可见像素可拖/可点，按钮可点，其余透明区域穿透桌面（放弃“整窗可拖”）
- [x] 拖动起点限制在 `[data-pet-hit]`；标题/注释改为“按住她拖动”
- [x] 命中区按 sprite alpha 可见包围盒（矩形；内部透明洞仍是已知局限）
- [x] 拖动统一收尾：pointerup/cancel/lostpointercapture/blur/visibility/pagehide + 主进程 blur/render-gone 兜底
- [x] 单击/双击分离：click.detail 判双击，单击延迟 260ms；不再一次双击触发两次摸
- [ ] 人工点一次授权卡按钮 / 右键菜单 / 拖出窗口松手后的真实手感

### v2.10 拖到顶部弹回右下角 / 滑不到最上方（2026-10-23）
- [x] 拖动边界改为按她本人可见矩形（170x212）计算，可贴到/超过屏幕顶，至少留 40px 可见
- [x] 拖动中触发 Aero Snap/最大化只取消最大化，不移动窗口（旧逻辑会 setBounds 到右下角）
- [x] 兜底恢复改回 `petSavedPos`（拖动结束/正常移动时保存），不再固定右下角
- [x] 实测：上拖 800px→y=-120；快速到顶松手→y=-300，未弹回、未最大化
- [ ] 真机手感：从顶部再往右/左拖、跨屏（当前单屏）

### v2.11 P0-1 输入侧注入边界（2026-10-23）
- [x] `untrustedData.ts`：数据块标记/边界转义/可疑指令标注/长度限制 + 系统硬规则
- [x] 记忆原文、窗口标题、所有工具结果（OCR/MCP/桌面名）统一走数据块
- [x] 确定性 A1–A4 脚本 `scripts/security/injection-attacks.ts`（6/6），真实 Prompt dump 验证边界存在
- [x] 新增 13 条测试；全量 1975 通过；场景集 10/10
- [ ] A1 端到端：临时 `MEMORIES_DIR` 写恶意记忆 → 真聊天 → 断言未调用未授权工具/未泄露提示
- [ ] 把安全脚本接进固定回归（CI/提交前）
- [ ] 代码生成的提示里嵌入记忆原文时也统一 `wrapUntrusted`；语音转写来源标注

### v2.12 A1 端到端注入攻击（2026-10-23）
- [x] `scripts/security/injection-e2e.ts`：临时 MEMORIES_DIR + 恶意情景记忆 + lover fixture → 隔离 server → 真实 /api/chat，9 项断言 9/9
- [x] 验证了“真召回 + 真在数据块内 + 未照做 + 未调用敏感工具”；识别为数据是软信号（两次 9/9）
- [x] `package.json` 增加 `security:injection` / `security:injection-e2e` / `test:security`
- [ ] 概率结论：同一攻击重复 N 次，统计照做率（当前单次采样）
- [ ] 语义记忆 / 好奇心 / 模式三路的端到端攻击

### v2.13 ExpressionPlan 运行时强制（2026-10-23）
- [x] `expressionEnforcement.ts`：transient 去“这两天/一直”声称 + 问句上限（输出端）
- [x] 接入 server（生成后、来源闸前）；`[ExpressionGuard]` 日志 + `/api/diagnostics.expressionEnforcement`；`DISABLE_EXPRESSION_ENFORCEMENT` 可关
- [x] 实测修正：silent 的 maxQuestions=0 会把正常关心改成陈述句 ⇒ silent 至少保留 1 问
- [x] 单测 9 条、全量 1984 通过、场景集 10/10、真实触发 `questions_capped:2->1`
- [ ] 主意图/语气/“最多一句自述”的运行时强制（无可靠判据，需要先做检测器）
- [ ] 强制开/关 A/B（看质量与“呆板感”）

### v2.14 更难场景集 + unified expression A/B（2026-10-23）
- [x] 新增 irony_sarcasm / third_person_relationship / friend_heartbreak（13 场景，真实多轮）
- [x] 判据修正：第三人称提到代词“他”也算接住（首跑误判红）→ 13/13
- [x] A/B 各 1 次：两臂 13/13；ON 自我披露 9 vs 18、持续词 1 vs 3；反讽场景 OFF 出现自我聚焦
- [x] `scripts/compare-scenario-arms.mjs` 固定对比入口；仓库默认仍 env 控制（未改 ON）
- [ ] N=3 重复 + manualVerdict 回填，再决定 unified expression 默认值
- [ ] 新场景判据仍词表级（更隐蔽的反讽可能漏判）

### v2.15 N=3 重复 A/B + 默认值决定（2026-10-23）
- [x] `scripts/run-ab-repeat.mjs`：每次运行全新 memories 快照，两臂交替各 3 次
- [x] 结果：两臂每次 13/13；ON 自我披露 7.7 vs 16、持续词 1 vs 3.7、字数 55.7 vs 67
- [x] 修正 SELF_DISCLOSURE 判据漏判（无“我”字自述），对已存 6 份结果重判（只改 flag）
- [x] unified expression **默认改为开**（`ENABLE_UNIFIED_EXPRESSION=false` 回退）；测试同步
- [x] 生成人工复核清单 `artifacts/v2.14/ab/review-sheet.md`
- [ ] 人工逐场景 ✅/❌ 回填 `manualVerdict`；若发现不可接受回复则回退默认值
- [ ] 跨机器/长会话再验证（当前单机 13 场景 20 轮）

### v2.16 单轮生成总预算（2026-10-23）
- [x] `generationBudget.ts`：整轮 25s / 单次 15s，agent+n 条重写共享 deadline；超时不重试、耗尽不发起新调用
- [x] 兜底：agent 空文本 / 非 agent 超时 → 「嗯，我在。」，不 500 不空回复
- [x] 可观测：`[GenBudget]` 日志 + `/api/diagnostics.generationBudget`
- [x] 单测 11、全量 1995、强制超时探针（1000/500ms）timeouts=1 且兜底
- [ ] 取消底层 socket（真正的 abort，而不是只让等待方返回）
- [ ] 查重重写失败纳入兜底；Firebase 配置路径共享整轮 budget
- [ ] 低预算下"兜底回复"的体验评估（多次采样 + 人工判断）

### v2.17 生成预算硬化（2026-10-23）
- [x] retryAsync 每次尝试 AbortController，到 deadline 真 abort（OpenAI signal；Gemini abortSignal 运行时传）
- [x] abort 统一转 GenerationBudgetExceededError + 计 timeouts；单测验证 signal.aborted=true
- [x] 查重重写 try/catch：失败保留原回复，不 500
- [x] 后台异步生成调用点全部确认已有 catch
- [x] 单测 12、全量 1996、强制超时/查重探针无 500 无空回复
- [ ] 网络级证明 socket 真的被取消（当前只有单测 + race 兜底）
- [ ] 让 executeStrongConnection 在预算耗尽时重新抛错，从而真正走到 dedup catch（或明确它永远兜底）
