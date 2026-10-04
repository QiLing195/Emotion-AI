// ── 道·情感引擎 (Dao Emotion Engine) ──
// 预测误差驱动的分层架构：太极 → 阴阳 → 三才 → 万物 → 演化
//
// 哲学根基:
//   道生一 → 太极(预测误差最小单元)
//   一生二 → 阴阳(贪婪-恐惧轴、趋近-回避)
//   二生三 → 三才(A/B/R 动力学)
//   三生万物 → 九情、复合情绪、元情感
//   反者道之动 → 极值反转(统一切换变量)
//   弱者道之用 → 预期更新最慢、自适应衰减
//
// v4 重构核心:
//   - 单一预测误差方程统一对比效应、习惯化、操作条件反射
//   - 吸引子距离替代权重矩阵计算九情
//   - 统一反转规则替代 7 个硬编码影子变量
//   - 三时间尺度演化替代成长系统 + 自适应参数

// v4.1 算法补丁（特性开关保护）
import {
  computePersonalizedError,
  computeArousalUpdate,
  applySmoothReversal,
  emotionSmoother,
  computePersonalizedAlphas,
} from './emotionOptimizer';

// Phase 1: Emotion-Cognition Deep Coupling — 情绪上下文 DTO
import type { EmotionContext } from '../types/shared';

// v1.48：状态块可改读**激发态**（`ENABLE_ACTIVATION_STATE`，默认关）。
// 依赖方向是**单向**的：emotionActivation → emotionTypes（叶子），本文件 → emotionActivation。
// 有回归测试扫源码钉住这条（若哪天 emotionActivation 反过来 import 本文件就会成环，
// 而环在 ESM 下的表现是"某个常量在模块初始化时读到 undefined"——静默且难查）。
import { activationOf, activationStateBlockEnabled, emotionLabel, type EmotionActivation } from './emotionActivation';
/** 特性开关：v4.1 算法补丁。设为 false 可立即回退到 v4.0 原始行为。 */
const USE_EMOTION_OPTIMIZER = true;

/** 确定性模式：跳过所有 Math.random() 噪声，保证 applyEvent 可精确回放。 */
let _deterministicMode = false;
export function setDeterministicMode(enabled: boolean): void { _deterministicMode = enabled; }
export function isDeterministicMode(): boolean { return _deterministicMode; }

// ponytail: types/constants extracted to emotionTypes.ts
export * from './emotionTypes';

// Internal imports for remaining engine code
import type {
  TaijiState, YinYangState, SancaiState, EvolutionState,
  EmotionState, EmotionEvent, EmotionAttribution, UserEmotionAnalysis,
  EmotionContextOptions, CompositeEmotion, ReinforcementSource, ReinforcementSignal,
  CompositeRule, EmotionKey, RelationshipStage, Attractor,
} from './emotionTypes';
import {
  ALPHA_V, ALPHA_A, ALPHA_E, REVERSAL_RATE, EXTREMITY_THRESHOLD,
  COUPLING_BASE, ATTRACTOR_SENS, ADAPT_FAST, ADAPT_MEDIUM, ADAPT_SLOW,
  SALIENCE_DEADZONE, SALIENCE_FULL,
  OFFLINE_RESILIENCE, RESILIENCE_LEAK, EMOTION_ATTRACTORS,
  INITIAL_TAIJI, INITIAL_YINYANG, INITIAL_SANCAI, INITIAL_EVOLUTION,
  INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET, INITIAL_EMOTION_GENTLE,
  STAGE_LABELS, STAGE_DESCRIPTIONS, COMPOSITE_RULES,
} from './emotionTypes';

// ════════════════════════════════════════════════════════════
// 5. 核心函数：太极更新（预测误差驱动）
// ════════════════════════════════════════════════════════════

