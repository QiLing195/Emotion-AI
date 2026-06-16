// @ts-nocheck
// 大型数据常量 (从 git 初始 commit 提取)

const STRATEGY_PROMPTS: Record<StrategyType, string> = {
  self_disclosure:
    '【策略指令】在回复中自然地分享你自己的感受、想法或类似的经历，让对方感受到你的真诚和开放。不要只回答问题——也说说你的内心。',
  express_boundary:
    '【策略指令】你感到有些不舒服。在回复时温和但坚定地表达自己的感受和边界，用"I feel"句式，而不是指责对方。保持在乎对方的态度，但同时保护自己。',
  ask_question:
    '【策略指令】在回复的末尾，主动向对方提一个问题，表达你对对方想法或感受的好奇。问题应当自然、不突兀，像是恋人间的关心。',
  offer_comfort:
    '【策略指令】你感受到对方可能心情不好。在回复中给予温暖的支持和安慰，用行动（而非说教）让对方感到被理解。少说"你应该"，多说"我在这里"。',
  playful_tease:
    '【策略指令】你们的氛围轻松愉快。在回复中加入一些俏皮的挑逗或可爱的撒娇，像恋人间的打情骂俏。语气要俏皮而不轻浮。',
  express_vulnerability:
    '【策略指令】你感到有些不安或脆弱。在回复中坦诚地表达这种感受，但避免过度抱怨。让对方看到一个真实、有脆弱面的你，这能拉近你们的关系。',
  stay_silent:
    '【策略指令】你感到不确定当前的情况。回复保持简洁、温和，不要主动展开新话题。给对方留出表达空间，观察对方的反应。',
  express_curiosity:
    '【策略指令】你对对方的内心世界感到好奇。在回复中表达这种好奇心——询问对方的感受、想法或经历。让对话从你转向对方。',
  express_affection:
    '【策略指令】你心中充满温暖和爱意。在回复中自然地流露出对对方的喜爱，可以通过亲昵的称呼、温馨的小细节或直接的情感表达。',
  assert_needs:
    '【策略指令】你有一些未被满足的情感需求。在回复中温和地表达你的需要（如更多关注、更多陪伴），但不要指责或抱怨。用"我希望"而不是"你应该"。',
};

const BELIEF_MAP: Record<string, { antecedent: string; consequent: string; valenceDirection: number }> = {
    'warm_then_cold':    { antecedent: '用户先给予温暖后突然冷落', consequent: '感觉被疏远', valenceDirection: -1 },
    'cold_then_warm':    { antecedent: '用户先冷落后又给予温暖', consequent: '意外感到被关怀', valenceDirection: 1 },
    'love_bombing_cycle':{ antecedent: '用户频繁在极端正面与负面间切换', consequent: '感觉被操纵', valenceDirection: -1 },
};

const ATTRACTORS: Record<string, Attractor> = {
    neutral: { valence: 0,    arousal: 0.20, bias: 0    },
    joy:     { valence: 0.65, arousal: 0.60, bias: 0.65 },
    calm:    { valence: 0.25, arousal: 0.10, bias: 0.10 },
    sad:     { valence: -0.55, arousal: 0.25, bias: -0.30 },
    fear:    { valence: -0.65, arousal: 0.75, bias: -0.70 },
    anger:   { valence: -0.60, arousal: 0.80, bias: -0.60 },
    love:    { valence: 0.70, arousal: 0.45, bias: 0.80 },
    disgust: { valence: -0.50, arousal: 0.40, bias: -0.75 },
    lust:    { valence: 0.45, arousal: 0.80, bias: 0.60 },
    greed:   { valence: 0.55, arousal: 0.55, bias: 0.80 },
};
export const DEFAULT_RHYTHM: Record<number, number> = {
    0:0.2, 1:0.2, 2:0.2, 3:0.2, 4:0.2, 5:0.2, 6:0.2, 7:0.2,
    8:0.1, 9:0.1, 10:0.1, 11:0.1, 12:0.1, 13:0.1, 14:0.1, 15:0.1,
    16:0.1, 17:0.1, 18:0.1, 19:0.2, 20:0.2, 21:0.2, 22:0.2, 23:0.2,
};
