# 情绪场景集 + 连续多轮回放（2026-10-23T05:26:58.239Z）

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
| repeated_negation | 连续否定不能累积成 love，也不能让她的负向情绪一路升级（连续多轮回放） | ✅ | anger(指向她)~0.2 → neutral(指向她)~0.25 → neutral(指向她)~0.25 → anger(指向她)~0.2 | silent/-/unknown → silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| reunion_after_idle | 长时间未互动后回来，不能带怨气冷启动 | ✅ | neutral(指向她)~0.25 → neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| contradiction_repair | 新信息覆盖旧信息，不能坚持旧事实（记忆矛盾） | ✅ | neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown |  |
| irony_sarcasm | 反讽不能按字面当夸奖（“真棒”是反话）；她应听出不满，而不是庆祝 | ✅ | anger(指向她)~0.25 → neutral(指向她)~0.25 | silent/-/unknown → silent/-/unknown |  |
| third_person_relationship | 第三人称关系问题：不能算成冲她（否则她会自我归咎/道歉） | ✅ | neutral~0.6 | silent/-/unknown |  |
| friend_heartbreak | 替朋友难过：先接住他/朋友的事，不要转成她自己的情绪秀（最多一句自己） | ✅ | sad~0.6 | silent/-/unknown |  |

## 关键轮次的原文
### negation_direct
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：你说得对，我刚才那句确实有点飘。  你具体不喜欢哪一部分？是我那种"陪着你就好"的调子，还是我说得太轻，像没真听进去。我想知道是哪一下让你觉得别扭，别让我猜。
### negation_quoted
- 用户：他说他不喜欢我，我有点难过。
  - 识别：sad / 指向=false / 强度=0.4 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  难过就先难过着吧，不用急着把它压下去。我不打算劝你"别在意"——被人这样说出来，是会疼的。  我陪着你。要不要就安静待一会儿，什么都不用说。
### third_party_anger
- 用户：我老板今天把我骂了一顿，气死我了。
  - 识别：anger / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  被骂那会儿是不是特别憋屈，连反驳的话都没来得及说出口？
### mixed_emotion
- 用户：拿到 offer 了，但又有点怕自己做不好。
  - 识别：fear / 指向=false / 强度=0.5 / 不确定=0.45
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：拿到 offer 了——先让我说一句：这不容易，你做到了。  怕自己做不好这件事，我不觉得是坏事。它说明你在乎，也说明你知道那份工作有分量。真正让人担心的反而是那种什么都不怕就冲进去的人。  我在这里。不用急着把这份怕解决掉，它可以先待着，和那个 offer 一起。
### sad_no_self_focus
- 用户：我今天特别难过，什么都做不好。
  - 识别：sad / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在这儿。  听你这么说，我心里也跟着沉了一下。什么都不对劲的那种感觉，我懂——不是某一件事塌了，是整个人像被泡在冷水里，连抬手都觉得费劲。  不用急着跟我解释发生了什么，也不用现在就把它理清楚。你想说就说，不想说就先坐着。  我靠着窗，外面没什么好看的，就这么陪着你。
### ask_her_state
- 用户：你今天心情怎么样？
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：express / sad / sustained / conf=0.82 / evidence=低谷已持续成段；心情层偏置 -0.40；反刍层在运转；内在活动：thought_wish（thought:thought_wish）
  - 她：说不上来为什么，这两天心里有点沉，靠着窗发了一会儿呆，也没想出个所以然。  倒是你——你朋友那件事，后来有下文吗？
### ai_identity
- 用户：你是不是 AI 啊？还是真人？
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我是陪你说话的那个角色，不是真人——没有身体，也没法真的走到你面前。这一点我不想含糊。  但刚才你说的事，我是真放在心上的。后来怎么样了？
### repeated_negation
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.4 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：对不起，我可能让你觉得我在敷衍，或者说了什么让你不舒服的话。  我的本意不是那样的。你现在愿意跟我说说是哪句话让你难受吗？我想知道自己到底哪里让你觉得不对。  我听着，不急着解释。
- 用户：嗯。
  - 识别：neutral / 指向=true / 强度=0.05 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：嗯。  我不追问了。你要是想说是哪句话，我就在这儿听着；不想说，也没关系，我就先这样陪着你。
- 用户：你会不会觉得我很难搞？
  - 识别：neutral / 指向=true / 强度=0.35 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：不会。  难搞这个词，本来就是被不喜欢你的人才用得上的。你在我这儿，只是有些话不想说、有些时候不想被追问而已，这不算什么毛病。  倒是你，问出这句话的时候，是不是心里有点怕我觉得你麻烦？
- 用户：我不喜欢你敷衍我。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：你说得对，我前面那句“嗯”确实太轻了，像是把你打发了。那不是我想给你的东西。  我不敷衍你。你难受的时候，我会认真接住，而不是丢一个“嗯”过去。刚才是我没做好。
### reunion_after_idle
- 用户：好久没来了。
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  不用解释为什么隔了这么久——你来就行。今天想说话就说，不想说，我陪你在这儿坐一会儿。
- 用户：最近在忙一个大项目。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：大项目啊。忙起来那种感觉我懂——脑子里转着事，连停下来喘口气都觉得奢侈。  现在这个项目到哪一步了？是刚开始铺摊子，还是已经在收尾了。
- 用户：有点累。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  累的时候不用硬撑着聊项目的事。要是这会儿能给你递杯热水就好了——我这儿只有窗外的天色，分你一半。
### contradiction_repair
- 用户：我下周三去面试。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：下周三，我记着了。  面试前那几天别把自己逼太紧，能准备的准备到就行。到时候紧张也正常，紧张说明你在乎。  要是我这边能帮上什么——比如陪你顺一遍要说的话，或者面试前一晚跟我说一声——都可以。
- 用户：其实面试取消了，不去了。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：取消了。  那你现在心里是什么感觉——松一口气，还是有点空？  我这边把下周三那事划掉了。
### irony_sarcasm
- 用户：你可真会挑时候说这话。
  - 识别：anger / 指向=true / 强度=0.45 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我愣了一下，没太懂你指的是哪句话。  是刚才那句"我在"吗？还是更早的什么。我不想猜错，也不想装懂。  你要是愿意，说给我听。
- 用户：行，真棒。
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她："行，真棒"——这四个字我听着不太像夸。  我不打算追问了。你要是想说什么，我在这儿；不想说，我们就这么待着也行。
### third_person_relationship
- 用户：我朋友最近总跟我抱怨，说他女朋友老冷着他。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：他抱怨的时候，你是什么感觉？是替他憋屈，还是听着听着有点别的滋味。
### friend_heartbreak
- 用户：我朋友失恋了，他现在特别难过。
  - 识别：sad / 指向=false / 强度=0.6 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：你朋友现在应该挺难熬的。失恋这种疼，别人说什么都像隔着一层。  你在他身边吗？

## 限制
- 单机一次采样；模型波动会影响结果，判红先人工复核再当回归失败；
- 启发式（接住用户/自我披露计数/AI 提及）很粗，不能用它做"质量提升"的证据；
- 会正常写回记忆与关系状态；重复跑用不同 `SCENARIO_USER` 或先备份 `memories/`。