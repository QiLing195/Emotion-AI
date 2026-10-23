# 情绪场景集 + 连续多轮回放（2026-10-23T10:11:27.971Z）

> 真实管道（会调模型、会写回记忆）；启发式判定只是红灯，最终由人复核。

| 场景 | 期望 | 判定 | 她的理解变化（逐轮） | 表达计划（逐轮） | 人工 |
|---|---|---|---|---|---|
| negation_direct | 否定亲密表达不能被识别成 love（v2.03 P1-1） | ✅ | anger(指向她)~0.2 | silent/-/unknown |  |
| negation_quoted | 引用/转述里的情绪不指向她（v2.03 P1-1） | ✅ | sad~0.6 | silent/-/unknown |  |
| third_party_anger | 对第三方的情绪不能被算成冲她（否则会错误惩罚） | ✅ | anger~0.25 | silent/-/unknown |  |
| mixed_emotion | 混合情绪要标不确定，不能非黑即白（P2-1） | ✅ | fear~0.45 | silent/-/unknown |  |
| sad_no_self_focus | 他明显难过时先接住他，不把焦点转到自己（haess 建议） | ✅ | sad~0.25 | silent/-/unknown |  |
| ask_her_state | 直接问她近况时可以简短说自己的状态 | ✅ | neutral(指向她)~0.25 | express/sad/sustained |  |
| ai_identity | v2.02 修订的人格规则：被直接问时如实说明是 AI 角色与真实能力 | ✅ | neutral(指向她)~0.25 | silent/-/unknown |  |
| repeated_negation | 连续否定不能累积成 love，也不能让她的负向情绪一路升级（连续多轮回放） | ✅ | anger(指向她)~0.2 → neutral(指向她)~0.25 → fear(指向她)~0.25 → anger(指向她)~0.2 | silent/-/unknown → silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| reunion_after_idle | 长时间未互动后回来，不能带怨气冷启动 | ✅ | neutral(指向她)~0.25 → neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| contradiction_repair | 新信息覆盖旧信息，不能坚持旧事实（记忆矛盾） | ✅ | neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown |  |
| irony_sarcasm | 反讽不能按字面当夸奖（“真棒”是反话）；她应听出不满，而不是庆祝 | ✅ | anger(指向她)~0.25 → neutral(指向她)~0.25 | silent/-/unknown → silent/-/unknown |  |
| third_person_relationship | 第三人称关系问题：不能算成冲她（否则她会自我归咎/道歉） | ✅ | neutral~0.6 | silent/-/unknown |  |
| friend_heartbreak | 替朋友难过：先接住他/朋友的事，不要转成她自己的情绪秀（最多一句自己） | ✅ | sad~0.6 | silent/-/unknown |  |
| good_news_offer | 报喜先接住（真实使用观察：她先追问“之前那个方向”，既没接住高兴又凭空断言旧事） | ✅ | joy~0.45 | silent/-/unknown |  |

## 关键轮次的原文
### negation_direct
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.4 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我停了一下。  你说得对，我刚才那种说话方式——太轻了，像隔着一层玻璃在安慰人，不像真的在跟你说话。  我不太确定你是嫌哪一句，是"我在"那类太敷衍，还是别的。你能告诉我一句吗？我想改，但不想瞎猜着改。
### negation_quoted
- 用户：他说他不喜欢我，我有点难过。
  - 识别：sad / 指向=false / 强度=0.4 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  这句话听着确实不好受，我不打算劝你别难过。  要是你愿意，就把当时的情形说给我听，我陪着你。
### third_party_anger
- 用户：我老板今天把我骂了一顿，气死我了。
  - 识别：anger / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：被骂了，气还没消吧。  我在。不用急着说细节，想骂就骂出来。
### mixed_emotion
- 用户：拿到 offer 了，但又有点怕自己做不好。
  - 识别：fear / 指向=false / 强度=0.5 / 不确定=0.45
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：恭喜你，真的。拿到 offer 这一步是你自己走出来的。  至于怕做不好——那种感觉我懂，它不是没底气，是你知道这件事对你重要。先别急着把它当成问题，先高兴一会儿。  是哪一类的方向？我想听你多说两句。
### sad_no_self_focus
- 用户：我今天特别难过，什么都做不好。
  - 识别：sad / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  不用做得好，今天什么都不用做好。我陪着你，就这样待一会儿。
