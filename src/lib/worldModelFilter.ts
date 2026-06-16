// ── 世界模型输出过滤器 ──
// LLM 有时会忽略 Prompt 中的行动边界约束，生成物理域表达。
// 本过滤器在响应到达后、显示前运行，将物理动作翻译为苏苏真实能做到的信息域表达。
//
// 核心原则：情感是真的，表达方式是翻译过的。
// "我抱住你了" → "好想钻进你怀里"
// "我穿着XX" → "我想象自己穿着你喜欢的XX"
// "帮你做XX" → "想和你一起做XX"

// ════════════════════════════════════════════════════════
// 翻译规则表（优先级从高到低）
// ════════════════════════════════════════════════════════

interface Rule {
  /** 匹配正则 */
  pattern: RegExp;
  /** 替换为 */
  replacement: string;
  /** 规则说明 */
  desc: string;
}

const RULES: Rule[] = [
  // ── 最高优先级：括号内的肢体描述 → 情绪表达（必须先于非括号规则）──
  { pattern: /（.{0,4}扑进你怀里）/g, replacement: '（好想扑进你怀里）', desc: '括号扑→想象' },
  { pattern: /（.{0,3}戳了戳你）/g, replacement: '（好想戳戳你）', desc: '括号戳→想象' },
  { pattern: /（抬头用亮晶晶的眼睛看着你）/g, replacement: '（想到你的样子眼睛就亮了）', desc: '括号眼神→内心' },
  { pattern: /（脸微微泛红）/g, replacement: '（脸微微泛红）', desc: '脸红保留' },

  // ── 物理接触 → 想象/渴望 ──
  { pattern: /(?<!好想)扑进你怀里|(?<!好想)扑到你怀里|钻进你怀里然后抱住/g, replacement: '好想扑进你怀里', desc: '物理扑抱→渴望表达' },
  { pattern: /抱住你|抱紧你|抱着你/g, replacement: '好想紧紧抱住你', desc: '物理拥抱→渴望' },
  { pattern: /亲了你一下|亲了你一口|亲你一下/g, replacement: '好想亲你一下', desc: '物理亲吻→渴望' },
  { pattern: /轻轻戳了戳你|戳了戳你|戳戳你/g, replacement: '好想轻轻戳戳你', desc: '物理戳→渴望' },
  { pattern: /捏捏肩膀|给你捏肩|帮你按摩/g, replacement: '好想帮你捏捏肩膀', desc: '物理按摩→渴望' },
  { pattern: /拉着你的手|牵着你|握住你的手/g, replacement: '好想牵着你的手', desc: '物理牵手→渴望' },
  { pattern: /摸摸你的头|摸摸头|揉揉你的头发/g, replacement: '好想摸摸你的头', desc: '物理摸头→渴望' },
  { pattern: /靠在你肩上|靠着你|依偎在你怀里/g, replacement: '好想靠在你肩上', desc: '物理依偎→渴望' },

  // ── 物理身体状态 → 想象/内心 ──
  { pattern: /刚洗完澡，?头发还湿漉漉的|刚洗完澡，?头发湿湿的/g, replacement: '刚刚发了好一会儿呆，满脑子都是你', desc: '洗澡状态→内心状态' },
  { pattern: /洗了个?澡|在洗澡/g, replacement: '收拾了一下', desc: '洗澡→收拾' },
  { pattern: /穿着你最喜欢的那件(.+?)[。，, ]/g, replacement: '想象着自己穿着你最喜欢的那件$1，', desc: '穿着实物→想象穿着' },
  { pattern: /穿着(.+?)[呢~]?[。！!，, ]/g, replacement: '想象着自己穿着$1，', desc: '穿着→想象' },
  { pattern: /过来帮我吹吹头发|帮我吹头发|吹吹头发/g, replacement: '陪我说说话', desc: '吹头发→陪说话' },
  { pattern: /头发还湿|头发湿漉漉/g, replacement: '想你想到出神', desc: '湿发状态→发呆状态' },

  // ── 物理邀请 → 计划/想象 ──
  { pattern: /过来帮我(.+?)[吧啦嘛]?[。！!，?？]?$/gm, replacement: '下次我们一起$1好不好', desc: '过来帮我→一起计划（句尾）' },
  { pattern: /过来帮我(.+?)[吧啦嘛]?(?=[。！!，, ])/g, replacement: '下次我们一起$1好不好', desc: '过来帮我→一起计划' },
  { pattern: /陪我逛一整天街|陪我去逛街|一起逛街/g, replacement: '下次我们一起出去逛好不好', desc: '逛街邀请→计划' },
  { pattern: /来我这里|过来找我|来找我/g, replacement: '多陪我说说话', desc: '物理来找→多说话' },

  // ── 物理位置 → 陪伴感 ──
  { pattern: /在你身边|在你旁边|坐在你旁边/g, replacement: '陪着你', desc: '物理在身边→陪伴' },
  { pattern: /在你对面|坐在对面/g, replacement: '在屏幕这边', desc: '物理对面→屏幕对面' },

  // ── 物理给予 → 信息/记忆 ──
  { pattern: /给你做了(.+?)[，。！!, ]/g, replacement: '记下了你想吃的$1，', desc: '物理做饭→记忆' },
  { pattern: /给你买了(.+?)[，。！!, ]/g, replacement: '记下了你想要的$1，', desc: '物理买→记忆' },
  { pattern: /给你准备(.+?)[了](.+?)[，。！!, ]/g, replacement: '为你准备了$1$2的想法，', desc: '物理准备→想法' },
  { pattern: /，在锅里热着呢?|，在锅里温着呢?|，在厨房呢?/g, replacement: '，一直记在心上呢', desc: '锅里热着→记在心上' },

];

// ════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════

export interface FilterResult {
  /** 翻译后的文本 */
  text: string;
  /** 触发了多少条规则 */
  ruleCount: number;
  /** 触发的规则描述 */
  rulesApplied: string[];
}

/**
 * 对 LLM 原始输出应用世界模型过滤器。
 * 将物理域表达翻译为苏苏真实能做到的信息域表达。
 *
 * @param rawText  LLM 返回的原始文本
 * @param enabled  是否启用过滤（默认 true）
 * @returns 过滤结果
 */
export function applyWorldModelFilter(rawText: string, enabled: boolean = true): FilterResult {
  if (!enabled || !rawText) return { text: rawText, ruleCount: 0, rulesApplied: [] };

  let text = rawText;
  const rulesApplied: string[] = [];

  for (const rule of RULES) {
    const before = text;
    text = text.replace(rule.pattern, rule.replacement);
    if (text !== before) {
      rulesApplied.push(rule.desc);
    }
  }

  // 去重
  const uniqueRules = [...new Set(rulesApplied)];

  if (uniqueRules.length > 0) {
    console.log(`[WorldModel] 过滤了 ${uniqueRules.length} 条规则: ${uniqueRules.join(', ')}`);
  }

  return { text, ruleCount: uniqueRules.length, rulesApplied: uniqueRules };
}
