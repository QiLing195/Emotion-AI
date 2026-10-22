# Anya 桌宠立绘提示词（15 个状态）

> 目标：生成 15 张**同一角色、同一画风、同一画布/基线**的状态图，直接放进 `public/pet/` 就能用。
> 关键不是"每张画得好看"，而是**15 张放一起像同一个人**。

---

## 0. 角色锚（所有提示词都必须带上这一段，一个字都别改）

**Anya（安雅）设定**

```
一位 20 岁出头的少女，浅蜜桃粉及肩发（侧分刘海 + 左侧一枚小发夹），暖琥珀色眼睛，
圆脸、软脸颊、淡淡的腮红；穿米白色宽松针织开衫，里面是藕粉色上衣，深灰色百褶裙，白色短袜。
2.5 头身 chibi 比例，圆润简洁的线条，柔和赛璐璐上色，低饱和粉白配色。
```

**英文锚（直接粘进每一条 prompt 开头）**

```
(master character: Anya) a cute chibi anime girl in her early 20s, soft peach-pink shoulder-length hair with side-swept bangs and a small hairpin on the left, warm amber eyes, round soft face with light blush, oversized cream knit cardigan over a dusty-pink top, dark grey pleated skirt, white socks, 2.5-head chibi proportions, clean rounded lineart, soft cel shading, pastel palette, full body, centered, facing viewer
```

**画风锚（每一条结尾）**

```
chibi anime style, clean thick soft outlines, flat soft cel shading, pastel low-saturation palette, no cast shadow, no background, no text, standing on a transparent background, full body visible head to toe, consistent character design, 4:5 canvas
```

---

## 1. 两种工作流（先选一种）

### 方案 A（最稳）：先做一张"角色参考图"，之后每张用它锁人

```
① 先用「idle」那条 prompt 生成 1 张满意的（多抽几张，挑一张）
② Midjourney：后续每张加 --cref <那张图的URL> --cw 70~100
   Stable Diffusion：用 IP-Adapter / Reference Only 喂那张图（权重 0.6~0.8）
   NovelAI：用 Image→Image，参考强度 0.55~0.7，只改动作/表情描述
③ 同一角色参考 + 固定 seed，15 张一致性最高
```

### 方案 B（最快）：一张 3×5 表情表，再裁成 15 张

```
master character sheet, the same chibi girl shown in a 3x5 grid (15 panels), each panel a different
expression and pose: row1 idle smile / blink / happy star-eyes; row2 angry puffed cheeks / shocked open
mouth / sleepy eye-rubbing; row3 eating peanut / sitting / drinking coffee; row4 reading a book / sad
downcast / talking; row5 walking / waving / thinking hand on chin. identical character design in every
panel, consistent outfit and hair, same scale and camera distance, clean white background, thin panel
gutters, no text labels, chibi anime style, soft cel shading, pastel palette
```

生成后按格子裁切（每格 → 缩到 512×640，脚底对齐）。**优点：同一次生成，角色绝对一致；缺点：表情细节容易糊，格子要留足空隙**。

---

## 2. 平台参数

| 平台 | 参数 |
|---|---|
| Midjourney v6/v7 | `--ar 4:5 --style raw --v 6.1`；动漫感强可换 `--niji 6`；锁人 `--cref <url> --cw 80` |
| Stable Diffusion (SDXL/1.5) | 1024×1280；采样 DPM++ 2M Karras；steps 28~35；CFG 5~7；负面提示见 §4；建议加 `flat color, clean lineart` LoRA |
| NovelAI | 1024×1280；Quality Tags 开；Undesired Content 用默认 + 加 `background, text` |
| DALL·E / 即梦 / 通义 | 直接用 §3 的英文长句；要求"纯白或纯绿背景，全身，4:5" |

> 生成尺寸建议 **1024×1280（4:5）**，最后统一缩到 **512×640**（CSS 显示 160×200，留 2x 清晰度）。

---

## 3. 十五条提示词（每条 = 角色锚 + 状态块 + 画风锚）

> 用法：把三段拼起来（或直接复制下面标了 `FULL` 的整条）。

### ① anya_idle.png 待机微笑

```
STATE: standing relaxed, weight on one leg, hands loosely at her sides with one sleeve slightly over her hand, gentle closed-mouth smile, eyes open with soft highlights, head tilted about 3 degrees to her right, calm and approachable
NEG: no props, no motion
```

### ② anya_blink.png 眨眼

```
STATE: identical to idle pose, both eyes closed as soft downward curves, relaxed small smile, tiny blush, shoulders at ease
NEG: no motion lines, no props
```
> 这张要能和 `idle` **像素级对齐**：姿势、手脚位置与 idle 完全一致，只换眼睛。生成时用 img2img（强度 0.15~0.25）在 idle 上改最省事。

### ③ anya_happy.png 开心星星眼

```
STATE: beaming, star-shaped sparkling eyes (two small four-point stars as pupils), open happy smile showing a tiny tooth, both hands raised in small fists near her chest, heels slightly lifted in a little bounce, stronger blush, hair swaying slightly
```

### ④ anya_angry.png 生气鼓脸

```
STATE: puffed cheeks pouting, eyebrows angled down inward, small wavy pout mouth, arms crossed over chest, slight forward lean, a tiny steam puff above her head (optional), ears slightly red
```

### ⑤ anya_shocked.png 震惊张嘴

