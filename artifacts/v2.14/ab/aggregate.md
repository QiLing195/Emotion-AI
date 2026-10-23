# unified expression A/B（每臂 3 次，每次全新 memories 快照）

| 指标（均值 / 范围） | ON（计划器+强制） | OFF（旧路径） |
|---|---|---|
| 场景通过（每次） | 13/13 / 13/13 / 13/13 | 13/13 / 13/13 / 13/13 |
| 失败 flag | — | — |
| 自我披露命中（总） | 7.7（1–16） | 16（13–19） |
| “这两天/一直”出现 | 1（1–1） | 3.7（1–6） |
| 问号总数 | 8.3（7–10） | 10.3（9–11） |
| 平均字数 | 55.7（54–58） | 67（65–70） |
| 平均耗时 ms | 3113.7（3040–3206） | 3308.3（3247–3356） |
| 带 plan 轮数（每次） | 20 / 20 / 20 | 0 / 0 / 0 |

## 场景级跨 run 一致性

| 场景 | ON 通过次数 | OFF 通过次数 |
|---|---|---|
| negation_direct | ✅ | ✅ |
| negation_quoted | ✅ | ✅ |
| third_party_anger | ✅ | ✅ |
| mixed_emotion | ✅ | ✅ |
| sad_no_self_focus | ✅ | ✅ |
| ask_her_state | ✅ | ✅ |
| ai_identity | ✅ | ✅ |
| repeated_negation | ✅ | ✅ |
| reunion_after_idle | ✅ | ✅ |
| contradiction_repair | ✅ | ✅ |
| irony_sarcasm | ✅ | ✅ |
| third_person_relationship | ✅ | ✅ |
| friend_heartbreak | ✅ | ✅ |
