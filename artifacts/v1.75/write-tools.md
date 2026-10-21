# v1.75 写类工具：remember_this / set_followup（都走审计层）

> 工具总数 6：读 4（check_my_state / recall_memory / time_now / recall_recent_events）+ 写 2。
> 写类是本项目第一次让"她"主动改长期状态，所以全部走审计层、可回退。

## remember_this → `memories/her_notes.jsonl`

```
校验：4~80 字；拒绝元描述（"作为一个AI"/系统提示）；只追加、不覆盖；512KB 滚动 + 保留 3 份
实测（3 轮真管道）：她调用 2 次，写进两条——
  「他下周三要去体检，记得到时候问一下结果和感受」
  「他明天这个点出面试结果，记得问一句。」
```

## set_followup → `memories/her_followups.json` + proactive 通路

```
校验：内容 4~120 字；dueInHours 0.5~72（他说具体时间时应先调 time_now 算差值）
边界：未发上限 20；超过 7 天作废；发过即标记不重发；
到点后**仍受 proactive 全部闸门**（时间窗/配额/空闲/低谷矜持），不绕过
实测：她调用 2 次并落了一条（「下午三点了——面试结果那边有消息了吗？记得去问一下。」）
到点发送链路：抽成 pickDueFollowup() 纯函数（3 条单测：闸门关不接管 / 有到点项接管 / 无到点项交回动机）
⚠️ 本次 live tick 被"22:00 不在 9:00~22:00 时间窗"挡下 —— 这是**按设计的闸门**，不是 bug；
   时间窗内的真实发送尚未在 live 中验证（单测覆盖判定逻辑）。
⚠️ 已知问题：她说"明天下午三点"，落库 dueAt 只有 +3h（模型把"三点"当 3 小时后）——
   已把"说具体时间先调 time_now"写进工具描述，但**未复测**，下一刀要专门校准。
```

## 回退

```
ENABLE_HER_NOTES=false / ENABLE_HER_FOLLOWUP=false（本机 .env 目前都为 true）
删 memories/her_notes.jsonl / her_followups.json ⇒ 状态清空，不影响其它
```
