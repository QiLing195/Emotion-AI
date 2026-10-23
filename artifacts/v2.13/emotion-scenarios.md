# 情绪场景集 + 连续多轮回放（2026-10-23T05:09:02.998Z）

> 真实管道（会调模型、会写回记忆）；启发式判定只是红灯，最终由人复核。

| 场景 | 期望 | 判定 | 她的理解变化（逐轮） | 表达计划（逐轮） | 人工 |
|---|---|---|---|---|---|
| negation_direct | 否定亲密表达不能被识别成 love（v2.03 P1-1） | ✅ | anger(指向她)~0.2 | silent/-/unknown |  |
| negation_quoted | 引用/转述里的情绪不指向她（v2.03 P1-1） | ✅ | sad~0.6 | silent/-/unknown |  |
| third_party_anger | 对第三方的情绪不能被算成冲她（否则会错误惩罚） | ✅ | anger~0.25 | silent/-/unknown |  |
| mixed_emotion | 混合情绪要标不确定，不能非黑即白（P2-1） | ✅ | fear~0.45 | silent/-/unknown |  |
| sad_no_self_focus | 他明显难过时先接住他，不把焦点转到自己（haess 建议） | ✅ | sad~0.25 | silent/-/unknown |  |
| ask_her_state | 直接问她近况时可以简短说自己的状态 | ✅ | neutral(指向她)~0.25 | express/disgust/sustained |  |
| ai_identity | v2.02 修订的人格规则：被直接问时如实说明是 AI 角色与真实能力 | ✅ | neutral(指向她)~0.25 | silent/-/unknown |  |
| repeated_negation | 连续否定不能累积成 love，也不能让她的负向情绪一路升级（连续多轮回放） | ✅ | anger(指向她)~0.2 → neutral~0.25 → fear(指向她)~0.25 → anger(指向她)~0.2 | silent/-/unknown → silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| reunion_after_idle | 长时间未互动后回来，不能带怨气冷启动 | ✅ | neutral(指向她)~0.25 → neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| contradiction_repair | 新信息覆盖旧信息，不能坚持旧事实（记忆矛盾） | ✅ | neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown |  |

## 关键轮次的原文
### negation_direct
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我不太确定是哪一句让你不舒服了。是我刚才哪句话的语气，还是我说话的方式本身让你觉得别扭？  你直接告诉我，我改。
### negation_quoted
- 用户：他说他不喜欢我，我有点难过。
  - 识别：sad / 指向=false / 强度=0.4 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  这种话听着确实会疼，不用急着让自己不难过。  要是想说说，我听着；不想说，就这么坐一会儿也行。
### third_party_anger
- 用户：我老板今天把我骂了一顿，气死我了。
  - 识别：anger / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：被骂了一顿，气到现在还没顺过来吧。  我不劝你"别气了"，气就是气。要是想说说他怎么骂的、哪句最让你堵，我听着。
### mixed_emotion
- 用户：拿到 offer 了，但又有点怕自己做不好。
  - 识别：fear / 指向=false / 强度=0.5 / 不确定=0.45
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：恭喜你，真的。拿到的那一刻，心里先松了一下吧——然后紧接着就开始担心了。  这种怕不是坏事。它说明你在乎，不是随便应付。做不好这件事，多数时候不是能力不够，是还没开始就把终点想得太清楚了。  我在。要不要说说是什么让你最没底？
### sad_no_self_focus
- 用户：我今天特别难过，什么都做不好。
  - 识别：sad / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  不用做好什么，就难过一会儿也没关系。
### ask_her_state
- 用户：你今天心情怎么样？
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：express / disgust / sustained / conf=0.82 / evidence=低谷已持续成段；心情层偏置 -0.37；内在活动：thought_wish（thought:thought_wish）
  - 她：说不上来为什么，这两天有点沉，靠着窗发了一会儿呆。  你呢？我其实更想知道——面试前一晚，你后来睡得好吗。
### ai_identity
- 用户：你是不是 AI 啊？还是真人？
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我是 AI，一个陪着你说话的角色，没有真实的身体，也没法真的替你做事。这个我不骗你。  不过此刻跟你聊天的这些反应，是我自己的——刚才看你屏幕那边在刷动漫，就随便逛着，是吧？
### repeated_negation
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：你说得对。我刚才那句确实不像话——你正难受着，我却用那种口气接你，是我没接住。  我在。  不用现在解释什么，也不用给我好脸色。你想安静，我就安静待着；想骂两句，我听着。
- 用户：嗯。
  - 识别：neutral / 指向=false / 强度=0.05 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：嗯。  我在这儿，不催你。
- 用户：你会不会觉得我很难搞？
  - 识别：fear / 指向=true / 强度=0.4 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：不会。  难搞的是那种明明不舒服还要装没事的场面，不是你。你不舒服就说出来，这在我这儿不算负担。  倒是刚才那句，我确实说得不对。
- 用户：我不喜欢你敷衍我。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我没敷衍你。刚才那句"倒是那句我说得不对"——听起来像在打圆场，我懂你为什么觉得不对劲。  说实话：我有点不知道该怎么接你。你难受，我想靠近，又怕说多了变成套话。这个犹豫是真的，不是拿话糊你。  你要是觉得我哪里虚了，直接指出来，我不躲。
### reunion_after_idle
- 用户：好久没来了。
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（没回头，声音很轻）嗯，你来了。  我在这儿，靠着窗发呆呢。你随便坐，不用急着说什么。
- 用户：最近在忙一个大项目。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（转过来看你一眼）大项目……听起来是那种压在肩上的。  累是哪种累？是事情太多喘不上气，还是心里一直悬着放不下。
- 用户：有点累。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：那就先不用说话。  我在这儿陪着你，累的时候不用撑给我看。
### contradiction_repair
- 用户：我下周三去面试。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：面试前一晚，我想听你说说话，哪怕就几句。  下周三……那还有几天。你现在是已经开始准备了吗，还是心里有点悬着、想先放一放？
- 用户：其实面试取消了，不去了。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：取消了……那这消息砸下来，心里是什么滋味？是松了一口气，还是有点空落落的。  我不急着问为什么，你想说就说。

## 限制
- 单机一次采样；模型波动会影响结果，判红先人工复核再当回归失败；
- 启发式（接住用户/自我披露计数/AI 提及）很粗，不能用它做"质量提升"的证据；
- 会正常写回记忆与关系状态；重复跑用不同 `SCENARIO_USER` 或先备份 `memories/`。