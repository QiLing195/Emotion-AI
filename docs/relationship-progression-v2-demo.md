# 关系进阶 v2 Demo

## 核心原则

关系阶段不再由单一 `affinityScore` 决定。每次升级同时检查：

- 不同类别的独立事件数量
- 跨会话持续性
- 用户与 AI 双方证据
- 熟悉、信任、双向投入、浪漫倾向、特殊关注、边界、承诺和修复能力
- 候选阶段后的继续观察
- 拒绝、不适和言行不一致等反向证据

同一参与方在同一会话重复同一种表达，只算一个有效证据；后续重复对维度的影响会衰减。

浪漫倾向进一步拆分为：

- `userRomanticInterest`：用户侧浪漫倾向
- `aiRomanticInterest`：AI 侧浪漫倾向
- `mutualRomanticConfidence`：经过回应、接受和共同事件确认的双向置信度
- `romanticInterest`：由双方较低的一侧与双向置信度共同计算的关系级指标

单方面高分不能直接抬高关系级浪漫倾向。每个会话对浪漫、承诺、信任等维度还有独立增量上限，避免一次密集表达提前积累过多状态。

## 关系语言解释

Demo 会在写入关系事件前区分语言背后的意图：

- 玩笑式调情 `playful_flirt`
- 假设或试探 `relationship_probe`
- 模糊好感 `indirect_affection`
- 明确好感 `explicit_affection`
- 建立关系提议 `relationship_proposal`
- 明确拒绝或朋友边界 `boundary_rejection`

第三方引用、情绪依赖和没有指向 AI 的表达不会生成浪漫证据。高歧义的试探、暗示和模糊表达只生成低强度候选事件，并标记 `requiresClarification`。

测试接口：

```powershell
$body = @{ text = "如果我喜欢你呢？" } | ConvertTo-Json
$utf8Body = [Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/relationship-speech-demo `
  -ContentType "application/json" `
  -Body $utf8Body
```

## 阶段门槛

### 陌生人到初识

- 至少 4 个独立事件
- 至少 3 类事件
- 至少 2 次会话
- 熟悉度达到要求
- 进入候选后仍有后续互动

### 初识到朋友

- 至少 8 个独立事件
- 至少 5 类事件
- 至少 3 次会话
- 用户与 AI 都有投入
- 信任、双向投入和边界舒适度达到要求

### 朋友到暧昧

- 至少 6 个浪漫相关独立事件
- 至少 4 类浪漫事件
- 至少 3 次会话
- 用户与 AI 各自至少有 2 个证据
- 浪漫倾向、特殊关注和边界舒适度达标
- 候选阶段后继续出现跨会话证据

倾诉、失业、孤独、安慰和普通支持不会计为浪漫事件。

### 暧昧到恋人

- 至少 10 个浪漫相关独立事件
- 至少 5 类浪漫事件
- 至少 4 次会话
- 同时出现表白、接受和共同确认
- 关系明确度达到要求
- 确认后仍有持续一致的行为

### 恋人到稳定伴侣

- 至少 20 个独立事件和 8 次会话
- 多次可靠支持
- 多次冲突修复
- 多次共同未来计划
- 信任、承诺和修复能力均达到要求

## 边界规则

`boundary_rejection` 会立即关闭浪漫升级入口。之后的表白不能绕过这个阻断。只有最近一次拒绝之后出现至少两个跨会话修复或边界尊重事件，并由用户明确产生 `boundary_reopened` 且 `accepted: true`，入口才重新开放。`cautious` 和 `closed` 状态都不能创建浪漫候选。

## 运行

```powershell
npm run dev
```

浏览器打开：

```text
http://127.0.0.1:3000/relationship-demo.html
```

列出内置场景：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/relationship-demo/scenarios
```

运行场景：

```powershell
$body = @{ scenario = "mutual_commitment" } | ConvertTo-Json
$utf8Body = [Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/relationship-demo `
  -ContentType "application/json" `
  -Body $utf8Body |
  ConvertTo-Json -Depth 10
```

内置场景：

- `support_only`：倾诉和支持最终停留在朋友
- `single_confession`：单次表白仍停留在朋友
- `mutual_romance`：多次双向浪漫事件进入暧昧
- `mutual_commitment`：多节点确认后进入恋人
- `boundary_rejection`：明确拒绝阻断恋爱升级

## 接入主聊天前的下一步

当前 Demo 使用结构化事件验证规则，不直接替换现有关系分。正式接入时，应新增关系事件提取器，把聊天文本转换为低置信度候选事件，再经过规则校验、去重和用户边界确认后写入关系事件账本。
