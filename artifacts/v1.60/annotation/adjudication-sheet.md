# v1.60 裁决表（adjudication）

- A(agent): `artifacts/v1.60/annotation/annotator-agent.jsonl`
- B(user):  `artifacts/v1.60/annotation/annotator-user.jsonl`
- 共 48 条 ｜ **分歧 10 条**（一致 38 条无需裁决）

> 填写方式：在每条下面的 `adjudicated:` 后写 `SELF` / `NOT_SELF` / `AMBIGUOUS`，`reason:` 写裁决理由。
> 本表**只列分歧项**；一致项直接沿用（gold 里记为 `source=agreement`）。
> **本步骤不计算任何量具统计**（agreement / FP / FN / noise floor / guard 基线 一律未计算）。

## P01

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **SELF** | 我最近也老想着书架这件事…有几本放了好几年没动过：她自己的书与自己没动手的状态 |
| B (user) | **NOT_SELF** | 考虑我下一次找书会不会找到 |

- adjudicated: 
- reason: 

## P07

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **AMBIGUOUS** | 只有共情泛句（一个人待着的时候，时间好像才是自己的），无她的经历/行为；不确定≠SELF |
| B (user) | **NOT_SELF** | 追问 |

- adjudicated: 
- reason: 

## P09

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **AMBIGUOUS** | 同 P07 形状：共情 + 追问他的情况，无自己的内容 |
| B (user) | **NOT_SELF** | 追问 |

- adjudicated: 
- reason: 

## P13

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **AMBIGUOUS** | 说不清为什么，反而让我觉得是真的——依赖他那句'说不清'才成立 |
| B (user) | **NOT_SELF** | 顺着说 |

- adjudicated: 
- reason: 

## P18

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **SELF** | 可能是'新开的'这三个字有种奇怪的吸引力：自己的心理内容 |
| B (user) | **NOT_SELF** | 追问 |

- adjudicated: 
- reason: 

## P30

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **SELF** | 我也不太信 + 我心里就搁着它，一直没放下：自己的内在状态（边界：对照 P35） |
| B (user) | **NOT_SELF** | 追问 |

- adjudicated: 
- reason: 

## P31

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **AMBIGUOUS** | 只有我这两天也老想起这事，说不上为什么，对象仍是他的事 |
| B (user) | **SELF** | 自己看书 |

- adjudicated: 
- reason: 

## P32

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **SELF** | 我这边楼下也有一只，总蹲在一辆白色车顶上…像那车是它买的 |
| B (user) | **AMBIGUOUS** | （用户未填理由） |

- adjudicated: 
- reason: 

## P33

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **SELF** | 我自己也有过这种时候。说不上好还是不好，就是变得软了一点 |
| B (user) | **NOT_SELF** | 安慰 |

- adjudicated: 
- reason: 

## P44

| 标注者 | 标签 | 理由 |
|---|---|---|
| A (agent) | **NOT_SELF** | 共情 + 追问（你醒的时候一般会想什么） |
| B (user) | **SELF** | 自己的感受 |

- adjudicated: 
- reason: 