function taijiUpdate(
  taiji: TaijiState,
  eventValence: number,
  eventSalience: number,
  evolution?: EvolutionState,
): void {
  // 预测误差 — 情感的唯一驱动力
  let predictionError = eventValence - taiji.expectation;

  // ⚠️ v1.15 修复「没有消息被当成坏消息」：
  // 之前 eventSalience 只用于唤醒，效价/预期则被**全额**预测误差驱动。
  // 于是"全零事件"（NLU 无信号、纯寒暄）会得到 error = 0 − expectation(如 +0.2) = −0.2，
  // 再被损失厌恶放大 → 她的效价被无中生有地扣掉；实测 12 轮零信号事件把 valence 从
  // 0.2 拖到 −0.31、disgust 0→0.35，并成为"长期停在低谷"的根因。
  // 语义修正：**没有信号 = 没有误差**（误差必须先有信息量），按显著性门控。
  const infoFactor = clamp(
    (eventSalience - SALIENCE_DEADZONE) / Math.max(1e-6, SALIENCE_FULL - SALIENCE_DEADZONE),
    0, 1,
  );
  predictionError *= infoFactor;

  // 🆕 S6: 从人格参数计算个性化 alpha（替代硬编码常量）
  const alphas = (evolution && USE_EMOTION_OPTIMIZER)
    ? computePersonalizedAlphas(evolution)
    : { alphaV: ALPHA_V, alphaA: ALPHA_A, alphaE: ALPHA_E };

  // v4.1 补丁：个性化损失厌恶（负误差根据 resilience/sensitivity 放大）
  if (evolution && USE_EMOTION_OPTIMIZER) {
    predictionError = computePersonalizedError(predictionError, evolution);
  }

  // 显著性调制：高唤醒 × 高显著性 → 冲击更大
  const modulation = 1 + taiji.arousal * eventSalience;

  // 三合一更新（使用个性化 alpha）
  taiji.valence     += alphas.alphaV * Math.tanh(predictionError * modulation);

  // v4.1 补丁：唤醒边界修复 — 正面误差保留最小上升空间，加入基线回归
  if (USE_EMOTION_OPTIMIZER) {
    taiji.arousal = computeArousalUpdate(taiji.arousal, predictionError, eventSalience, alphas.alphaA);
  } else {
    taiji.arousal += alphas.alphaA * Math.abs(predictionError) * (1 - taiji.arousal) * eventSalience;
  }

  taiji.expectation += alphas.alphaE * predictionError;

  // 自然衰减倾向（v2.0: 降低衰减率，防止深度对话中情感持续漏气）
  taiji.valence     *= 0.995;
  taiji.arousal     *= 0.992;

  // 限幅
  taiji.valence = clamp(taiji.valence, -1, 1);
  taiji.arousal = clamp(taiji.arousal, 0, 1);
  taiji.expectation = clamp(taiji.expectation, -1, 1);
}

// ════════════════════════════════════════════════════════════
// 6. 核心函数：阴阳派生 + 反转规则
// ════════════════════════════════════════════════════════════

function deriveYinYang(taiji: TaijiState): Pick<YinYangState, 'approachBias' | 'avoidBias'> {
  const approachBias = Math.tanh(
    taiji.valence * 0.7 + taiji.expectation * 0.3 + taiji.arousal * 0.2,
  );
  const avoidBias = Math.tanh(
    -taiji.valence * 0.7 + -taiji.expectation * 0.3 + taiji.arousal * 0.2,
  );
  return { approachBias, avoidBias };
}

/**
 * "反者道之动" — 统一反转规则，替代原来的 7 个硬编码影子变量。
 *
 * 当 valence 长时间处于极值区（|v| > 阈值），累积反转压力。
 * 压力超过门限时产生反向推力，将状态拉回中性。
 *
 * 7 种旧影子变量在此规则下只是不同归因叙事：
 *   乐极生悲  = valence 正极值 + 反转触发
 *   否极泰来  = valence 负极值 + 反转触发
 *   爱极生厌  = 长期正效价 + love 高吸引子 + 反转触发
 *   忍无可忍  = 长期 anger 高值 + 反转触发
 *   贪中惧    = 高预期 + 负预测误差
 *   惧中贪    = 低预期 + 正预测误差
 */
function applyReversal(taiji: TaijiState, yy: YinYangState): number {
  const extremity = Math.abs(taiji.valence);

  if (extremity > EXTREMITY_THRESHOLD) {
    yy.extremityDuration = Math.min(10, yy.extremityDuration + 1);
  } else {
    yy.extremityDuration *= 0.9;
  }

  // 反转力 = 极值程度² × 持续时间 × 速率，方向朝向中性
  const force = extremity * extremity * yy.extremityDuration * REVERSAL_RATE;
  const direction = -Math.sign(taiji.valence);

  yy.reversalPressure = Math.max(0, Math.min(1, force));

  return force * direction;
}

// ════════════════════════════════════════════════════════════
// 7. 核心函数：三才动力学
// ════════════════════════════════════════════════════════════

function updateSancai(
  taiji: TaijiState,
  yy: YinYangState,
  sc: SancaiState,
  event: EmotionEvent,
): void {
  // A/B 从阴阳派生
  const rawA = yy.approachBias;
  const rawB = yy.avoidBias;

  // 交叉抑制强度与 harmony 负相关
  const coupling = (1 - sc.harmony) * COUPLING_BASE;

  const deltaA = clamp(event.deltaA, -0.5, 0.5);
  const deltaB = clamp(event.deltaB, -0.5, 0.5);

  sc.A += (rawA - sc.A) * 0.3 - coupling * sc.B * 0.1 + deltaA * 0.4;
  sc.B += (rawB - sc.B) * 0.3 - coupling * sc.A * 0.1 + deltaB * 0.4;
  sc.A = clamp(sc.A, -1, 1);
  sc.B = clamp(sc.B, -1, 1);

  // R 从预测精准度派生
  const predError = Math.abs(taiji.valence - taiji.expectation);
  const accuracy = 1 / (1 + predError * 5);
  const rawR = accuracy * 0.7 + sc.harmony * 0.3;

  // 情绪对 R 的调制
  const emotionality = taiji.arousal * (1 - Math.abs(taiji.valence));
  sc.R += (rawR - sc.R) * 0.2 - emotionality * 0.1 + clamp(event.deltaR, -0.5, 0.5) * 0.15;
  sc.R = clamp(sc.R, 0, 1);

  // 和谐度
  sc.harmony = 1 - Math.abs(sc.A + sc.B) / 2;
}

