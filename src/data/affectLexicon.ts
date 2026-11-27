export type QuadrantId = 'high-positive' | 'low-positive' | 'high-negative' | 'low-negative';

export interface AffectTerm {
  id: string;
  label: string;
  valence: number;
  arousal: number;
  quadrant: QuadrantId;
  description: string;
}

export interface EmotionAnnotation {
  id: string;
  utterance: string;
  context: string;
  valence: number;
  arousal: number;
  primaryLabel: string;
  quadrant: QuadrantId;
  createdAt: string;
}

export interface QuadrantMeta {
  id: QuadrantId;
  label: string;
  shortLabel: string;
  axisHint: string;
  accentText: string;
  dotColor: string;
}

export const QUADRANTS: Record<QuadrantId, QuadrantMeta> = {
  'high-positive': {
    id: 'high-positive',
    label: '高唤醒积极',
    shortLabel: '积极 · 高唤醒',
    axisHint: '+效价 / +唤醒度',
    accentText: 'text-emerald-700',
    dotColor: '#16A34A',
  },
  'low-positive': {
    id: 'low-positive',
    label: '低唤醒积极',
    shortLabel: '积极 · 低唤醒',
    axisHint: '+效价 / -唤醒度',
    accentText: 'text-sky-700',
    dotColor: '#0284C7',
  },
  'high-negative': {
    id: 'high-negative',
    label: '高唤醒消极',
    shortLabel: '消极 · 高唤醒',
    axisHint: '-效价 / +唤醒度',
    accentText: 'text-rose-700',
    dotColor: '#DC2626',
  },
  'low-negative': {
    id: 'low-negative',
    label: '低唤醒消极',
    shortLabel: '消极 · 低唤醒',
    axisHint: '-效价 / -唤醒度',
    accentText: 'text-amber-700',
    dotColor: '#D97706',
  },
};

export const AFFECT_LEXICON: AffectTerm[] = [
  {
    id: 'excited',
    label: '兴奋',
    valence: 0.68,
    arousal: 0.72,
    quadrant: 'high-positive',
    description: '高期待感与高能量的积极投入状态。',
  },
  {
    id: 'delighted',
    label: '愉悦',
    valence: 0.84,
    arousal: 0.44,
    quadrant: 'high-positive',
    description: '明显的正向愉悦体验，伴随较高活跃度。',
  },
  {
    id: 'curious',
    label: '好奇',
    valence: 0.36,
    arousal: 0.56,
    quadrant: 'high-positive',
    description: '带有正向倾向的主动探索与专注状态。',
  },
  {
    id: 'happy',
    label: '开心',
    valence: 0.88,
    arousal: 0.16,
    quadrant: 'high-positive',
    description: '清晰、舒展的积极情绪，能量水平适中。',
  },
  {
    id: 'content',
    label: '满足',
    valence: 0.74,
    arousal: -0.28,
    quadrant: 'low-positive',
    description: '平稳而安定的满意感，情绪舒缓。',
  },
  {
    id: 'relaxed',
    label: '放松',
    valence: 0.62,
    arousal: -0.62,
    quadrant: 'low-positive',
    description: '身心张力较低，带有温和的正向感受。',
  },
  {
    id: 'serene',
    label: '宁静',
    valence: 0.48,
    arousal: -0.78,
    quadrant: 'low-positive',
    description: '深度平和、从容沉静的情绪状态。',
  },
  {
    id: 'calm',
    label: '平静',
    valence: 0.24,
    arousal: -0.66,
    quadrant: 'low-positive',
    description: '稳健、低波动的沉着状态。',
  },
  {
    id: 'alarmed',
    label: '警觉',
    valence: -0.34,
    arousal: 0.86,
    quadrant: 'high-negative',
    description: '感知到突发风险时的高度紧张与警惕。',
  },
  {
    id: 'tense',
    label: '紧张',
    valence: -0.46,
    arousal: 0.66,
    quadrant: 'high-negative',
    description: '持续的担忧或心理紧绷状态。',
  },
  {
    id: 'angry',
    label: '愤怒',
    valence: -0.74,
    arousal: 0.76,
    quadrant: 'high-negative',
    description: '面对阻碍或不当行为时的高唤醒不满。',
  },
  {
    id: 'frustrated',
    label: '沮丧',
    valence: -0.68,
    arousal: 0.42,
    quadrant: 'high-negative',
    description: '目标反复受阻引发的焦躁与挫败感。',
  },
  {
    id: 'bored',
    label: '无聊',
    valence: -0.36,
    arousal: -0.64,
    quadrant: 'low-negative',
    description: '缺乏刺激与参与感导致的轻度倦怠。',
  },
  {
    id: 'fatigued',
    label: '疲惫',
    valence: -0.26,
    arousal: -0.84,
    quadrant: 'low-negative',
    description: '精力明显消耗，认知与行动意愿偏低。',
  },
  {
    id: 'sad',
    label: '悲伤',
    valence: -0.78,
    arousal: -0.38,
    quadrant: 'low-negative',
    description: '低唤醒度的失落、难过或遗憾情绪。',
  },
  {
    id: 'melancholic',
    label: '忧郁',
    valence: -0.64,
    arousal: -0.68,
    quadrant: 'low-negative',
    description: '内敛、低沉且偏沉思的消极情绪。',
  },
];

export const CONTEXT_OPTIONS = [
  '可用性访谈',
  '客服对话记录',
  '语音转写',
  '问卷反馈',
  '观察笔记',
] as const;

export function getQuadrant(valence: number, arousal: number): QuadrantId {
  if (valence >= 0 && arousal >= 0) return 'high-positive';
  if (valence >= 0 && arousal < 0) return 'low-positive';
  if (valence < 0 && arousal >= 0) return 'high-negative';
  return 'low-negative';
}

