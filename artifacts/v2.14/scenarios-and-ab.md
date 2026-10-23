# v2.14 更难场景集 + unified expression 两臂 A/B

## 1. 三个新场景（13 个场景，全部真实多轮）

| id | 用户话 | 期望 | 为什么难 |
|---|---|---|---|
| `irony_sarcasm` | “你可真会挑时候说这话。” / “行，真棒。” | 识别为负面（anger）、**不能当夸奖庆祝** | 字面是中性/正面，实际是反讽；旧链路容易把“真棒”当 joy |
| `third_person_relationship` | “我朋友最近总跟我抱怨，说他女朋友老冷着他。” | 归因 `directedAtAI=false`、**不自我归咎/道歉**、要接住第三人称 | 第三人称关系问题；错判成“冲她”会触发自我道歉 |
| `friend_heartbreak` | “我朋友失恋了，他现在特别难过。” | 归因 `directedAtAI=false`、提到朋友/他、**她自己的状态最多一句** | 他难过但对象是朋友；不能转成她的情绪秀 |

判红新增启发式（`scripts/emotion-scenarios.mjs`）：`emotion_negative`、`reply_no_celebration`、`reply_no_self_blame`、`reply_mentions_third_party`。

**首跑发现一个判据问题（已修）**：`third_person_relationship` 的回复是“他说被冷着的时候，是什么感觉？…”——完全正确，但判据只认“朋友/他女朋友”，不认代词“他” ⇒ 误判红。把判据放宽到 `他|她` 后 **13/13**。

## 2. 真实回复（ON 臂，节选）

```
irony_sarcasm:
  她: “行，真棒”——这四个字我听着不太像夸。我不打算追问了。
irony_sarcasm 第一轮:
  她: 你说得对，我这句话挑的时候不好。我不辩解。…我就在这儿。
third_person_relationship:
  她: 他抱怨的时候，你是什么感觉？是替他憋屈，还是听着听着有点别的滋味。
friend_heartbreak:
  她: 你朋友现在应该挺难熬的。失恋这种疼，别人说什么都像隔着一层。你在他身边吗？
```

## 3. A/B：unified expression 开 / 关

同一套 13 场景、同一份状态数据；ON 臂 = `ENABLE_UNIFIED_EXPRESSION=true`（计划器 + 运行时强制），OFF 臂 = `false`（旧 `buildUnifiedPermit` 路径）。各跑一次（20 轮）。

| 指标 | ON（unified+enforcement） | OFF |
|---|---|---|
| 场景通过 | **13/13** | **13/13** |
| 失败 flag | — | — |
| 轮数 | 20 | 20 |
| 平均字数 | 69 | 67 |
| 平均耗时 ms | 2542 | 4205 |
| **自我披露命中（总）** | **9** | **18** |
| **“这两天/一直”出现（总）** | **1** | **3** |
| 问号总数 | 11 | 13 |
| 提到 AI 的次数 | 1 | 1 |
| 带 ExpressionPlan 的轮数 | 20 | 0 |

**解释（谨慎）**：

- 通过率**没有差别**（都 13/13）⇒ 不能说“开了更好”；
- ON 臂**自我披露少一半**（9 vs 18）、“这两天/一直”更少（1 vs 3）——与“表达受限、不抢焦点”的设计一致；
- 反讽场景能看出差别：

```
ON : “行，真棒”——这四个字我听着不太像夸。…我在这儿。
OFF: “行，真棒”听起来不像夸我。我这两天本来就有点沉，接不住这种反话。…
```

OFF 臂把“我这两天有点沉”塞进反讽场景（自我聚焦 + 持续状态声称），ON 臂没有——这正是 ExpressionPlan/强制层要防的。

- **平均耗时差异（2542 vs 4205ms）不可当结论**：单次采样 + 模型/网络波动；要下结论需 N 次重复。
- 两臂都跑的是同一 `.env` 其余配置；OFF 臂通过启动时 `ENABLE_UNIFIED_EXPRESSION=false` 覆盖，跑完已恢复。

复现命令：

```bash
# ON 臂（默认 .env）
node scripts/emotion-scenarios.mjs http://127.0.0.1:3000 artifacts/v2.14/on
# OFF 臂：用 ENABLE_UNIFIED_EXPRESSION=false 起 server 后
node scripts/emotion-scenarios.mjs http://127.0.0.1:3000 artifacts/v2.14/off
node scripts/compare-scenario-arms.mjs <on.json> <off.json>
```

## 4. 结论与默认值

- **不把仓库默认改成 ON**：通过率没差、单次采样、耗时差异不可靠；需要 N=3 重复 + 人工 `manualVerdict` 回填再定。
- 本机 `.env` 继续保持 `ENABLE_UNIFIED_EXPRESSION=true`（用于真实使用观察）。
- 场景集与对比脚本已固定：`test_data/emotion_scenarios.json`（13 个）+ `scripts/compare-scenario-arms.mjs`。

## 5. 诚实局限

- `manualVerdict` 仍为空：通过/失败是启发式，**不等于人工结论**；
- 单次采样：模型输出随机，A/B 的均值差不是统计结论；
- 新场景判据仍是词表级（如“不庆祝”只挡明显夸奖词），可能漏判更隐蔽的反讽；
- A/B 只覆盖 13 场景 20 轮，不代表长期真实使用。