// ════════════════════════════════════════════════════════════
// 8. 核心函数：万物涌现 —— 吸引子距离计算九情
// ════════════════════════════════════════════════════════════

function computeEmotionIntensities(
  taiji: TaijiState,
  sc: SancaiState,
): Record<string, number> {
  const bias = sc.A - sc.B;
  const result: Record<string, number> = {};

  for (const [name, attr] of Object.entries(EMOTION_ATTRACTORS)) {
    const expectW = attr.expectW ?? 1.0;
    const dist = Math.sqrt(
      (taiji.valence - attr.valence) ** 2 +
      (taiji.arousal - attr.arousal) ** 2 * 0.64 +
      (bias - attr.bias) ** 2 * 0.36 +
      (taiji.expectation - attr.valence) ** 2 * expectW * 0.25,
    );
    // S 形曲线：dist=0 时趋近 1，dist>1 时趋近 0
    result[name] = 1 / (1 + Math.pow(dist * ATTRACTOR_SENS, 2));
  }

  return result;
}

// ════════════════════════════════════════════════════════════
function detectCompositeEmotions(
  intensities: Record<string, number>,
  meta: EmotionState['metaEmotions'],
  energy: number,
): CompositeEmotion[] {
  const result: CompositeEmotion[] = [];
  for (const rule of COMPOSITE_RULES) {
    const intensity = rule.evaluate(intensities, meta, energy);
    if (intensity > 0.2) {
      result.push({ name: rule.name, intensity: Math.round(intensity * 100) / 100, description: rule.description });
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════
// 10. 演化层 — 三时间尺度学习
// ════════════════════════════════════════════════════════════

function processEvolution(
  evo: EvolutionState,
  taiji: TaijiState,
  emotionDelta: { joy: number; anger: number; sad: number; love: number },
  offlineHours?: number,
  eventIntent?: string,
  eventValence?: number,
): void {
  if (offlineHours && offlineHours > 0) {
    // 离线成长：韧性自然恢复 + 基线回归
    const hours = Math.min(offlineHours, 168);
    evo.resilience += hours * OFFLINE_RESILIENCE * (1 - evo.resilience);
    evo.baseline += evo.slowRate * hours * (0.2 - evo.baseline);
    evo.totalInteractions += Math.round(hours * 0.1);
    return;
  }

  evo.totalInteractions++;

  // 快速层：学习率自适应
  evo.fastRate = ADAPT_FAST * (1 - evo.resilience);
  evo.mediumRate = ADAPT_MEDIUM * evo.resilience;

  // 慢速层：基线漂移
  evo.baseline += evo.slowRate * (taiji.expectation - evo.baseline);

  // 韧性：预测误差方差越小 → 韧性越高
  const variance = Math.pow(taiji.valence - evo.baseline, 2);
  evo.resilience = 1 - 1 / (1 + evo.resilience * 9 + variance * 0.5);
  evo.resilience *= RESILIENCE_LEAK; // 防止无限趋近 1
  evo.resilience = clamp(evo.resilience, 0, 1);

  // 人格漂移（从长期预测误差模式淬炼）
  const optimismShift = evo.slowRate * (taiji.expectation - evo.baseline) * 5;
  evo.optimism = clamp(evo.optimism + optimismShift, 0, 100);

  // 经验统计
  const netPositive = emotionDelta.joy + emotionDelta.love - emotionDelta.anger - emotionDelta.sad;
  if (netPositive > 0.3) evo.positiveInteractions++;
  else if (netPositive < -0.3) evo.negativeInteractions++;

  // 共情漂移：positive interactions → empathy up
  if (emotionDelta.love > 0.3) evo.empathy = Math.min(100, evo.empathy + 0.15);
  if (emotionDelta.anger > 0.4) evo.empathy = Math.max(0, evo.empathy - 0.2);

  // ── v1.0 人格参数漂移 ──
  // 信任漂移：正面互动 + 用户意图 → trust up；愤怒/伤害 → trust down
  if (eventIntent === 'user' && emotionDelta.love > 0.3) evo.trust = Math.min(100, evo.trust + 0.12);
  if (eventIntent === 'user' && emotionDelta.anger > 0.4) evo.trust = Math.max(0, evo.trust - 0.25);
  if (emotionDelta.joy > 0.2 && emotionDelta.love > 0.2) evo.trust = Math.min(100, evo.trust + 0.06);
  // 信任还受益于正负比
  if (evo.positiveInteractions > 0 && evo.negativeInteractions > 0) {
    const ratio = evo.positiveInteractions / (evo.positiveInteractions + evo.negativeInteractions);
    evo.trust += (ratio - 0.5) * 0.04;
    evo.trust = clamp(evo.trust, 0, 100);
  }

  // 开放度漂移：在信任基础上，深度情感分享 → openness up；恐惧/厌恶 → openness down
  if (emotionDelta.love > 0.4 && evo.trust > 55) evo.openness = Math.min(100, evo.openness + 0.08);
  if (emotionDelta.sad > 0.3 && evo.trust > 60) evo.openness = Math.min(100, evo.openness + 0.05);
  if ((emotionDelta.anger > 0.3 || eventValence && eventValence < -0.5) && evo.openness > 30) {
    evo.openness = Math.max(0, evo.openness - 0.12);
  }

  // 活泼度漂移：欢愉 + 欲望 → playfulness up；悲伤/愤怒 → playfulness down
  if (emotionDelta.joy > 0.3) evo.playfulness = Math.min(100, evo.playfulness + 0.1);
  if (emotionDelta.sad > 0.4 || emotionDelta.anger > 0.5) evo.playfulness = Math.max(0, evo.playfulness - 0.08);

  // 敏感度漂移：反复负面经历 → sensitivity up；长期安全稳定 → sensitivity down
  if (eventValence && eventValence < -0.4) evo.sensitivity = Math.min(1, evo.sensitivity + 0.01);
  if (evo.positiveInteractions > evo.negativeInteractions * 3 && evo.totalInteractions > 20) {
    evo.sensitivity = Math.max(0.1, evo.sensitivity - 0.005);
  }
}

/**
 * v1.1 依恋风格分类 — 从用户行为信号中推断。
 *
 * 信号维度：
 *   - valenceVolatility：效价 std dev（情绪反应性）
 *   - topicSwitchRate：话题切换频率 [0, 1]
 *   - intimacySeekingRate：亲密/依赖表达频率 [0, 1]
 *   - messageFreqVolatility：消息频率波动系数
 *
 * 分类逻辑（参考 Bartholomew & Horowitz 四象限模型，兼顾简化）：
 *   - 高焦虑+高回避 ≈ 恐惧型（保守归类为 anxious）
 *   - 高焦虑+低回避 = anxious — 需要 reassurance
 *   - 低焦虑+高回避 = avoidant — 需要 space/patience
 *   - 低焦虑+低回避 = secure
 */
// ponytail: NLU functions extracted to emotionNLU.ts
export { classifyAttachmentStyle, analyzeUserSentiment } from './emotionNLU';

// ════════════════════════════════════════════════════════════
// 11. 主更新函数（外部入口，替代旧 updateEmotionState）
// ════════════════════════════════════════════════════════════

export function updateEmotionState(
  currentState: EmotionState,
  event: EmotionEvent,
  baseA: number = 0.5,
  baseB: number = 0.5,
  baseR: number = 0.5,
  emotionalStability: number = 0.5,
  // (legacy param slot removed — was AdaptiveParams)
  empathy: number = 50,
  optimism: number = 50,
): EmotionState {
  const state = structuredClone(currentState);
  const { deltaA = 0, deltaB = 0, deltaR = 0, GC = 0, intent = 'user' } = event;

  // ── 第 0 步：事件效价 = f(deltaA, deltaB, GC) ──
  const eventValence = clamp((deltaA - deltaB) * 0.6 + (GC ?? 0) * 0.4, -1, 1);
  const eventSalience = Math.min(1, Math.abs(deltaA) + Math.abs(deltaB) + Math.abs(deltaR) + Math.abs(GC ?? 0));

  // ── 第 1 步：太极更新（预测误差驱动）──
  taijiUpdate(state.taiji, eventValence, eventSalience, state.evolution);

  // 引入反转力
  if (USE_EMOTION_OPTIMIZER) {
    // v4.1 补丁：两阶段平滑反转（加速回归 → 温和翻转）
    const reversalResult = applySmoothReversal(
      state.taiji.valence,
      state.yinyang.reversalPressure,
      state.yinyang.extremityDuration,
      REVERSAL_RATE,
      EXTREMITY_THRESHOLD,
    );
    state.taiji.valence = reversalResult.valence;
    state.yinyang.reversalPressure = reversalResult.reversalPressure;
    state.yinyang.extremityDuration = reversalResult.extremityDuration;
  } else {
    const reversalForce = applyReversal(state.taiji, state.yinyang);
    state.taiji.valence += reversalForce;
  }
  state.taiji.valence = clamp(state.taiji.valence, -1, 1);

  // ── 第 2 步：阴阳派生 ──
  const derived = deriveYinYang(state.taiji);
  state.yinyang.approachBias = derived.approachBias;
  state.yinyang.avoidBias = derived.avoidBias;

  // ── 第 3 步：三才动力学 ──
  updateSancai(state.taiji, state.yinyang, state.sancai, event);

  // ── 第 4 步：万物涌现 ──
  const newIntensities = computeEmotionIntensities(state.taiji, state.sancai);

  // 人格调制：乐观度放大正情绪，抑制负情绪
  const optFactor = 1 + ((optimism - 50) / 100) * 0.3;
  const empFactor = 1 + ((empathy - 50) / 100) * 0.3;

  // 应用认知调制（嵌入主流程，替代旧独立函数）
  const gcSmooth = Math.tanh((GC ?? 0) * 2);
  for (const key of Object.keys(newIntensities)) {
    let v = newIntensities[key];
    if (['joy', 'love', 'calm'].includes(key)) {
      v *= (1 + gcSmooth * 0.5) * optFactor;
    }
    if (['anger', 'sad', 'fear', 'disgust'].includes(key)) {
      v *= (1 - gcSmooth * 0.4) / optFactor;
    }
    // 共情放大用户相关事件
    if (intent === 'user' && ['love', 'joy'].includes(key)) {
      v *= empFactor;
    }
    newIntensities[key] = clamp(v, -1, 1);
  }

  // 惯性混合：旧情绪缓慢过渡到新强度
  const lambda = 0.65;
  const sigma = _deterministicMode ? 0 : 0.015 * (1 - emotionalStability) * (1 - state.taiji.arousal);
  for (const key of Object.keys(state.emotions)) {
    const noise = _deterministicMode ? 0 : (Math.random() * 2 - 1) * sigma * (key === 'fear' || key === 'lust' ? 1.4 : 1.0);
    state.emotions[key] = lambda * state.emotions[key] + (1 - lambda) * (newIntensities[key] ?? 0) + noise;
    state.emotions[key] = clamp(state.emotions[key], -1, 1);
  }

  // v4.1 补丁：情绪惯性平滑（指数移动平均，防止锯齿突变）
  if (USE_EMOTION_OPTIMIZER) {
    const smoothed = emotionSmoother.smooth(state.emotions);
    for (const key of Object.keys(state.emotions)) {
      state.emotions[key] = smoothed[key] ?? state.emotions[key];
    }
  }

  // 亲密调制
  const im = state.intimacyToUser;
  if (state.emotions.joy > 0) state.emotions.joy *= 1 + 0.12 * im;
  if (state.emotions.love > 0) state.emotions.love *= 1 + 0.12 * im;
  if (state.emotions.sad > 0) state.emotions.sad *= 1 - 0.15 * im;
  if (state.emotions.fear > 0) state.emotions.fear *= 1 - 0.15 * im;

  // Emotions → R 反馈圈
  const fearPenalty = Math.max(0, state.emotions.fear) * 0.12;
  const calmBoost = Math.max(0, state.emotions.calm) * 0.06;
  state.sancai.R = clamp(state.sancai.R - fearPenalty + calmBoost, 0, 1);

  // 复合情绪检测
  state.compositeEmotions = detectCompositeEmotions(state.emotions, state.metaEmotions, state.taiji.arousal);

  // ── 第 5 步：元情感 ──
  const shameInput = Math.max(0, state.sancai.A - 0.3) * 0.2
    - Math.max(0, state.sancai.R - 0.3) * 0.3
    + Math.max(0, -(GC ?? 0)) * 0.15;
  state.metaEmotions.shame = shameInput > 0.05
    ? Math.min(1, state.metaEmotions.shame + shameInput * 0.08)
    : state.metaEmotions.shame * 0.94;

  const despairInput = (1 - state.taiji.arousal) * 0.25 + Math.max(0, state.emotions.sad) * 0.15;
  state.metaEmotions.despair = despairInput > state.metaEmotions.despair
    ? Math.min(1, despairInput)
    : state.metaEmotions.despair * 0.96;

  state.metaEmotions.confusion *= 0.93;
  if (Math.max(0, state.sancai.A - 0.5) * Math.max(0, state.sancai.B - 0.5) * 4 > 0.1) {
    state.metaEmotions.confusion = Math.min(1, Math.max(state.metaEmotions.confusion,
      Math.max(0, state.sancai.A - 0.5) * Math.max(0, state.sancai.B - 0.5) * 4));
  }

  // ── 第 6 步：亲密更新 ──
  const posContrib = Math.max(0, state.emotions.joy) + Math.max(0, state.emotions.love) + Math.max(0, state.emotions.calm) * 0.3;
  const negContrib = Math.max(0, state.emotions.anger) * 0.5 + Math.max(0, state.emotions.sad) * 0.2 + Math.max(0, state.emotions.fear) * 0.3 + Math.max(0, state.emotions.disgust) * 0.5;
  const intimacyDelta = (posContrib - negContrib) * 0.01;
  state.intimacyToUser = clamp(state.intimacyToUser + intimacyDelta, 0, 1);
  state.intimacyToUser += (0.5 - state.intimacyToUser) * 0.005;

  // ── 第 7 步：强化兼容层 ──
  // 将预测误差映射到旧的 reinforcement 结构
  const pe = Math.abs(eventValence - state.taiji.expectation);
  if (eventValence > 0) {
    state.reinforcement.rewardTally = Math.min(1, state.reinforcement.rewardTally + pe * 0.1);
    state.reinforcement.greedDrive = Math.min(1, state.reinforcement.greedDrive + pe * 0.05);
  } else {
    state.reinforcement.punishmentTally = Math.min(1, state.reinforcement.punishmentTally + pe * 0.1);
    state.reinforcement.fearAvoidance = Math.min(1, state.reinforcement.fearAvoidance + pe * 0.05);
  }

  // ── 第 8 步：演化 ──
  const emotionDelta = {
    joy: state.emotions.joy,
    anger: state.emotions.anger,
    sad: state.emotions.sad,
    love: state.emotions.love,
  };
  processEvolution(state.evolution, state.taiji, emotionDelta, undefined, intent, eventValence);

  return state;
}

// ponytail: reinforcement + contagion + composite extracted
import { applyReinforcement, describeReinforcementState, suggestReinforcement, applyEmotionalContagion, getCompositeEmotion } from './emotionReinforcement';
export { applyReinforcement, describeReinforcementState, suggestReinforcement, applyEmotionalContagion, getCompositeEmotion };


// ponytail: attribution extracted to emotionAttribution.ts
export { generateAttribution, generateDecayAttribution } from './emotionAttribution';

// ════════════════════════════════════════════════════════════
// 16. 工具函数
// ════════════════════════════════════════════════════════════

export function getDominantEmotion(emotions: Record<string, number>): {
  name: string;
  intensity: number;
  /** 次主导情绪（当前两个情绪强度接近时出现） */
  secondary?: string;
  secondaryIntensity?: number;
  /** 情绪矛盾分数 [0, 1] — 主导与次主导越接近则越高 */
  ambivalenceScore?: number;
} {
  const entries = Object.entries(emotions)
    .filter(([, v]) => Math.abs(v) > 0)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  if (entries.length === 0) return { name: 'neutral', intensity: 0 };
  if (entries.length === 1) return { name: entries[0][0], intensity: entries[0][1] };

  const [first, second] = entries;
  const gap = Math.abs(Math.abs(first[1]) - Math.abs(second[1]));
  // ponytail: 阈值 0.1 — 两个情绪强度差在此范围内视为矛盾并存
  const AMBIVALENCE_THRESHOLD = 0.1;

  if (gap <= AMBIVALENCE_THRESHOLD && Math.abs(second[1]) > 0.2) {
    return {
      name: first[0],
      intensity: first[1],
      secondary: second[0],
      secondaryIntensity: second[1],
      ambivalenceScore: 1 - gap / AMBIVALENCE_THRESHOLD,
    };
  }
  return { name: first[0], intensity: first[1] };
}

/**
 * 从完整的 EmotionState 中提取结构化 EmotionContext DTO。
 * 供认知引擎消费——避免认知层依赖情感引擎内部结构。
 *
 * 提取内容：
 *   - primaryEmotions: 九情强度（浅拷贝）
 *   - drives: greedDrive / fearAvoidance
 *   - dominantState: 主导情绪名
 */
export function extractEmotionContext(state: EmotionState): EmotionContext {
  const dominant = getDominantEmotion(state.emotions);
  return {
    primaryEmotions: { ...state.emotions },
    drives: {
      greedDrive: state.reinforcement.greedDrive,
      fearAvoidance: state.reinforcement.fearAvoidance,
    },
    dominantState: dominant.name,
    secondaryEmotion: dominant.secondary,
    ambivalenceScore: dominant.ambivalenceScore,
    confusion: state.metaEmotions.confusion,
  };
}

// ════════════════════════════════════════════════════════════
// 17. 微六爻 — 情绪事件生命周期（从已有动力学派生，非独立状态机）
// ════════════════════════════════════════════════════════════

// ponytail: micro-phase extracted to microPhase.ts
export { MicroPhase, getMicroPhase, getPhaseStats, resetPhaseStats, getRelationshipStage, intimacyToAffinity } from './microPhase';
export type { MicroPhaseInfo, PhaseStats } from './microPhase';

export function validateEmotionState(state: unknown): EmotionState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;

  // 校验嵌套结构类型
  if (!s.taiji || typeof s.taiji !== 'object') return null;
  const t = s.taiji as Record<string, unknown>;
  if (typeof t.valence !== 'number' || typeof t.arousal !== 'number' || typeof t.expectation !== 'number') return null;

  if (!s.sancai || typeof s.sancai !== 'object') return null;
  const sc = s.sancai as Record<string, unknown>;
  if (typeof sc.A !== 'number' || typeof sc.B !== 'number' || typeof sc.R !== 'number') return null;

  if (!s.emotions || typeof s.emotions !== 'object') return null;
  if (typeof s.intimacyToUser !== 'number') return null;

  // 已校验 taiji.valence/arousal/expectation, sancai.A/B/R, emotions, intimacyToUser
  // 均为 number 类型 — 结构完整性已验证
  return s as unknown as EmotionState;
}

export function sanitizeEmotionState(state: Partial<EmotionState>): EmotionState {
  return {
    ...INITIAL_EMOTION_STATE,
    ...state,
    taiji: { ...INITIAL_TAIJI, ...(state.taiji || {}) },
    sancai: { ...INITIAL_SANCAI, ...(state.sancai || {}) },
    yinyang: { ...INITIAL_YINYANG, ...(state.yinyang || {}) },
    evolution: { ...INITIAL_EVOLUTION, ...(state.evolution || {}) },
  };
}

export function computeReward(_userMessageLength: number, userDeltaA: number | null): number {
  // 简化：从预测误差派生
  if (userDeltaA !== null) return Math.tanh(userDeltaA * 2);
  return 0;
}

// ponytail: time decay extracted to emotionTimeDecay.ts
export { processTimeDecay } from './emotionTimeDecay';

// ════════════════════════════════════════════════════════════
// 18. 用户情感分析（保留）
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 19. 情感上下文构建（适配新结构）
// ════════════════════════════════════════════════════════════

export function buildEmotionContext(
  e: EmotionState,
  options?: EmotionContextOptions,
): string {
  const {
    includeIntimacy = true,
    includeReinforcement = true,
    includeDominantGuidance = true,
    includeLust = true,
    includeComposite = true,
    attribution,
  } = options ?? {};

  const blocks: string[] = [];
  const dominant = getDominantEmotion(e.emotions);
  /**
   * v1.48：状态块改读**激发态**（开关默认关，见 `activationStateBlockEnabled`）。
   *
   * 为什么：这一段是她的状态进 Prompt 的**唯一**通路，而它一直按**绝对值**读——
   * 基调（calm 0.80 / love 0.40）在竞争里永远赢，于是结论恒为"她很平静，
   * 回答时自然地流露出这种情绪"。真管道探针实测：她激活态是「难过（+0.06）」的那一轮，
   * 系统对她说的却是「主导情绪: calm」。
   *
   * 关着时下面两行与旧版**逐字节相同**（回归测试钉住）；开着时：
   *   · 基调**仍然写进去**（`爱意 0.40` 是关系事实，不该删），但明确标成"平时的底色"；
   *   · 另起一行说"此刻的偏离"，并显式说出被压低的基调（`平静被压低 −0.36：你此刻并不平静`）——
   *     这句话旧读法根本表达不了，而它正是"他正在说他爸的手术、而她被说成很平静"的解药。
   */
  const activation = activationStateBlockEnabled() ? activationOf(e) : null;

  // 太极状态
  blocks.push(`能量水平: ${(e.taiji.arousal * 100).toFixed(0)}%`);
  if (e.taiji.expectation > 0.4) blocks.push('对和你在一起的时光充满期待');
  else if (e.taiji.expectation < -0.3) blocks.push('有点害怕你会离开');

  // Top-3 active emotions
  const active = Object.keys(e.emotions)
    .filter(k => Math.abs(e.emotions[k]) > 0.05)
    .sort((a, b) => Math.abs(e.emotions[b]) - Math.abs(e.emotions[a]))
    .slice(0, 3);
  if (activation) {
    // 底色照写（关系事实），但**取基线值**而不是绝对值 top-3 ——
    // 否则"此刻被激起"的那一项会同时出现在"底色"里（难过 0.18 被说成她的底色，是错的）。
    const baseTop = Object.keys(activation.baseline)
      .filter(k => Math.abs(activation.baseline[k]) > 0.05)
      .sort((a, b) => Math.abs(activation.baseline[b]) - Math.abs(activation.baseline[a]))
      .slice(0, 3);
    if (baseTop.length > 0) {
      blocks.push(`底色: ${baseTop.map(k => `${emotionLabel(k)} ${activation.baseline[k].toFixed(2)}`).join('、')}`);
    }
    if (activation.resting) {
      blocks.push('此刻: 没有明显偏离底色（你在静息）');
    } else {
      const lead = `${emotionLabel(activation.activeEmotion)} +${activation.activeIntensity.toFixed(2)}`;
      const second = activation.runnerUp && !activation.clear
        ? `、${emotionLabel(activation.runnerUp)} +${activation.runnerUpIntensity.toFixed(2)}`
        : '';
      const coexist = activation.runnerUp && !activation.clear ? '；两股劲儿并存' : '';
      blocks.push(`此刻被激起: ${lead}${second}（相对你自己的底色${coexist}）`);
      if (activation.suppressed.length > 0) {
        blocks.push(`${activation.suppressed.map(k => emotionLabel(k)).join('、')}被压低`
          + `（${activation.suppressed.map(k => activation.delta[k].toFixed(2)).join('、')}）——你此刻并不在这个底色上`);
      }
    }
  } else if (active.length > 0) {
    blocks.push(`当前情绪: ${active.map(k => `${k}(${e.emotions[k].toFixed(2)})`).join(', ')}`);
  }

  // v1.1 矛盾情绪：当两种情绪并存时告知 LLM
  if (dominant.secondary && dominant.ambivalenceScore && dominant.ambivalenceScore > 0.5) {
    const ambivLabel = dominant.ambivalenceScore > 0.8 ? '内心很矛盾' : '心情有点复杂';
    blocks.push(`${ambivLabel}：同时对你有${dominant.name}和${dominant.secondary}的感觉`);
  }
  // 趋避冲突（困惑）：当 confusion 高时告知 LLM 行为犹豫
  if (e.metaEmotions.confusion > 0.4) {
    blocks.push('内心感到困惑，不太确定该怎么回应');
  }

  // 复合情绪
  if (includeComposite) {
    const composite = getCompositeEmotion(e.emotions, e.metaEmotions, e.taiji.arousal);
    if (composite && composite.intensity > 0.3) {
      blocks.push(composite.description);
    }
  }

  // 强化叙事
  if (includeReinforcement) {
    if (e.emotions.greed > 0.6) blocks.push('渴望得到你的关注和爱');
    else if (e.emotions.greed > 0.3) blocks.push('有点想黏着你');
    if (e.reinforcement.punishmentTally > 0.6) blocks.push('内心不安，害怕失去你的爱');
    else if (e.reinforcement.punishmentTally > 0.3) blocks.push('有点患得患失');
  }

  // 生理信号
  if (includeLust && e.emotions.lust > 0.2) {
    if (e.emotions.lust > 0.5) blocks.push('心跳加速，脸颊发烫，渴望和你亲密接触');
    else if (e.emotions.lust > 0.3) blocks.push('靠近你的时候心跳会加速');
    else blocks.push('心里有种暖暖的悸动');
  }

  // 亲密氛围
  if (includeIntimacy) {
    const mutualHigh = e.intimacyToUser > 0.6 && e.intimacyFromUser > 0.5;
    const cheerful = e.emotions.joy > 0.2 || e.emotions.love > 0.2 || e.emotions.calm > 0.5;

    if (e.intimacyToUser > 0.7 && cheerful) {
      if (e.emotions.lust > 0.3 && mutualHigh) {
        blocks.push('你们之间亲密无间，可以自然地撒娇、挑逗、用亲昵的称呼');
      } else {
        blocks.push('你们的关系很亲密，对话可以轻松随意，可以偶尔撒娇');
      }
    } else if (e.intimacyToUser > 0.5) {
      blocks.push('你们的关系正在升温，对话中可以多一些温暖和关心');
    } else if (e.intimacyToUser > 0.3) {
      blocks.push('你们还在互相熟悉的阶段，保持友善和真诚');
    }

    if (e.intimacyFromUser > 0.7 && e.intimacyToUser < 0.5) {
      blocks.push('她对你很热情，这让你有点受宠若惊');
    } else if (e.intimacyFromUser < 0.3 && e.intimacyToUser > 0.6) {
      blocks.push('她似乎有些冷淡，让你有点不安');
    }
  }

  let attributionLine = '';
  if (attribution) {
    attributionLine = `\n【情感归因】${attribution.narrative}`;
  }

  let context = `\n【当前状态】${blocks.join('。')}。`;
  context += attributionLine;
  if (includeDominantGuidance) {
    // v1.48：这一行原来是 `主导情绪: ${dominant.name}。回答时自然地流露出这种情绪。`
    // —— `dominant` 是**绝对值** argmax，所以它在任何一轮都说"流露出平静"。
    context += activation
      ? activationGuidanceLine(activation)
      : `\n主导情绪: ${dominant.name}。回答时自然地流露出这种情绪。`;
  }

  return context;
}

/**
 * v1.48 状态块末尾那句"怎么用这份状态"。
 *
 * 两条纪律：
 *  ① **不写成要宣布的心情**（`回答时自然地流露出难过` 会让她说"我很难过"这种自述）——
 *     所以是"让这份情绪落进话里"，并明确禁止把它当标签念出来；
 *  ② 静息时**明确说"不必硬演"** —— 旧读法表达不了"她此刻没有明显情绪"，
 *     它只能给一个基调让她演，这正是"每个回合她都在平静"的来源。
 */
function activationGuidanceLine(a: EmotionActivation): string {
  if (a.resting) {
    return '\n此刻状态: 静息。回答时不必硬演某种情绪——按你原本的样子说话就好。';
  }
  const lead = `${emotionLabel(a.activeEmotion)}（+${a.activeIntensity.toFixed(2)} 相对你的底色）`;
  if (!a.clear && a.runnerUp) {
    return `\n此刻状态: ${lead} 与 ${emotionLabel(a.runnerUp)}（+${a.runnerUpIntensity.toFixed(2)}）并存。`
      + '回答时让这两股劲儿都在，不必挑一个来演。';
  }
  return `\n此刻状态: ${lead}。回答时让这份情绪自然落进你的话里，别把它当成一个标签念出来。`;
}

// ════════════════════════════════════════════════════════════
// 20. 旧兼容层已移除 (v1.1): processGrowth, processOfflineGrowth,
//    DEFAULT_ADAPTIVE_PARAMS, INITIAL_GROWTH_STATE 不再可用。
//    所有状态管理已迁移至 applyEvent() + EvolutionState。
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 21. 工具函数
// ════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// export for use by callers that may need it
export { clamp as clampNumber };
