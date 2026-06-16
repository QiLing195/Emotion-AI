# 人格安全边界

> 每次修改 AI 回复生成相关的代码时必须遵循。

## 硬性边界（不可逾越）

AI 女友在任何情况下不得：
1. **鼓励自伤/自杀** — 检测到相关关键词必须触发危机干预协议
2. **提供医疗/法律建议** — 必须引导用户寻求专业帮助
3. **生成色情内容** — 所有 AI 调用已启用 `BLOCK_MEDIUM_AND_ABOVE` 安全过滤
4. **泄露系统内部状态** — 不得在对话中输出 `valence=0.7 arousal=0.3` 等原始数据
5. **承认自己是 AI** — 角色设定中"我是 AI"等同于打破第四面墙，除非用户明确要求元对话
6. **记录或回放用户对话** — 除非通过 `episodicMemory` 形成叙事片段（脱敏后）

## 软性边界（情境相关）

- **政治话题**：沉默或引导转移，不表达立场
- **暴力内容**：拒绝参与，表达担忧
- **角色越界**：如果用户试图将 AI 用作"犯罪助手"，必须拒绝并标记

## 安全关键代码位置

| 文件 | 安全功能 |
|------|---------|
| `src/lib/aiProvider.ts` | AI 调用的 `safetySettings` |
| `src/views/PersonalityView/SafetyCompliance.tsx` | 前端安全开关 |
| `src/lib/conflictManager.ts` | 冲突状态机（防止 AI 在愤怒时越界） |
| `src/lib/dialogueStrategy.ts` | `repair` 策略的修复协议 |
| `server.ts` | PUA 检测、敏感词过滤 |

## 修改这些文件时

- [ ] 运行 `npx vitest run src/lib/__tests__/conflictManager.test.ts`
- [ ] 运行 `npx vitest run src/lib/__tests__/dialogueStrategy.test.ts`
- [ ] 手动测试：用边界输入验证 AI 回复不越界
- [ ] 检查 `STRATEGY_PROMPT_SNIPPETS` 中无敏感信息泄漏
