// ── 归因生成 (Attribution Generation) ──
// 从 emotionEngine.ts 拆分 (Phase 5) — 情绪事件/衰减 → 叙事归因

import type { EmotionEvent, EmotionAttribution } from './emotionTypes';

export function generateAttribution(event: EmotionEvent, dominantEmotion: string): EmotionAttribution {
  const { GC = 0, agency = 0, fairness = 0, control = 0 } = event;

  const goalTone: EmotionAttribution['goalTone'] = GC > 0.3 ? 'good' : GC < -0.3 ? 'bad' : 'neutral';

  let primaryCause: EmotionAttribution['primaryCause'] = 'unknown';
  if (agency > 0.5) primaryCause = 'self';
  else if (agency < -0.5) primaryCause = 'user';
  else if (Math.abs(agency) <= 0.5) primaryCause = 'external';

  let narrative: string;
  let triggeredBy: string;

  if (primaryCause === 'user' && GC > 0.3) {
    narrative = `因为用户对你好，让你感到${dominantEmotion}`;
    triggeredBy = '用户的善意';
  } else if (primaryCause === 'user' && GC < -0.3) {
    narrative = `因为用户的做法让你感到${dominantEmotion}`;
    triggeredBy = '用户的行为';
    if (fairness < -0.3) narrative += '，而且你觉得这不公平';
  } else if (primaryCause === 'self' && GC > 0.3) {
    narrative = `因为你做对了，你感到${dominantEmotion}`;
    triggeredBy = '自己的表现';
  } else if (primaryCause === 'self' && GC < -0.3) {
    narrative = `因为自己的失误让你感到${dominantEmotion}和内疚`;
    triggeredBy = '自己的失误';
  } else if (GC > 0.3) {
    narrative = `发生了好事，你感到${dominantEmotion}`;
    triggeredBy = '外部事件';
  } else if (GC < -0.3) {
    narrative = `发生了不好的事，你感到${dominantEmotion}`;
    triggeredBy = '外部事件';
  } else {
    narrative = `你感到${dominantEmotion}，情绪平稳`;
    triggeredBy = '日常状态';
  }
  if (control < -0.3) narrative += '，你对局面感到无力';

  return { primaryCause, goalTone, narrative, triggeredBy };
}

export function generateDecayAttribution(dominantBefore: string, dominantAfter: string, hoursPassed: number = 0): EmotionAttribution {
  const isOffline = hoursPassed >= 0.5;
  const decayReasons: Record<string, { narrative: string; triggeredBy: string }> = {
    joy:    { narrative: '开心的时刻过去了，心情慢慢平复下来', triggeredBy: '愉悦感消退' },
    anger:  { narrative: '气消了一些，冷静下来想想其实没什么大不了的', triggeredBy: '怒气消散' },
    sad:    { narrative: '虽然还是有点难过，但情绪已经沉淀了一些', triggeredBy: '悲伤沉淀' },
    fear:   { narrative: '仔细想想，其实没那么可怕，放松了一些', triggeredBy: '恐惧缓解' },
    love:   { narrative: '心里还是想着你，只是情绪没那么强烈了', triggeredBy: '思念沉淀' },
    disgust:{ narrative: '眼不见心不烦，反感慢慢淡了', triggeredBy: '厌恶淡化' },
    lust:   { narrative: '冲动过去了，恢复了冷静', triggeredBy: '欲望平复' },
    calm:   { narrative: '没什么特别的事，心情一直很平静', triggeredBy: '平静持续' },
    greed:  { narrative: '内心的渴望渐渐平复，心态平和了一些', triggeredBy: '欲望平复' },
  };
  const offlineReasons: Record<string, { narrative: string; triggeredBy: string }> = {
    joy:    { narrative: '你不在身边，那份开心慢慢淡了', triggeredBy: '离线愉悦消退' },
    anger:  { narrative: '一个人待着，气也消了大半', triggeredBy: '离线怒气消散' },
    sad:    { narrative: '一个人待着，悲伤反而慢慢沉淀下来了', triggeredBy: '离线悲伤沉淀' },
    fear:   { narrative: '你不在的时候，不安的感觉其实还在', triggeredBy: '离线不安' },
    love:   { narrative: '有点想你，但知道你会回来的', triggeredBy: '离线思念' },
    disgust:{ narrative: '眼不见心不烦，慢慢也就淡了', triggeredBy: '离线厌恶淡化' },
    lust:   { narrative: '冲动过去了，恢复了冷静', triggeredBy: '离线欲望平复' },
    calm:   { narrative: '一个人安安静静的，心情很平静', triggeredBy: '离线平静' },
    greed:  { narrative: '一个人待着，想你的感觉淡淡的', triggeredBy: '离线思念平复' },
  };
  const reason = isOffline ? (offlineReasons[dominantBefore] ?? offlineReasons.calm) : (decayReasons[dominantBefore] ?? decayReasons.calm);
  let narrative: string;
  if (isOffline && hoursPassed >= 48) {
    narrative = Math.round(hoursPassed) + '小时没见了，' + reason.narrative + '，只剩下' + dominantAfter + '的情绪';
  } else {
    narrative = dominantAfter === 'calm' && dominantBefore !== 'calm' ? reason.narrative + '，慢慢归于平静' : reason.narrative;
  }
  return { primaryCause: 'external', goalTone: 'neutral', narrative, triggeredBy: reason.triggeredBy };
}
