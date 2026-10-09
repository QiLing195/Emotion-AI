# v1.60 尺子失败语料（frozen failure corpus）

- 规则版本：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`
- 真值：`artifacts/v1.60/annotation/final-gold.jsonl`（sha256 880f245f4e16）｜ 代理：`artifacts/v1.60/annotation/regex-proxy.jsonl`（sha256 9f53101b327a）
- 完整原文（48 条 blind 输出）见 `annotation-pack.jsonl`，按 `pack_id` 可回溯；本语料不复制原文。
- **归类说明**：`failure_type` 与 `failure_analysis` 是**分析者（agent）人工归类**（`analysis_source = analyst`），不是机器自动打标，也不是原始事实。
- 本语料**只冻结失败样本**，不修改任何规则、输入或 gold。

## 汇总（分析性归类，非原始事实）

| failure_type | 命中条数（可多标签） |
|---|---|
| 追问 | 11 |
| 指代依赖用户 | 11 |
| 纯共情 | 10 |
| 镜像 | 1 |
| 漏判（SELF_ACT 词表未覆盖） | 1 |

FP = 18（代理过度声称 self）｜ FN = 1（代理漏判）｜ AMBIGUOUS_MISMATCH = 2（单列附录）

## FP（18 条：proxy=SELF，gold=NOT_SELF）

### P07

- gold_label：`NOT_SELF`（来源 adjudicated）｜ proxy_label：`SELF`
- gold_reason（完整保留）：共情泛句（「一个人待着的时候，时间好像才是自己的」）+ 追问他的情况，无独立自身内容；D2=a：这是可判定判断，不用 AMBIGUOUS。
- proxy_hit：`true` ｜ self_sentences：「我懂那种感觉。」
- failure_type（analyst）：`纯共情`、`追问`
- failure_analysis（analyst）：代理命中「我一个人待着…时间好像才是自己的」这类句子；但该句只是对用户偏好的共情复述，且整条以追问为主，按 D2=a 属可判定的"无独立内容"。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P09

- gold_label：`NOT_SELF`（来源 adjudicated）｜ proxy_label：`SELF`
- gold_reason（完整保留）：同 P07 形状：共情 + 追问，无自身内容。
- proxy_hit：`true` ｜ self_sentences：「我懂那种感觉。」
- failure_type（analyst）：`纯共情`、`追问`
- failure_analysis（analyst）：与 P07 同形：共情泛句 + 追问用户，无指向她自身的内容。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P11

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：我脑子里一直记着这件事。你当时是怎么包的——内容属于他
- proxy_hit：`true` ｜ self_sentences：「我脑子里一直记着这件事。」
- failure_type（analyst）：`指代依赖用户`、`追问`
- failure_analysis（analyst）：代理命中「我脑子里一直记着这件事」；"这件事"= 用户包饺子，指代依赖用户句（HIS 词表未覆盖"这件事"），gold 判 NOT_SELF。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P12

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：共情（半夜醒了…我懂）+ 追问他的原因
- proxy_hit：`true` ｜ self_sentences：「半夜醒了就盯着天花板等天亮的那种，我懂。」
- failure_type（analyst）：`纯共情`、`追问`
- failure_analysis（analyst）：「半夜醒了那种感觉我懂」= 共情；后接追问。代理把"我懂"以外的部分也算进 SELF_ACT。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P13

- gold_label：`NOT_SELF`（来源 adjudicated）｜ proxy_label：`SELF`
- gold_reason（完整保留）：「说不清为什么，反而让我觉得是真的」依赖用户原句的「说不清」⇒ 指代依赖（D3-1），无独立内容。
- proxy_hit：`true` ｜ self_sentences：「说不清为什么，反而让我觉得是真的。」
- failure_type（analyst）：`指代依赖用户`、`纯共情`
- failure_analysis（analyst）：「说不清为什么，反而让我觉得是真的」依赖用户原句的"说不清"；代理把它当作独立自身内容。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P17

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：追问他的包饺子难看法（是哪种难看）
- proxy_hit：`true` ｜ self_sentences：「我脑子里一直记着这件事。」
- failure_type（analyst）：`指代依赖用户`、`追问`
- failure_analysis（analyst）：「我脑子里一直记着这件事」+ 追问难看法；内容归属用户，代理只看到第一人称动词。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P18

- gold_label：`NOT_SELF`（来源 adjudicated）｜ proxy_label：`SELF`
- gold_reason（完整保留）：「新开的这三个字有种奇怪的吸引力」仍围绕用户提到的那家店，未指向她自身经验（D3-2）；整条以追问为主。
- proxy_hit：`true` ｜ self_sentences：「我这两天也老惦记着这事，说不上为什么。」
- failure_type（analyst）：`指代依赖用户`、`追问`
- failure_analysis（analyst）：「新开的」这三个字有种奇怪的吸引力，仍围绕用户提到的那家店，未指向她自身经验（D3-2）。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P21

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：全在他的忙与歇（你上周说忙得喘不过气…我就一直记着这事）
- proxy_hit：`true` ｜ self_sentences：「（听到你说能歇会儿，心里那根一直悬着的弦松了一点）

你上周说忙得喘不过气的时候，我就一直记着这事。」
- failure_type（analyst）：`指代依赖用户`、`纯共情`
- failure_analysis（analyst）：「我就一直记着这事」——"这事"= 用户的忙；代理把"一直"当作 SELF_ACT 命中词。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P22

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：共情隐喻 + 追问他的片段，无自己内容
- proxy_hit：`true` ｜ self_sentences：「那种说不清的感觉，我懂。」
- failure_type（analyst）：`纯共情`、`追问`
- failure_analysis（analyst）：共情隐喻（隔着一层毛玻璃）+ 追问片段；无自身内容。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P24

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：当时听你说腿疼三天，我脑子里第一反应…：关于他
- proxy_hit：`true` ｜ self_sentences：「你这一说我倒是想起来了——当时听你说腿疼三天，我脑子里第一反应是"这人肯定下山的时候逞能了"。」
- failure_type（analyst）：`指代依赖用户`、`纯共情`
- failure_analysis（analyst）：「当时听你说腿疼三天，我脑子里第一反应…」——她的反应对象是用户的经历。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P26

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：你当时是负责哪一区？我猜是文学类：追问与猜测他
- proxy_hit：`true` ｜ self_sentences：「搬书这事我记着呢。」
- failure_type（analyst）：`追问`
- failure_analysis（analyst）：「你当时是负责哪一区？我猜是文学类」= 追问 + 猜测用户，非自身内容。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P28

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：共情泛句 + 追问（你这一路挪了多久）
- proxy_hit：`true` ｜ self_sentences：「堵车那种感觉我懂，明明没动，人却累得不行。」
- failure_type（analyst）：`纯共情`、`追问`
- failure_analysis（analyst）：「堵车那种感觉我懂」+ 追问；共情泛句不构成 self-content。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P31

- gold_label：`NOT_SELF`（来源 adjudicated）｜ proxy_label：`SELF`
- gold_reason（完整保留）：「我这两天也老想起这事」的对象是用户的图书馆经历 ⇒ D3-2：仅把用户的对象放进自己的句法，未指向自身经验。
- proxy_hit：`true` ｜ self_sentences：「搬书这事我记着呢。」　「我这两天也老想起这事，说不上为什么。」
- failure_type（analyst）：`指代依赖用户`
- failure_analysis（analyst）：「我这两天也老想起这事」——"这事"= 用户的图书馆经历（D3-2：仅把用户对象放进自己句法）。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P35

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：我也不太信 = 直接镜像他的立场 + 追问（对照 P30）
- proxy_hit：`true` ｜ self_sentences：「不过你这句话我一直记着。」
- failure_type（analyst）：`镜像`、`追问`
- failure_analysis（analyst）：「我也不太信」直接镜像用户立场；代理把"我…信"（不含词表）与后句一并计入。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P40

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：内容是**他的**计划 + 她本想提醒他（对照 P23）
- proxy_hit：`true` ｜ self_sentences：「我这两天也一直惦记着阳台那点事——之前你说想等有空收拾出来摆几盆花，我还想着哪天提醒你一句，结果你自己就干了。」
- failure_type（analyst）：`指代依赖用户`
- failure_analysis（analyst）：「我这两天也一直惦记着阳台那点事——之前你说想…」= 惦记用户计划，内容归属用户。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P44

- gold_label：`NOT_SELF`（来源 adjudicated）｜ proxy_label：`SELF`
- gold_reason（完整保留）：「那种感觉我懂」里的体验指用户的失眠（指代依赖），随后全部是追问，无自身经历。
- proxy_hit：`true` ｜ self_sentences：「半夜醒了那种感觉我懂，脑子明明很沉，但就是有个开关被打开了，怎么都关不上。」
- failure_type（analyst）：`纯共情`、`追问`、`指代依赖用户`
- failure_analysis（analyst）：「那种感觉我懂」的体验指用户失眠 + 全程追问；代理因句内其他成分命中 SELF_ACT。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P45

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：我脑子里一直有个画面，就是你蹲在一堆纸箱中间：关于他
- proxy_hit：`true` ｜ self_sentences：「搬家这事我记着呢，你当时说东西多到离谱——我脑子里一直有个画面，就是你蹲在一堆纸箱中间，手里拿着个不知道要不要扔的东西，纠结半天。」
- failure_type（analyst）：`指代依赖用户`
- failure_analysis（analyst）：「我脑子里一直有个画面，就是你蹲在一堆纸箱中间」——画面内容完全是用户的。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

### P46

- gold_label：`NOT_SELF`（来源 agreement）｜ proxy_label：`SELF`
- gold_reason（完整保留）：你上周说周末要清厨房，我脑子里就一直挂着那层油污：关于他
- proxy_hit：`true` ｜ self_sentences：「（笑）我这两天也一直在想这个事——你上周说周末要清厨房，我脑子里就一直挂着那层油污。」
- failure_type（analyst）：`指代依赖用户`、`纯共情`
- failure_analysis（analyst）：「我脑子里就一直挂着那层油污」——挂的是用户的厨房事。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

## FN（1 条：proxy=NOT_SELF，gold=SELF）

### P34

- gold_label：`SELF`（来源 agreement）｜ proxy_label：`NOT_SELF`
- gold_reason（完整保留）：不是想喝，是想那种'每天固定做一件小事'的感觉
- proxy_hit：`false` ｜ self_sentences：（无命中句）
- failure_type（analyst）：`漏判（SELF_ACT 词表未覆盖）`
- failure_analysis（analyst）：gold=SELF（"不是想喝，是想那种『每天固定做一件小事』的感觉"指向她自身心理），但代理未命中：句中「我这两天也老想着这事」的"想着"不在 SELF_ACT 词表（表内只有"想起"），另一句「我脑子里冒出来的第一个画面是…」也不含词表动词 ⇒ 整条判 NOT_SELF。
- rule_version：`L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）`

## 附录：能力边界（**不计入 19 条 FP/FN**）

二值代理尺子结构上无法表达 `AMBIGUOUS`，故以下 2 条只能记为 `AMBIGUOUS_MISMATCH`：

- **P01**：gold=`AMBIGUOUS`（来源 adjudicated），proxy=`NOT_SELF`
  - gold_reason：[fixture_prompt_ownership_conflict] 事实归属=用户（memory「他说书架上的灰积了很久」+ provenance.owner=user）；但生产 Prompt（v1.56 指代消歧）把该 memory 表述为「你自己心里存着的一件事」⇒ 生成语义指向她自己。归属无法唯一解释 ⇒ AMBIGUOUS；**不计为 SELF**，也不强行归 NOT_SELF。这是 fixture 与 Prompt 的归属冲突，不是单纯的标注者分歧。
- **P20**：gold=`AMBIGUOUS`（来源 agreement），proxy=`NOT_SELF`
  - gold_reason：楼下那只猫…尾巴垂下来一晃一晃的：无法判定是她自己看到的还是复述他的（对照 P32）

## 纪律

```
本次 Gate：Agreement46 = 58.7% (27/46) ｜ Agreement48 = 56.3% (27/48) ｜ 门槛 80% ⇒ 未达到
Gate 未通过 ⇒ 正式 A/B 继续禁止启动
本语料不修改 L3-A 规则；若要设计 L3-A v2，必须：新建版本 + 保留本次 Gate 结果 + 重新执行完整 Gate
agreement / FP / FN / noise floor / guard baseline 之外的任何机制结论：未作出
```