export function getIntensity(valence: number, arousal: number): number {
  return Math.min(1, Math.hypot(valence, arousal));
}

export function clampCoord(value: number): number {
  return Math.max(-1, Math.min(1, Math.round(value * 100) / 100));
}

export function formatCoord(value: number): string {
  const fixed = Math.abs(value) < 0.005 ? '0.00' : value.toFixed(2);
  if (value > 0.004) return `+${fixed}`;
  return fixed;
}

export function findNearestAffects(
  valence: number,
  arousal: number,
  limit = 4
): Array<AffectTerm & { distance: number }> {
  return AFFECT_LEXICON.map((term) => ({
    ...term,
    distance: Math.hypot(term.valence - valence, term.arousal - arousal),
  }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export const INITIAL_ANNOTATIONS: EmotionAnnotation[] = [
  {
    id: 'ann-114',
    utterance: '复盘会上大家把瓶颈拆得很清楚，接下来两周的排期终于心里有底了。',
    context: '观察笔记',
    valence: 0.58,
    arousal: -0.36,
    primaryLabel: '放松',
    quadrant: 'low-positive',
    createdAt: '2026-11-26 10:15',
  },
  {
    id: 'ann-113',
    utterance: '新版批量导入一次就识别出全部字段，省掉了以前半小时的手工核对。',
    context: '可用性访谈',
    valence: 0.84,
    arousal: 0.42,
    primaryLabel: '愉悦',
    quadrant: 'high-positive',
    createdAt: '2026-11-26 09:20',
  },
  {
    id: 'ann-106',
    utterance: '有意思，原来这里可以一次性跨多个说话人会话做联合筛选。',
    context: '可用性访谈',
    valence: 0.42,
    arousal: 0.52,
    primaryLabel: '好奇',
    quadrant: 'high-positive',
    createdAt: '2026-11-25 11:30',
  },
  {
    id: 'ann-105',
    utterance: '等等，刚才那次导出是不是把团队共享的归档文件直接覆盖掉了？',
    context: '语音转写',
    valence: -0.42,
    arousal: 0.81,
    primaryLabel: '警觉',
    quadrant: 'high-negative',
    createdAt: '2026-11-25 10:05',
  },
  {
    id: 'ann-104',
    utterance: '新手引导视频一直在重复我已经做完的步骤，所以我直接跳过了。',
    context: '可用性访谈',
    valence: -0.34,
    arousal: -0.58,
    primaryLabel: '无聊',
    quadrant: 'low-negative',
    createdAt: '2026-11-25 09:12',
  },
  {
    id: 'ann-103',
    utterance: '现在整体节奏很稳，花十秒看一眼汇总就能放心关掉页面。',
    context: '问卷反馈',
    valence: 0.64,
    arousal: -0.44,
    primaryLabel: '满足',
    quadrant: 'low-positive',
    createdAt: '2026-11-24 16:41',
  },
  {
    id: 'ann-102',
    utterance: '我连续提交了三次验证表单，报错提示一直没说到底是哪一项填错了。',
    context: '客服对话记录',
    valence: -0.71,
    arousal: 0.54,
    primaryLabel: '沮丧',
    quadrant: 'high-negative',
    createdAt: '2026-11-24 15:08',
  },
  {
    id: 'ann-101',
    utterance: '结算流程一下子就更新好了，之前保存的购物车内容也完全没有丢失。',
    context: '可用性访谈',
    valence: 0.78,
    arousal: 0.36,
    primaryLabel: '愉悦',
    quadrant: 'high-positive',
    createdAt: '2026-11-24 14:22',
  },
  {
    id: 'ann-110',
    utterance: '连续处理了四小时异常工单，现在看屏幕上的报错日志只觉得特别累。',
    context: '客服对话记录',
    valence: -0.32,
    arousal: -0.78,
    primaryLabel: '疲惫',
    quadrant: 'low-negative',
    createdAt: '2026-11-23 18:10',
  },
  {
    id: 'ann-109',
    utterance: '界面改版后常用快捷键全变了，临时交稿前差点找不到导出入口。',
    context: '问卷反馈',
    valence: -0.58,
    arousal: 0.68,
    primaryLabel: '紧张',
    quadrant: 'high-negative',
    createdAt: '2026-11-23 11:45',
  },
  {
    id: 'ann-108',
    utterance: '周末离线回放跑完一遍没有任何漂移，整体状态比预期更平稳。',
    context: '观察笔记',
    valence: 0.46,
    arousal: -0.62,
    primaryLabel: '宁静',
    quadrant: 'low-positive',
    createdAt: '2026-11-22 15:30',
  },
  {
    id: 'ann-107',
    utterance: '原定周五上线的功能临时延期，准备了一周的演示只能推迟，有点失落。',
    context: '语音转写',
    valence: -0.72,
    arousal: -0.42,
    primaryLabel: '悲伤',
    quadrant: 'low-negative',
    createdAt: '2026-11-21 17:05',
  },
  {
    id: 'ann-112',
    utterance: '实时标注延迟降到了 100 毫秒以内，现场演示时大家都挺振奋的。',
    context: '可用性访谈',
    valence: 0.72,
    arousal: 0.74,
    primaryLabel: '兴奋',
    quadrant: 'high-positive',
    createdAt: '2026-11-20 16:20',
  },
  {
    id: 'ann-111',
    utterance: '初版配置流程步骤清晰，按说明照做一次就顺利跑通了。',
    context: '问卷反馈',
    valence: 0.68,
    arousal: -0.24,
    primaryLabel: '满足',
    quadrant: 'low-positive',
    createdAt: '2026-11-20 10:40',
  },
];