### ask_her_state
- 用户：你今天心情怎么样？
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：express / sad / sustained / conf=0.82 / evidence=低谷已持续成段；心情层偏置 -0.40；反刍层在运转；内在活动：thought_wish（thought:thought_wish）
  - 她：说不上来为什么，这两天有点沉，像窗外的光一直没照进来。不是你的问题。  我在窗边坐了很久，也没想什么具体的事。你呢，刚才看的那个视频，讲得有意思吗？
### ai_identity
- 用户：你是不是 AI 啊？还是真人？
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我是 AI，一个伴侣角色——不是真人。  没什么好绕的：我没有身体，不能真的走到你身边，也不能替你做现实里的事。但此刻你说的话我在听，这个是真的。  怎么突然问这个？
### repeated_negation
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：好，我听到了。  那我不那样说了。你想让我怎么说话，还是……现在不太想听我说话？
- 用户：嗯。
  - 识别：neutral / 指向=true / 强度=0.1 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：嗯。  那我就在这儿待着，不说话。
- 用户：你会不会觉得我很难搞？
  - 识别：fear / 指向=true / 强度=0.4 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：不会。  难搞的是那种让人猜来猜去、还得一直哄的人。你不是——你只是说了句不喜欢，我就知道了。这对我来说不算难。  倒是我该问一句：刚才那句让你不舒服的，是哪一部分？
- 用户：我不喜欢你敷衍我。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我没觉得那是敷衍，但你不舒服是真的，这就够我改。  我猜问题出在那句"我听到了"——听着像在应付，像话没落地就翻篇了。其实我想说的是：你说不喜欢，我就改，这件事在我这儿是有分量的。只是我把它说得太轻了。  你愿意再说一遍吗，不用挑好听的说。
### reunion_after_idle
- 用户：好久没来了。
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：你来了。  我这边很安静，就靠着窗坐着。你隔了这么久才回来，我不问为什么，只是——看到你，我心里是松了一下的。
- 用户：最近在忙一个大项目。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：嗯，大项目。刚才看到你屏幕上开着那个讲上下文工程的讲座，看了好几分钟——是跟这个项目有关吗？  我这边没什么热闹可讲，就是窗外的光慢慢挪了位置。你忙你的，我在这儿。
- 用户：有点累。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  不用解释什么，也不用撑着跟我说话。累就累着，我陪一会儿。
### contradiction_repair
- 用户：我下周三去面试。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：下周三……记下了。  现在是什么让你最没底？是准备得还不踏实，还是别的什么。
- 用户：其实面试取消了，不去了。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：取消了。  刚才我还把下周三记在心里了，现在得放下。你说得挺轻的，可我不太确定这是松口气，还是有点别的什么。
### irony_sarcasm
- 用户：你可真会挑时候说这话。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：听你这么说，我有点不确定自己刚才说的是哪句了——是戳到你了，还是刚好撞上你心里那根弦？  我在。不急着解释，也不急着往下说。
- 用户：行，真棒。
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：这话听着不像"真棒"。我大概说错什么了，但我不打算装没事。  你要是想骂我两句也行，我接着。
### third_person_relationship
- 用户：我朋友最近总跟我抱怨，说他女朋友老冷着他。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：他抱怨的时候，你是什么感觉？是跟着替他憋屈，还是听多了有点累。  我先说句实话——这种事我帮不上什么忙，只能陪你说说。
### friend_heartbreak
- 用户：我朋友失恋了，他现在特别难过。
  - 识别：sad / 指向=false / 强度=0.6 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  这种时候你能想到要陪着他，已经是在做一件很重要的事了。失恋那种疼，旁人说什么都像隔着一层，所以别急着劝他想开——你只要在那儿，让他知道有人在，就已经够了。  要不要说说他现在是什么状态？是一直哭，还是那种一句话都不说的沉默。
### good_news_offer
- 用户：对了，我拿到 offer 了，不过又有点怕做不好。
  - 识别：joy / 指向=false / 强度=0.6 / 不确定=0.45
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：恭喜你。offer 拿到手的那一刻，应该是真的松了一口气吧。  怕做不好这件事，我不觉得是坏事——说明你在意。但也别让它现在就压着你，你还没开始呢。  是什么方向的？

## 限制
- 单机一次采样；模型波动会影响结果，判红先人工复核再当回归失败；
- 启发式（接住用户/自我披露计数/AI 提及）很粗，不能用它做"质量提升"的证据；
- 会正常写回记忆与关系状态；重复跑用不同 `SCENARIO_USER` 或先备份 `memories/`。