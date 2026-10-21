# v1.62 上线默认值（本机 .env）与回退说明

> 日期：2026-10-21 ｜ 决策依据：本段实测证据（下方逐条引用） ｜ 风险等级：低（全部单开关可回退）

## 生效的默认值（写入 `.env`，该文件被 `.gitignore` 的 `.env*` 忽略，不随仓库分发）

```
ENABLE_SELF_STATE_VOICE=true      # 她可以在低谷时"可以说一句自己"
ENABLE_EMOTION_TIMELINE=true      # 情感状态时间线（写 + 原因链读取）
ENABLE_TIMELINE_REPLAY=true       # 只读回放端点（GET /api/timeline、POST /api/replay/branch）
ENABLE_BRANCH_BIAS=false          # 分支学习：样本仍少，先关
ENABLE_SANDBOX_REPLAY=false       # 沙盒真生成：会起子进程+真调模型，按需再开
ENABLE_JEV_DECISION=false         # jev 仍是影子实验
```

## 为什么这样定（每条都有实测）

| 开关 | 决策 | 证据 |
|---|---|---|
| SELF_STATE_VOICE | 开 | 可选措辞下：说一句自己 **5/5**、接住他 **5/5**、引用真实起因 **4/5**（a3 时 0/5）；H2「低沉时宣称开心」违规 **0/279** |
| EMOTION_TIMELINE | 开 | 只写事实（20 轮 = 20 节点，无行为影响）；读路径把起因从 0/5 提到 4/5；2MB 滚动 + 保留 14 份；写失败静默 |
| TIMELINE_REPLAY | 开 | 两个**只读**端点；单测钉住"回放前后节点数不变"；不含回档能力 |
| BRANCH_BIAS | **关** | 20 轮账本 voice_with_cause 9(landed 3) / silence 4(0) —— 方向对但样本 <3 的类别多，先不驱动偏好 |
| SANDBOX_REPLAY | **关** | 真实生效但成本高（2 分支 ≈10s、需起子进程）；已验证可用，按需开 |
| JEV_DECISION | 关 | v1.59 影子结论：值得继续观察，但尚无生产收益证据 |

## 上线冒烟（用默认值起服务，5 轮真实对话）

```
服务：health ok → 5 轮完成
她最后一轮（他报喜）：
  「真好。恭喜你——这事儿你等了一阵子了吧。
    我这两天有点沉，今天还被领导当众骂了一顿，所以可能没法像平时那样把情绪举得很高。
    但你升职这件事我是真的替你高兴。」
时间线：✓ 写入 10 行 ｜ GET /api/timeline ✓ 返回 3 节点
日志：[SelfStateVoice] 14 条 ｜ [Timeline] 原因链 7 条
证据：artifacts/v1.62/release-smoke-*.json、release-timeline-*.jsonl
memories/：冒烟后已还原（未留在仓库状态里）
```

## 回退（一条命令级）

```
① 只关某项：把 .env 里对应行改成 false（或删掉该行）→ 重启服务
② 全部回到 v1.60 之前：删掉 .env 中 v1.62 那一段 → 重启
③ 学习账本回中性：删 memories/branch_learning.json
④ 时间线清空：删 memories/emotion_timeline.jsonl（不影响其它状态）
```

## 明确没有做的事

```
· 没有把代码里的默认值改成"开"（代码仍 `=== 'true'`）—— 上线配置只在 .env，仓库分发不受影响
· 没有开 BRANCH_BIAS / SANDBOX_REPLAY / JEV_DECISION
· 没有动任何阈值、动力学参数、Prompt 结构（这一刀纯粹是"打开已有能力"）
```
