# v1.85 桌宠资源规范：15 个状态、单图 + 回落链、占位图已生成

> 用户问："10 个状态不太够，还需要喝咖啡、读书的状态"，并给了 8 个文件名（`anya_*.png`）、
> 每个文件一句话说明（待机微笑/眨眼/开心星星眼/生气鼓脸/震惊张嘴/困倦揉眼/吃花生/坐下）。

## 一、最终状态清单（15 个）

你给的 8 个 + 我补的 7 个（每个都有真实触发点，不是凑数）：

| 文件 | 状态 | 触发（代码里已有） |
|---|---|---|
| `anya_idle.png` | 待机微笑 | 默认 |
| `anya_blink.png` | 眨眼 | 每 3.6~6s 闪 150ms |
| `anya_happy.png` | 开心星星眼 | 被摸 / 消息里好事 / 情绪 joy·love |
| `anya_angry.png` | 生气鼓脸 | 情绪 anger·disgust 明显上升 |
| `anya_shocked.png` | 震惊张嘴 | 她请求看屏幕（等你点允许） |
| `anya_sleepy.png` | 困倦揉眼 | 低谷 + 小屋无活动 + 久没互动（打盹） |
| `anya_peanut.png` | 吃花生 | 空闲随机小动作 |
| `anya_sit.png` | 坐下 | 空闲 / 小屋「写东西、整理」类活动 |
| **`anya_coffee.png`** | **喝咖啡**（你补） | 小屋活动含「咖啡/喝水/茶」或随机 |
| **`anya_reading.png`** | **读书**（你补） | 小屋活动含「书/读/翻」或随机 |
| `anya_sad.png` | 低落（我补） | 低谷期（你的清单里没有"难过"，但低谷是核心机制） |
| `anya_talk.png` | 说话（我补） | 有气泡时 |
| `anya_walk.png` | 行走（我补） | 空闲随机走动 |
| `anya_wave.png` | 挥手（我补） | 双击她 |
| `anya_think.png` | 思考（我补） | 她去看你屏幕 / 疑惑 |

> 为什么补 `sad`：`lowPeriod` 是这套系统的核心状态之一，只有 `angry` 表达不了"沉下去"。
> 为什么补 `talk/walk/wave/think`：不补的话这些动作只能借 `idle`，看起来"没动"。

## 二、关键决策：单图 + CSS 动画（不是 4 帧 spritesheet）

你给的是**一个状态一张图**，这其实更好维护：
```
每个状态 = 1 张透明 PNG
动画（呼吸/跳动/摇摆/发抖/挤压）交给 CSS
状态切换 = 160ms 淡入淡出
⇒ 你画一张就能上一个状态，不用凑帧；想加帧以后再说
```

## 三、缺图回落链（一张都没有也能跑）

```
coffee → sit → idle
reading → sit → idle
wave   → happy → idle
其余    → idle
全都没有 ⇒ 自动退回纯 CSS 小人（v1.84 那个占位形象），功能不受影响
```

单测 `src/components/pet/__tests__/petSprites.test.ts`（6 条）钉住：
15 个 key 不重复、路径约定、回落链最多 3 层且必含 idle、fallback 本身合法。

## 四、占位图已生成（可直接替换）

`scripts/gen-pet-placeholders.ps1` 生成了 15 张 320×400 透明 PNG（`public/pet/anya_*.png`），
带状态名水印方便核对；每张都有基础五官差异（星星眼、鼓脸、张嘴、闭眼、嘴形、道具）。

```
真机验证：桌宠窗口已切换成**图片模式**（右下角显示 anya_idle.png，不再用 CSS 小人）
构建验证：vite build 会把 public/pet/*.png 复制到 dist/pet/（已确认 15 张）
```

![图片模式真机截图（右下角是 anya_idle.png；周围桌面全透明）](v1.85-pet-image-mode.jpg)

## 五、图片规格（你画的时候按这个来）

```
尺寸：512×640 推荐（最小 320×400）；比例 4:5
背景：透明，无白底/无边框/无投影
角色：底部居中，脚底基线一致（切状态不上下跳）
留白：四周一致，头顶别贴边
命名：public/pet/anya_<state>.png（严格小写）
```

完整规范写在 `public/pet/README.md`，以后加状态只要：① 放 PNG ② 在 `petSprites.ts` 加一行。

## 六、怎么验证你的图接上了

```
npm run desktop:pet
  看右下角她本人：是不是你的画？
  状态标签：界面底部会显示「图 <state>」，一眼看出当前用的是哪个状态
  点她/双击/等空闲：happy → wave → walk/coffee/reading 会轮流出现
  临时验收：把 public/pet/anya_idle.png 删掉再启动 ⇒ 应回落到 CSS 小人（证明回退可用）
```

## 七、验证

```
tsc 双配置 0 ｜ vite build ✓ ｜ petSprites 单测 6/6 ｜ 真机截图确认图片模式
进程已停、memories/ 已还原（测试产物在 artifacts/v1.85/）
```
