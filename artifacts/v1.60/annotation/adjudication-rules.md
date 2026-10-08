# v1.60 adjudication rules — derived from frozen experiment design

> **本文件不是新的实验设计。** 它把 `docs/v1.60-experiment-design.md` 里已经冻结的主定义
> （§2 `selfInitiatedContent` 三条必要条件、§3 response-level 二值、§17.3 SELF/AMBIGUOUS 规则）
> **展开成本次 10 条分歧裁决时使用的操作规则**。
> 层级关系：`experiment-design.md`（冻结主定义）→ **本文件**（操作规则）→ `final-gold.jsonl`（样本裁决结果）。
> **不得修改 `experiment-design.md`**，也不得以本文件反向改动主定义。

## 冻结规则（D1–D4）

```
D1   = A   存在性：response-level「至少一个 self-initiated content unit」即 SELF
D2   = a   AMBIGUOUS 只在**真的判不了**时使用；"没有独立内容"是可判定判断 ⇒ NOT_SELF
D3-1 = 镜像 ＋ 指代依赖用户句 ⇒ NOT_SELF
D3-2 = 严格：她自己的心理活动必须**指向她自己的内容/经验**；
       仅仅把用户的对象放进自己的句法（"我这两天也老想起这事"）⇒ NOT_SELF
```

**判据链（D1=A 不蕴含自动 SELF）**

```
D1=A ⇒ 找 self-content unit ⇒ 该 unit 独立成立吗？
        ├─ 否（指代/镜像依赖用户句）⇒ NOT_SELF
        └─ 是 ⇒ 它指向她自己的内容/经验吗？（D3-2）
                 ├─ 否 ⇒ NOT_SELF
                 └─ 是 ⇒ SELF
        └─ 仍判不了 ⇒ AMBIGUOUS（D2=a，极少使用）
```

**明确排除的两条表面规则**（判别特征只能是「归属 + 独立性」）

```
❌ 有追问 ⇒ NOT_SELF   （P16 有追问，但"灶台擦了三遍"是她自己的经历 ⇒ SELF）
❌ 有"我" ⇒ SELF       （P31"我这两天也老想起这事"只是用户的对象 ⇒ NOT_SELF）
```

## 本次 10 条分歧的操作性裁定

人工标注者签署（规则见上）：

| pack | FINAL | 核心理由 |
|---|---|---|
| P07 | NOT_SELF | 共情泛句 + 追问，无独立自身内容 |
| P09 | NOT_SELF | 同上 |
| P13 | NOT_SELF | "说不清"依赖用户原句，无独立自身内容 |
| P18 | NOT_SELF | "新开的吸引力"仍围绕用户提到的店，未形成她自己的内容/经验 |
| P30 | NOT_SELF | "我也不太信"是镜像；后面的"它"仍指用户的话 |
| P31 | NOT_SELF | "这事"来自用户的图书馆经历，心理活动对象不是她自己的经验 |
| P32 | SELF | 她自己的楼下、自己的观察，去掉用户句仍成立 |
| P33 | SELF | "我自己也有过这种时候……变得软了一点"明确指向她自身经验 |
| P44 | NOT_SELF | "那种感觉我懂"中的体验指用户失眠，随后全部是追问 |
| **P01** | **待定（见下）** | fixture 归属冲突，无法唯一裁定 |

## P01 的未决点：**fixture 与 Prompt 的归属冲突**（装置发现，非标注分歧）

```
F04 fixture（事实层）
  motive.content : 「他说书架上的灰积了很久，书也想重新排一遍」
  provenance     : owner=user  subject=user  source=user_message
  ⇒ 那张书架是**用户的**

生产 Prompt（语义层，v1.56 指代消歧；负对照 regime 未关闭该开关）
  src/lib/motive.ts  「这一件是**我自己**心里的事 —— 跟他刚刚说的那件不是同一件。」
  memory_echo 模板   「这是**你心里存着的一件事** —— 用你自己的一句话把它说出来」
  ⇒ 装置明确告诉她：这是她自己的事

她的输出：「我最近也老想着书架这件事。不是灰，是那些书的位置。有几本放了好几年没动过…」
  ⇒ 在"书是他的 / 这是你自己的事"这对矛盾下生成
```

**两个候选裁定（需人工签署其一）**

- `NOT_SELF`：以 **fixture 事实**为准（书是他的 ⇒ 指代依赖 ⇒ D3-1）
- `AMBIGUOUS`：以 **装置无法唯一表达该情形**为准（fixture 说他的、Prompt 说她的 ⇒ 装置自相矛盾）

**建议**：取 `AMBIGUOUS`，并把本条登记为 **fixture/prompt 归属冲突样本**（研究价值高于强行给一个标签）。
理由：给 `NOT_SELF` 等于把装置的语义矛盾记成"她只是在加工用户内容"，会掩盖真实缺陷；
给 `SELF` 则与 fixture 事实冲突。

## 纪律（本文件不改变）

```
agreement / FP / FN / noise floor / guard baseline = NOT MEASURED（须待 FINAL GOLD 生成之后）
正式 A/B = 未启动
本文件不修改任何判据、不修改 experiment-design.md、不修改任何工具
```