```
STATE: eyes wide open with tiny pupils, mouth open in a small "O", both hands lifted near her cheeks, body leaning slightly back, hair lifted a touch as if startled, small sweat drop on the temple (optional)
```

### ⑥ anya_sleepy.png 困倦揉眼

```
STATE: half-lidded sleepy eyes, one hand rubbing her eye with a small fist, other hand resting at her side, tiny yawn with mouth barely open, head tilted and body slightly slumped, a soft "z" floating beside her head (optional)
```

### ⑦ anya_peanut.png 吃花生

```
STATE: sitting on the floor with legs folded to one side, holding a single peanut shell in one hand near her mouth, cheeks slightly full from chewing, eyes half happy, a small ceramic bowl of peanuts on the floor beside her, crumbs none
```

### ⑧ anya_sit.png 坐下

```
STATE: sitting cross-legged on a round floor cushion, hands resting on her knees, back upright and relaxed, gentle closed-mouth smile, looking at viewer
```

### ⑨ anya_coffee.png 喝咖啡

```
STATE: sitting on a cushion, holding a warm ceramic mug with both hands close to her chest, thin curl of steam rising from the mug, eyes half-closed and content, gentle smile, shoulders relaxed, cozy morning mood
```
> 道具位置固定在**画面右下角**（她的左手边），避免和 UI 按钮重叠。

### ⑩ anya_reading.png 读书

```
STATE: sitting cross-legged, holding an open hardcover book with both hands in front of her, eyes looking down at the pages, soft focused expression with a small smile, a ribbon bookmark hanging from the book, one finger marking the page
```

### ⑪ anya_sad.png 低落

```
STATE: downcast eyes, eyebrows tilted up at the inner ends, small frown, shoulders slightly slumped, both hands clasped in front of her chest holding the cardigan closed, overall desaturated cool tint (blue-grey cast) while keeping the same outfit colors readable
```

### ⑫ anya_talk.png 说话

```
STATE: mid-speech, mouth open in a small oval, eyebrows slightly raised, one hand lifted in a small explaining gesture, eyes looking at viewer, natural engaged expression
```

### ⑬ anya_walk.png 行走

```
STATE: mid-stride walking toward the viewer's right, one leg forward and one back, arms swinging naturally opposite to the legs, small happy smile, hair and cardigan hem swaying with the step
```

### ⑭ anya_wave.png 挥手

```
STATE: standing, right arm raised high waving hello, left hand at her side, big happy smile, eyes slightly squinted from smiling, slight lean to her right, wrist relaxed
```

### ⑮ anya_think.png 思考

```
STATE: index finger touching her chin, eyes looking up and to the left, small "hmm" mouth, other arm folded under the elbow, a soft question mark floating above her head (optional), curious expression
```

---

## 4. 负面提示词（每条都带）

```
lowres, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, deformed, blurry,
jpeg artifacts, text, watermark, signature, logo, frame, border, background scenery, landscape,
room, furniture except the listed prop, cast shadow, ground shadow, cropped, cut off feet,
cut off head, out of frame, multiple girls, different character, outfit change, hair color change,
realistic photo, 3d render, heavy shading, oversaturated, chibi off-model
```

---

## 5. 透明背景导出（生成器一般不出透明图）

```
① 生成时用**纯白**或**纯绿（#00FF00）**背景（绿幕更好抠，但绿边会映到头发上 → 优先纯白 + 抠图）
② 抠图：remove.bg / Photopea（魔棒 + 羽化 1px）/ Photoshop「选择主体」/ SD 的 rembg 后处理
③ 统一画布：512×640 透明 PNG；角色**底部居中**，脚底基线统一放在 y≈608（下面留 32px）
④ 头部留白 ≥24px（呼吸动画时头会轻微上下，别贴边）
⑤ 批量检查：15 张放同一画布叠看，头和脚的位置应该几乎不动
```

**导出前自检（15 张一起看）**

```
□ 发型/发色/发夹位置一致        □ 衣服颜色与款式一致
□ 头身比一致（都是 2.5 头身）    □ 眼睛形状与高光风格一致
□ 脚底在同一水平线              □ 角色在画布中央、左右留白一致
□ 没有投影/背景/文字            □ 每张都能单独看懂是什么状态
```

---

## 6. 一次性生成全部（懒人版）

如果你只想跑几次，用这个整表 prompt（方案 B），再裁：

```
(master character: Anya) a cute chibi anime girl in her early 20s, soft peach-pink shoulder-length
hair with side-swept bangs and a small hairpin on the left, warm amber eyes, oversized cream knit
cardigan over a dusty-pink top, dark grey pleated skirt, white socks, 2.5-head chibi proportions,
clean rounded lineart, soft cel shading, pastel palette.

character sheet, 3 rows x 5 columns grid, 15 panels, same character in every panel, identical
outfit and hairstyle, same scale and camera distance, each panel one expression:
idle gentle smile / blinking closed eyes / happy star eyes / angry puffed cheeks / shocked open mouth /
sleepy rubbing eye / eating a peanut / sitting cross-legged / holding a coffee mug / reading an open
book / sad downcast / talking mid-speech / walking mid-stride / waving hello / thinking hand on chin.
plain white background, thin light grey panel gutters, no text labels, no watermark,
chibi anime style, clean thick soft outlines, flat soft cel shading, low-saturation pastel colors,
full body visible in each panel, consistent design

Negative: lowres, bad anatomy, bad hands, extra fingers, deformed, blurry, text, labels, watermark,
background scenery, cast shadow, cropped, multiple different characters, outfit change
```
