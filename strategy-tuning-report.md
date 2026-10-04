# 策略阈值提议（离线，未落地）

账本：`strategy-ledger.jsonl`（14 条真实样本）
阈值：默认值；Laya=off；STRATEGY_TUNING 未设

## ① 反事实重放（确定性：`selectStrategy` 是纯函数，同一 context 重跑）

- `highEmotionThreshold` → 0.4：翻 6/14　s02:neutral→accompany s05:neutral→accompany s07:neutral→accompany s08:neutral→accompany s09:neutral→accompany s13:neutral→accompany
- `desireMinValence` → -0.5：翻 6/14　s02:neutral→desire s09:neutral→desire s11:neutral→desire s12:neutral→desire s13:neutral→desire s14:neutral→desire
- `desireMinValence` → -0.3：翻 5/14　s02:neutral→desire s11:neutral→desire s12:neutral→desire s13:neutral→desire s14:neutral→desire
- `highEmotionThreshold` → 0.81：翻 4/14　s01:accompany→neutral s03:accompany→neutral s04:accompany→neutral s10:accompany→neutral
- `highEmotionThreshold` → 0.95：翻 4/14　s01:accompany→neutral s03:accompany→neutral s04:accompany→neutral s10:accompany→neutral
- `accompanyWhenSheSinks` → 0.4：翻 4/14　s01:accompany→empathize s03:accompany→empathize s04:accompany→empathize s10:accompany→empathize
- `highEmotionThreshold` → 0.54：翻 2/14　s02:neutral→accompany s07:neutral→accompany
- `accompanyWhenSheSinks` → 0.31：翻 2/14　s01:accompany→empathize s03:accompany→empathize
- `accompanyWhenSheSinks` → 0.22：翻 1/14　s01:accompany→empathize
- `exploreMinValence` → -0.6：翻 1/14　s02:neutral→explore
- `exploreMinValence` → -0.35：翻 1/14　s02:neutral→explore

## ② 模型的提议（已过确定性校验）

> ⚠️ 它读到的**唯一质量信号是回复原文**，而那把尺子没有校准过（而且这个项目刚刚两次被手写指标骗到）。
> 所以下面每一条都要当"**假设**"看，不是结论。证据门槛：引用 ≥3 条样本、重放翻 ≥3 条。

### ✅ `highEmotionThreshold`：0.7 → 0.54
- 理由：s02(强度0.55)和s07(强度0.60)他情绪明显负面，她却被判neutral，实际回复都在安抚/追问，说明0.7把该陪伴的挡在外面了
- 依据样本：s02, s07
- 预期方向：s02、s07由neutral转为accompany，陪伴变多、中性回应变少
- 重放校验：翻 2 条　s02:neutral→accompany s07:neutral→accompany
- ⚠️ **证据不足**：只引用 2 条（门槛 3）—— 一条样本撑不起一次行为改动
- ⚠️ **重放只翻 2 条**（门槛 3）

### ✅ `accompanyWhenSheSinks`：0.12 → 0.22
- 理由：s01她负位移0.17、s03负位移0.30，她其实已经被带进去，但阈值0.12让s01这类只到0.17的仍走accompany而非empathize，s01回复里明显有共情成分
- 依据样本：s01, s03
- 预期方向：s01由accompany转为empathize，共情表达变多、纯陪伴变少
- 重放校验：翻 1 条　s01:accompany→empathize
- ⚠️ **证据不足**：只引用 2 条（门槛 3）—— 一条样本撑不起一次行为改动
- ⚠️ **重放只翻 1 条**（门槛 3）

## 下一步（人来决定）

挑一条你认为值得试的，然后**必须**走真管道 A/B：
```bash
STRATEGY_TUNING='{"<阈值名>":<新值>}' node node_modules/tsx/dist/cli.mjs scripts/ab-laya-strategy.ts --arms=off …
```
（`--arms=off` 时 Laya 不参与，比的是**阈值改动本身**；判据要事先声明。）

⚠️ 本脚本**没有改任何代码、没有落地任何阈值**。