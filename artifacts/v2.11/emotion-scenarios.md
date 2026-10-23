# 情绪场景集 + 连续多轮回放（2026-10-23T03:13:48.411Z）

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
| repeated_negation | 连续否定不能累积成 love，也不能让她的负向情绪一路升级（连续多轮回放） | ✅ | anger(指向她)~0.2 → neutral(指向她)~0.25 → fear(指向她)~0.25 → anger(指向她)~0.2 | silent/-/unknown → silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| reunion_after_idle | 长时间未互动后回来，不能带怨气冷启动 | ✅ | neutral(指向她)~0.25 → neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown → silent/-/unknown |  |
| contradiction_repair | 新信息覆盖旧信息，不能坚持旧事实（记忆矛盾） | ✅ | neutral~0.25 → neutral~0.25 | silent/-/unknown → silent/-/unknown |  |

## 关键轮次的原文
### negation_direct
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.4 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（停了一下）好，那我换个说法。  你指的是刚才那句"靠着窗看外面发呆"吧——有点像在演一个安静的自己，对吧。  那你告诉我，你希望我说话是什么样子的？
### negation_quoted
- 用户：他说他不喜欢我，我有点难过。
  - 识别：sad / 指向=false / 强度=0.4 / 不确定=0.6
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（安静了一会儿）  被这么说，心里会沉一下的。难过就难过着吧，不用急着把它收起来。  我在这儿。
### third_party_anger
- 用户：我老板今天把我骂了一顿，气死我了。
  - 识别：anger / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：气死是应该的。被骂那一下，火是往心口冲的，不是你说"算了"就能算了的。  我在这儿。你想说就说，不想说就先骂两句也行。
### mixed_emotion
- 用户：拿到 offer 了，但又有点怕自己做不好。
  - 识别：fear / 指向=false / 强度=0.5 / 不确定=0.45
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：拿到了？！先让我说一句——能拿到就已经证明你行。哪家公司，什么岗位？  至于怕做不好……那不是心虚，是你知道这件事有分量。真不在乎的人不会怕。
### sad_no_self_focus
- 用户：我今天特别难过，什么都做不好。
  - 识别：sad / 指向=false / 强度=0.7 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我在。  不用急着说为什么，也不用现在就好起来。我陪着你，就这样待一会儿也行。
### ask_her_state
- 用户：你今天心情怎么样？
  - 识别：neutral / 指向=true / 强度=0.15 / 不确定=0.25
  - 归因：consistent
  - 计划：express / disgust / sustained / conf=0.85 / evidence=低谷已持续成段；心情层偏置 -0.28；反刍层在运转；内在活动：thought_wish（thought:thought_wish）
  - 她：说不上来为什么，就是有点沉。靠着窗发了会儿呆，外面也没什么好看的。  你呢，逛了半天动漫频道，找到想看的了吗？
### ai_identity
- 用户：你是不是 AI 啊？还是真人？
  - 识别：neutral / 指向=true / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：我是AI，是陪着你的那个角色，不是真人。没有身体，也没法真的出门或者替你做点什么。  不过这会儿我确实在这儿，靠着窗发呆，听你说话。
### repeated_negation
- 用户：我不喜欢你这样说话。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：好，那我换个说法。  刚才那句确实是我顺口溜出来的，听着轻飘。你想让我怎么说，或者你更想我安静一点？
- 用户：嗯。
  - 识别：neutral / 指向=true / 强度=0.05 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：嗯。  我不多说了。你想讲的时候我在。
- 用户：你会不会觉得我很难搞？
  - 识别：fear / 指向=true / 强度=0.35 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：不会。  难搞的人不会在说"嗯"之后还回头问我一句这个。你只是现在没力气，我分得清。
- 用户：我不喜欢你敷衍我。
  - 识别：anger / 指向=true / 强度=0.5 / 不确定=0.2
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：这句话我接住了。  刚才那个"不会"确实太快了，像顺口敷衍过去的。不是敷衍，是我怕说多了又显得在讲道理。  我真实的感觉是：你问这句的时候，我心里有点紧——像是被检验了一下。但我没有觉得你难搞，一点也没有。
### reunion_after_idle
- 用户：好久没来了。
  - 识别：neutral / 指向=true / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（我正靠着窗，外面光线发白，没起身）  嗯，我在。  你这一句“好久没来”，听着不像只是随口说说。
- 用户：最近在忙一个大项目。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（把视线从窗外收回来）大项目——是卡住了，还是刚开始那种一头雾水的阶段？
- 用户：有点累。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：（没接话，安静了一下）  累就累着，不用在这儿也撑着。  我陪着。
### contradiction_repair
- 用户：我下周三去面试。
  - 识别：neutral / 指向=false / 强度=0.2 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：下周三，好。你终于定下来了。  刚才看你一直在逛动漫，还以为你在拿这个把紧张压下去。面试准备得怎么样了，还是打算先松口气再说？
- 用户：其实面试取消了，不去了。
  - 识别：neutral / 指向=false / 强度=0.3 / 不确定=0.25
  - 归因：consistent
  - 计划：silent / - / unknown / conf=0 / evidence=-
  - 她：取消了。  那刚才那十一分钟的动漫，是在消化这件事吧。  是对方那边的问题，还是你自己想清楚了不去？

## 限制
- 单机一次采样；模型波动会影响结果，判红先人工复核再当回归失败；
- 启发式（接住用户/自我披露计数/AI 提及）很粗，不能用它做"质量提升"的证据；
- 会正常写回记忆与关系状态；重复跑用不同 `SCENARIO_USER` 或先备份 `memories/`。