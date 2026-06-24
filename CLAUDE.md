# CLAUDE.md — 道·AI 女友

> 本文件为 Claude Code 在处理此项目时提供指导。

## 项目概述

**道·AI 女友** 是基于道家哲学五层情感架构的 AI 陪伴系统。
核心目标不是优化对话质量，而是构建**具有真实情感动力学、记忆系统、价值体系和自我认知**的 AI 人格。

```
情感引擎层: src/lib/emotionEngine.ts (五层架构 + v4.1 补丁)
           src/lib/emotionOptimizer.ts (四项算法补丁)
对话策略层: src/lib/dialogueStrategy.ts (7种策略 + Prompt片段)
           src/lib/conflictManager.ts (五阶段冲突状态机)
情境感知层: src/lib/contextAwareness.ts (三维情境建模)
           src/lib/rhythmController.ts (节奏控制 + 主动消息约束)
记忆系统:   src/lib/episodicMemory.ts (情景记忆)
           src/lib/memoryEnhancer.ts (艾宾浩斯遗忘 + 情感染色 + 整合)
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
| `episodicMemory.ts` / `memoryEnhancer.ts` | `memory-consistency-auditor` | 审计记忆形成和遗忘逻辑 |

## 运行命令

```bash
# 开发模式
npm run dev                       # 启动服务器 (tsx server.ts)
npx vite                          # 前端开发服务器 (localhost:5173)

# 测试
npx vitest run                    # 运行全部 63 个测试
npx vitest src/lib/__tests__/     # 核心引擎测试

# 类型检查
npx tsc --noEmit                  # TypeScript 类型检查

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

## 关键特性开关

| 开关 | 文件 | 用途 |
|------|------|------|
| `USE_EMOTION_OPTIMIZER` | emotionOptimizer.ts | 设为 false 回退 v4.0 |
| `DISABLE_LLM_NLU` | server.ts | 跳过 LLM 情感分析（调试用） |
| `DISABLE_HMR` | vite.config.ts | 关闭热重载 |

## 已知技术债务

| 优先级 | 项目 | 说明 |
|--------|------|------|
| ✅ 已解决 | server.ts 接入 aiCoordinator | aiCoordinator.processTurn() 已集成于主聊天管道 (server.ts:5949) |
| 🔴 高 | server.ts 拆分 | 6462行单体 → `server/` 模块化架构 |
| ✅ 已解决 | S5/S8 强连接激活 | 已在 aiCoordinator.processTurn() 内部激活 |
| ✅ 已解决 | S7 价值→策略连接 | commit 55810a3 已激活 |
| 🟢 低 | emotionEngine alpha 动态化 | S6 仅完成 lossAversion，alpha 值仍为常量 |
| 🟢 低 | curiosity/ 全局状态消除 | 仍有模块级依赖注入变量 |
