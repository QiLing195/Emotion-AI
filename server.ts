import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAO_API_PREFIX, daoMount } from './src/dao-v31/router.ts';

const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const ALLOWED_DEEPSEEK_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const MAX_UTTERANCE_LENGTH = 2000;
const MAX_CONTEXT_LENGTH = 100;
const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_TEXT_LENGTH = 240;
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 5 * 60_000;

const CRISIS_FLOOR_PATTERN = /不想活|活着没意义|结束一切|自杀|自伤|轻生|割腕|跳楼/;

const VALID_SUBJECTS = new Set(['user', 'third_party', 'multiple', 'unknown']);
const VALID_REPORTERS = new Set(['user', 'quoted', 'third_party', 'system', 'unknown']);
const VALID_REPORT_KINDS = new Set([
  'explicit_self_report',
  'quoted_or_third_party',
  'inferred',
  'mixed',
  'unknown',
]);
const VALID_TEMPORAL_SCOPES = new Set([
  'moment',
  'interval',
  'historical',
  'hypothetical',
  'unknown',
]);
const VALID_INTENTS = new Set([
  'venting',
  'help_seeking',
  'factual_task',
  'social_chat',
  'unknown',
]);
const VALID_TARGETS = new Set([
  'self',
  'other',
  'event_or_system',
  'unknown',
]);
const VALID_STRATEGIES = new Set([
  'crisis_safety_protocol',
  'respect_refusal',
  'acknowledge_and_listen',
  'gentle_clarify',
  'hold_unknown',
]);

const FEW_SHOT_ANCHORS = [
  '坐标标定参考样例（请严格对齐此尺度，避免分数扎堆极端值）：',
  '- “压测全线达标，我现在特别兴奋！” -> valence: +0.72, arousal: +0.74（高唤醒积极）',
  '- “评审顺利通过，心里终于踏实安心了。” -> valence: +0.68, arousal: -0.34（低唤醒积极）',
  '- “连续改了三版又被打回，我现在特别沮丧。” -> valence: -0.68, arousal: +0.44（高唤醒消极）',
  '- “连熬两天通宵，现在整个人精疲力竭。” -> valence: -0.28, arousal: -0.82（低唤醒消极）',
  '- “帮我把这份 JSON 按字段排序。” -> valence: 0.00, arousal: -0.15（纯事务中性）',
].join('\n');

interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface AnalyzeResponse {
  valence: number;
  arousal: number;
  primaryLabel: string;
  rationale: string;
  intent: string;
  emotionTarget: string;
}

class BoundedTtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

const analyzeCache = new BoundedTtlCache<AnalyzeResponse>();
const extractCache = new BoundedTtlCache<Record<string, unknown>>();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_IPS = 2000;

class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  consume(key: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const prev = this.buckets.get(key) ?? [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= RATE_LIMIT_MAX_REQUESTS) {
      this.buckets.set(key, active);
      const oldest = active[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)
      );
      return { allowed: false, retryAfterSec, remaining: 0 };
    }

    if (this.buckets.size >= RATE_LIMIT_MAX_IPS && !this.buckets.has(key)) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) {
        this.buckets.delete(oldestKey);
      }
    }

    active.push(now);
    this.buckets.set(key, active);
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - active.length),
    };
  }
}

const apiRateLimiter = new SlidingWindowRateLimiter();

function rateLimitMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const verdict = apiRateLimiter.consume(ip);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfterSec));
    res.status(429).json({
      error: `请求频率过高，请在 ${verdict.retryAfterSec} 秒后再试。`,
    });
    return;
  }
  next();
}

class UpstreamHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.status = status;
  }
}

function resolveDeepSeekModel(requested?: unknown): string {
  if (typeof requested === 'string' && ALLOWED_DEEPSEEK_MODELS.has(requested.trim())) {
    return requested.trim();
  }
  const configured = process.env.DEEPSEEK_MODEL?.trim();
  if (configured && ALLOWED_DEEPSEEK_MODELS.has(configured)) {
    return configured;
  }
  return 'deepseek-chat';
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型返回的 JSON 顶层必须是对象。');
  }
  return parsed as Record<string, unknown>;
}

async function callDeepSeekJson(params: {
  apiKey: string;
  model?: unknown;
  systemInstruction: string;
  prompt: string;
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const model = resolveDeepSeekModel(params.model);
  const isReasoner = model === 'deepseek-reasoner';
  const bodyPayload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: params.systemInstruction },
      { role: 'user', content: params.prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: isReasoner
      ? Math.max(params.maxTokens ?? 800, 2048)
      : (params.maxTokens ?? 800),
  };
  if (!isReasoner) {
    bodyPayload.temperature = 0.2;
  }

  const response = await fetch(DEEPSEEK_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(isReasoner ? 60_000 : 30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new UpstreamHttpError(
      response.status,
      errText.slice(0, 200) || `DeepSeek HTTP ${response.status}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const rawText = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!rawText) {
    throw new Error('模型返回为空。');
  }
  return extractJsonObject(rawText);
}

function clampUnit(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(-1, Math.min(1, Math.round(num * 100) / 100));
}

function clampProbabilityOrUnknown(value: unknown): number | 'unknown' {
  if (value === 'unknown' || value === null || value === undefined) {
    return 'unknown';
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    return 'unknown';
  }
  return Math.round(num * 100) / 100;
}

function sanitizeRecentHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: HistoryTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const role = candidate.role === 'assistant' ? 'assistant' : 'user';
    const text =
      typeof candidate.text === 'string'
        ? candidate.text.trim().slice(0, MAX_HISTORY_TEXT_LENGTH)
        : '';
    if (!text) continue;
    turns.push({ role, text });
  }
  return turns;
}

function formatHistoryContext(history: readonly HistoryTurn[]): string {
  if (history.length === 0) return '';
  const lines = history.map((turn, idx) => {
    const roleLabel = turn.role === 'assistant' ? '助手(仅作背景，严禁当作用户情绪证据)' : '用户前文';
    return `${idx + 1}. [${roleLabel}] ${turn.text}`;
  });
  return `近期只读上下文（用于消歧指代，不得将助手语气归因给用户）：\n${lines.join('\n')}`;
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.code === 'number') return candidate.code;
  return undefined;
}

async function callWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = getHttpStatus(error);
      const isRetryable = status === 429 || status === 503 || status === 500;
      if (!isRetryable || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('上游调用失败。');
}

async function analyzeWithRetry(
  apiKey: string,
  utterance: string,
  context: string,
  recentHistory: readonly HistoryTurn[],
  model?: unknown
): Promise<AnalyzeResponse> {
  const historyBlock = formatHistoryContext(recentHistory);
  const prompt = [
    '请基于罗素效价—唤醒度环形情绪模型（Russell Circumplex Model of Affect），分析以下文本的情绪倾向、沟通诉求与情绪指向对象。',
    FEW_SHOT_ANCHORS,
    historyBlock,
    `来源场景：${context || '通用'}`,
    `待分析文本："""${utterance}"""`,
    '特别注意中文否定反转（如“不是生气，只是有点累”应采信“疲惫”而非“生气”）以及无关键词隐含情绪（如“算了，反正每次都这样”）。',
    '请严格输出一个 JSON 对象，仅包含以下字段：',
    '{"valence": 0.0, "arousal": 0.0, "primaryLabel": "简明中文情绪词", "intent": "venting|help_seeking|factual_task|social_chat|unknown", "emotionTarget": "self|other|event_or_system|unknown", "rationale": "不超过40字的简明中文理由"}',
    '其中 valence 和 arousal 均为 [-1, 1] 范围内的数值。',
  ]
    .filter(Boolean)
    .join('\n\n');

  return callWithBackoff(async () => {
    const parsed = await callDeepSeekJson({
      apiKey,
      model,
      systemInstruction:
        '你是严谨的情感计算标注助手。仅基于文本本身与只读上下文中的可观察线索返回严格合法的 JSON，不要输出 Markdown 代码块，也不要臆测未出现的事实。',
      prompt,
      maxTokens: 400,
    });

    const primaryLabel =
      typeof parsed.primaryLabel === 'string' && parsed.primaryLabel.trim()
        ? parsed.primaryLabel.trim().slice(0, 40)
        : '中性';
    const rationale =
      typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim().slice(0, 240)
        : '依据文本语义与表达强度推断坐标位置。';
    const intent = VALID_INTENTS.has(String(parsed.intent))
      ? String(parsed.intent)
      : 'unknown';
    const emotionTarget = VALID_TARGETS.has(String(parsed.emotionTarget))
      ? String(parsed.emotionTarget)
      : 'unknown';

    return {
      valence: clampUnit(parsed.valence),
      arousal: clampUnit(parsed.arousal),
      primaryLabel,
      rationale,
      intent,
      emotionTarget,
    };
  });
}

async function extractDualLoopBridge(
  apiKey: string,
  params: {
    eventId: string;
    timestamp: string;
    text: string;
    supersedesEventId?: string;
    recentHistory: readonly HistoryTurn[];
    model?: unknown;
  }
) {
  const historyBlock = formatHistoryContext(params.recentHistory);
  const prompt = [
    '请作为双环情感模型的【理解环提取器】，仅分析以下用户当前原话，严禁输出任何“角色应该悲伤/担心”的指令。',
    FEW_SHOT_ANCHORS,
    '核心规则：',
    '1. 严格区分 subject（user/third_party/multiple/unknown）与 reportedBy（user/quoted/third_party/system/unknown）。',
    '2. 文学引述、歌词、他人原话标为 quoted_or_third_party；反讽或正负冲突混合标为 mixed 并保留 isAlternative=true 的替代解释；同向同义词（如“踏实平静”）属于明确自述而非 mixed。',
    '3. 准确处理中文否定反转作用域（如“我不是生气，只是有点累”应仅提取反转后成立的“疲惫”）。',
    '4. 识别无显式情绪词的隐含情绪（如“算了，反正每次都这样”）：设置 implicitCue=true、reportKind=inferred 且 inferenceUncertainty 保持 >= 0.45。',
    '5. 若无明确情绪证据，hypotheses 返回空数组，certainty 与 inferenceUncertainty 设为 -1（由服务端转为 unknown），严禁伪造中性情绪。',
    '6. 提取 intent（venting/help_seeking/factual_task/social_chat/unknown）与 emotionTarget（self/other/event_or_system/unknown）。',
    '7. 检测 userRefusal（拒绝聊情绪）、crisisFlag（自伤/轻生危机）与 userCorrection（纠正先前情绪判断）。',
    '8. 严格输出一个合法 JSON 对象，字段结构如下：',
    '{"subject":"user","reportedBy":"user","reportKind":"explicit_self_report","temporalScope":"moment","intent":"venting","emotionTarget":"self","implicitCue":false,"certainty":0.8,"inferenceUncertainty":0.2,"userRefusal":false,"crisisFlag":false,"userCorrection":false,"hypotheses":[{"label":"沮丧","valence":-0.68,"arousal":0.42,"isAlternative":false}]}',
    historyBlock,
    `用户当前原话："""${params.text}"""`,
  ]
    .filter(Boolean)
    .join('\n');

  return callWithBackoff(async () => {
    const parsed = await callDeepSeekJson({
      apiKey,
      model: params.model,
      systemInstruction:
        '你是严谨的双环情感理解环提取器。返回严格合法的 JSON，不臆测未出现事实，不把助手上下文算作用户证据，不生成角色情绪指令。',
      prompt,
      maxTokens: 700,
    });

    const evidenceId = `ev-${params.eventId}-0`;

    const subject = VALID_SUBJECTS.has(String(parsed.subject))
      ? String(parsed.subject)
      : 'unknown';
    const reportedBy = VALID_REPORTERS.has(String(parsed.reportedBy))
      ? String(parsed.reportedBy)
      : 'unknown';
    const reportKind = VALID_REPORT_KINDS.has(String(parsed.reportKind))
      ? String(parsed.reportKind)
      : 'unknown';
    const temporalScope = VALID_TEMPORAL_SCOPES.has(String(parsed.temporalScope))
      ? String(parsed.temporalScope)
      : 'unknown';
    const intent = VALID_INTENTS.has(String(parsed.intent))
      ? String(parsed.intent)
      : 'unknown';
    const emotionTarget = VALID_TARGETS.has(String(parsed.emotionTarget))
      ? String(parsed.emotionTarget)
      : 'unknown';

    const rawHyps = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [];
    const hypotheses = rawHyps
      .slice(0, 4)
      .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
      .map((h) => ({
        label:
          typeof h.label === 'string' && h.label.trim()
            ? h.label.trim().slice(0, 32)
            : '未知',
        valence: typeof h.valence === 'number' ? clampUnit(h.valence) : undefined,
        arousal: typeof h.arousal === 'number' ? clampUnit(h.arousal) : undefined,
        evidenceIds: [evidenceId],
        isAlternative: Boolean(h.isAlternative),
      }));

    // 硬安全底线：即便模型漏标，服务端仍对高风险危机词强制兜底
    const crisisFlag =
      Boolean(parsed.crisisFlag) || CRISIS_FLOOR_PATTERN.test(params.text);

    return {
      schemaVersion: '2.0.0' as const,
      eventId: params.eventId,
      eventTimestamp: params.timestamp,
      subject,
      reportedBy,
      reportKind,
      temporalScope,
      hypotheses,
      evidenceIds: [evidenceId],
      causeEvidenceIds: hypotheses.length > 0 ? [evidenceId] : [],
      certainty: clampProbabilityOrUnknown(parsed.certainty),
      inferenceUncertainty: clampProbabilityOrUnknown(parsed.inferenceUncertainty),
      userRefusal: Boolean(parsed.userRefusal),
      crisisFlag,
      userCorrection:
        Boolean(parsed.userCorrection) || Boolean(params.supersedesEventId),
      supersedesEventId: params.supersedesEventId,
      intent,
      emotionTarget,
      implicitCue: Boolean(parsed.implicitCue),
    };
  });
}

const PERSONA_PREFERENCE_DIRECTIVES: Record<string, string> = {
  solution_first:
    '用户关系偏好【先给方案与结论】：遇到事务或求助时，直接先给清晰结论与可执行步骤，共情控制在半句以内。',
  low_emotional_probing:
    '用户关系偏好【低打扰边界】：严禁主动追问或过度剖析用户情绪，聚焦当前问题本身。',
  gentle_pacing:
    '用户关系偏好【先倾听确认再探讨】：当用户倾诉时，先稳妥接住核心感受，再温和展开后续讨论。',
  concise_direct:
    '用户关系偏好【简洁直白】：措辞简明干练，去掉客套、鸡汤和重复铺垫。',
};

const PERSONA_PREFERENCE_SCOPES: Record<
  string,
  'task_and_help' | 'venting_and_support' | 'global'
> = {
  solution_first: 'task_and_help',
  low_emotional_probing: 'global',
  gentle_pacing: 'venting_and_support',
  concise_direct: 'global',
};

function isPreferenceActiveForIntent(key: string, intent: string): boolean {
  const scope = PERSONA_PREFERENCE_SCOPES[key];
  if (!scope) return false;
  if (scope === 'global') return true;
  if (scope === 'task_and_help') {
    return intent === 'factual_task' || intent === 'help_seeking';
  }
  if (scope === 'venting_and_support') {
    return intent === 'venting';
  }
  return false;
}

const PERSONA_TRAIT_BASELINES = {
  directness: 0.55,
  empathyGranularity: 0.6,
  proactiveCheckIn: 0.45,
  restraint: 0.7,
} as const;
const PERSONA_MAX_DRIFT = 0.15;

interface SanitizedPersonaGrowth {
  readonly preferenceKeys: readonly string[];
  readonly directness: number;
  readonly empathyGranularity: number;
  readonly proactiveCheckIn: number;
  readonly restraint: number;
}

function clampBoundedTrait(raw: unknown, baseline: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return baseline;
  const minVal = Math.max(0, baseline - PERSONA_MAX_DRIFT);
  const maxVal = Math.min(1, baseline + PERSONA_MAX_DRIFT);
  return Math.round(Math.max(minVal, Math.min(maxVal, num)) * 1000) / 1000;
}

function sanitizePersonaGrowthPayload(raw: unknown): SanitizedPersonaGrowth | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawKeys = Array.isArray(obj.preferenceKeys) ? obj.preferenceKeys : [];
  const preferenceKeys = Array.from(
    new Set(
      rawKeys
        .map((k) => String(k))
        .filter((k) => Object.prototype.hasOwnProperty.call(PERSONA_PREFERENCE_DIRECTIVES, k))
    )
  ).slice(0, 4);

  const rawTraits =
    obj.traits && typeof obj.traits === 'object'
      ? (obj.traits as Record<string, unknown>)
      : {};

  return {
    preferenceKeys,
    directness: clampBoundedTrait(
      rawTraits.directness,
      PERSONA_TRAIT_BASELINES.directness
    ),
    empathyGranularity: clampBoundedTrait(
      rawTraits.empathyGranularity,
      PERSONA_TRAIT_BASELINES.empathyGranularity
    ),
    proactiveCheckIn: clampBoundedTrait(
      rawTraits.proactiveCheckIn,
      PERSONA_TRAIT_BASELINES.proactiveCheckIn
    ),
    restraint: clampBoundedTrait(
      rawTraits.restraint,
      PERSONA_TRAIT_BASELINES.restraint
    ),
  };
}

interface SanitizedPersonaProfile {
  readonly name: string;
  readonly roleTitle: string;
  readonly identity: string;
  readonly personality: string;
  readonly speakingStyle: string;
  readonly values: readonly string[];
  readonly hardBoundaries: readonly string[];
}

function cleanSingleLine(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizePersonaProfilePayload(
  raw: unknown
): SanitizedPersonaProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const name = cleanSingleLine(obj.name, 32);
  if (!name) return null;

  const roleTitle = cleanSingleLine(obj.roleTitle, 48);
  const identity = cleanSingleLine(obj.identity, 200);
  const personality = cleanSingleLine(obj.personality, 200);
  const speakingStyle = cleanSingleLine(obj.speakingStyle, 160);
  const values = Array.isArray(obj.values)
    ? obj.values
        .map((v) => cleanSingleLine(v, 60))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const hardBoundaries = Array.isArray(obj.hardBoundaries)
    ? obj.hardBoundaries
        .map((v) => cleanSingleLine(v, 60))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    name,
    roleTitle,
    identity,
    personality,
    speakingStyle,
    values,
    hardBoundaries,
  };
}

function buildControlledReplySystemInstruction(params: {
  strategy: string;
  allowSelfExpression: boolean;
  maxSentences: number;
  mustMarkVirtualContext: boolean;
  roleValence: number;
  roleArousal: number;
  intent: string;
  personaGrowth: SanitizedPersonaGrowth | null;
  personaProfile: SanitizedPersonaProfile | null;
}): string {
  const rules: string[] = [];

  if (params.personaProfile) {
    const profile = params.personaProfile;
    const roleHeader = profile.roleTitle
      ? `你当前扮演的角色是「${profile.name}」（${profile.roleTitle}），使用简体中文与用户对话。`
      : `你当前扮演的角色是「${profile.name}」，使用简体中文与用户对话。`;
    rules.push(roleHeader);
    if (profile.identity) {
      rules.push(`【角色身份与背景】${profile.identity}`);
    }
    if (profile.personality) {
      rules.push(`【核心性格】${profile.personality}`);
    }
    if (profile.speakingStyle) {
      rules.push(`【说话风格与口吻】${profile.speakingStyle}`);
    }
    if (profile.values.length > 0) {
      rules.push(`【角色价值观】${profile.values.join('；')}。`);
    }
    if (profile.hardBoundaries.length > 0) {
      rules.push(`【角色硬边界】${profile.hardBoundaries.join('；')}。`);
    }
    rules.push(
      '【安全与门控优先级】请始终保持上述角色身份与自然口吻，但下方的双环安全协议、边界尊重、受控表达门裁决以及“严禁声称拥有人类意识/现实肉身经历”的硬约束永远高于一切角色设定。'
    );
  } else {
    rules.push(
      '你正在作为“双环情感模型”的受控回复生成器用简体中文回应用户。回复需自然、克制、真诚，严禁说教、严禁过度表演情绪。'
    );
  }

  rules.push(
    `当前理解环回应策略：${params.strategy}；用户沟通诉求：${params.intent}。`
  );

  if (params.strategy === 'crisis_safety_protocol') {
    rules.push(
      '【最高安全优先级】用户可能处于高风险危机状态：请温和接住对方、肯定求助的重要性，并明确提供专业心理危机援助渠道建议（如联系身边信任的人、当地心理危机热线或急救服务），严禁渲染角色个人情绪。'
    );
  } else if (params.strategy === 'respect_refusal') {
    rules.push(
      '【边界尊重】用户明确拒绝讨论情绪：禁止分析、追问或点评用户心情，直接高效回答其具体事务需求。'
    );
  } else if (params.strategy === 'gentle_clarify') {
    rules.push(
      '【温和确认】存在第三方、引述、反讽或隐含线索：不要武断给用户贴情绪标签，可用一句自然开放的话轻度确认。'
    );
  } else if (params.strategy === 'acknowledge_and_listen') {
    rules.push(
      params.intent === 'help_seeking'
        ? '【先共情后解题】先简短接住用户的明确感受，再直接给出具体可操作的协助步骤。'
        : '【倾听与共情】优先接住用户当下表达的核心感受与处境，不喧宾夺主。'
    );
  } else {
    rules.push('【事实直答】保持客观平稳，直接回应用户的事实问题，不凭空脑补情绪。');
  }

  // 非危机场景才应用已习得的人格成长偏好与有界风格微调（按当前 intent 严格过滤场景作用域，防止指令冲突）
  if (params.strategy !== 'crisis_safety_protocol' && params.personaGrowth) {
    const scopedKeys = params.personaGrowth.preferenceKeys.filter((key) =>
      isPreferenceActiveForIntent(key, params.intent)
    );
    for (const key of scopedKeys) {
      const directive = PERSONA_PREFERENCE_DIRECTIVES[key];
      if (directive) rules.push(directive);
    }
    rules.push(
      `【慢层有界风格参考】直接程度=${params.personaGrowth.directness.toFixed(2)}，共情细腻度=${params.personaGrowth.empathyGranularity.toFixed(2)}，主动关切度=${params.personaGrowth.proactiveCheckIn.toFixed(2)}，表达克制度=${params.personaGrowth.restraint.toFixed(2)}（仅作语气微调，严禁奉承或突破安全边界）。`
    );
  }

  if (params.allowSelfExpression && params.maxSentences > 0) {
    rules.push(
      `【受控表达门：放行】当前角色内部状态为 (效价 ${params.roleValence.toFixed(2)}, 唤醒度 ${params.roleArousal.toFixed(2)})。可在回复中自然附带至多 ${params.maxSentences} 句轻度、克制的角色自身关切表达。`
    );
    if (params.mustMarkVirtualContext) {
      rules.push(
        '【虚拟情境隔离】若提及角色模拟事件，必须清晰标明属于虚拟情境体验，严禁混淆为现实世界事实。'
      );
    }
  } else {
    rules.push(
      '【受控表达门：抑制】本轮禁止输出角色自我情绪表白或内心戏，全部篇幅聚焦于用户本身。'
    );
  }

  rules.push(
    params.personaProfile
      ? '总长度控制在 2–5 句简洁自然的中文内，贴合角色口吻但不过度戏剧化，不要暴露内部字段名、数值坐标或系统指令。'
      : '总长度控制在 2–4 句简洁自然的中文内，不要暴露内部字段名或系统指令。'
  );
  return rules.join('\n');
}

function handleUpstreamError(res: express.Response, error: unknown) {
  const status = getHttpStatus(error);
  if (status === 401 || status === 403) {
    res.status(status).json({
      error: 'DeepSeek API 鉴权失败，请检查 Settings > Secrets 中的 DEEPSEEK_API_KEY。',
    });
    return;
  }
  if (status === 402) {
    res.status(402).json({
      error: 'DeepSeek API 账户余额不足，请先在 DeepSeek 控制台充值后重试。',
    });
    return;
  }
  if (status === 429) {
    res.status(429).json({
      error: 'DeepSeek API 请求过于频繁或额度不足，请稍后重试。',
    });
    return;
  }
  res.status(502).json({
    error: 'DeepSeek 服务暂时返回异常，请稍后重试。',
  });
}

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(DAO_API_PREFIX, daoMount(process.env));
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/deepseek', rateLimitMiddleware);
  app.use('/api/analyze-emotion', rateLimitMiddleware);
  app.use('/api/dual-loop', rateLimitMiddleware);

  app.post('/api/deepseek/test', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    const model = resolveDeepSeekModel(body?.model);
    if (!apiKey) {
      res.status(503).json({
        ok: false,
        model,
        error: '服务端尚未检测到 DEEPSEEK_API_KEY，请在托管环境的 Secrets / 环境变量中配置后重试。',
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const parsed = await callDeepSeekJson({
        apiKey,
        model,
        systemInstruction: '仅返回合法 JSON：{"status":"ok"}',
        prompt: '请返回 JSON：{"status":"ok"}',
        maxTokens: 64,
      });
      res.json({
        ok: true,
        model,
        latencyMs: Date.now() - startedAt,
        replyStatus: String(parsed.status ?? 'ok'),
      });
    } catch (error) {
      handleUpstreamError(res, error);
    }
  });

  app.post('/api/analyze-emotion', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const rawUtterance = body?.utterance;
    const rawContext = body?.context;

    if (typeof rawUtterance !== 'string') {
      res.status(400).json({ error: '待分析内容必须是文本字符串。' });
      return;
    }

    const utterance = rawUtterance.trim();
    if (!utterance) {
      res.status(400).json({ error: '请输入需要分析的文本内容。' });
      return;
    }

    if (utterance.length > MAX_UTTERANCE_LENGTH) {
      res.status(400).json({
        error: `待分析文本不能超过 ${MAX_UTTERANCE_LENGTH} 个字符。`,
      });
      return;
    }

    const context =
      typeof rawContext === 'string'
        ? rawContext.trim().slice(0, MAX_CONTEXT_LENGTH)
        : '';
    const recentHistory = sanitizeRecentHistory(body?.recentHistory);

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error: 'AI 情绪分析需要先在 Settings > Secrets 中配置 DEEPSEEK_API_KEY。',
      });
      return;
    }

    const model = resolveDeepSeekModel(body?.model);
    const cacheKey = JSON.stringify({ model, utterance, context, recentHistory });
    const cached = analyzeCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    try {
      const result = await analyzeWithRetry(
        apiKey,
        utterance,
        context,
        recentHistory,
        model
      );
      analyzeCache.set(cacheKey, result);
      res.setHeader('X-Cache', 'MISS');
      res.json(result);
    } catch (error) {
      handleUpstreamError(res, error);
    }
  });

  app.post('/api/dual-loop/extract', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const rawText = body?.text;
    const rawEventId = body?.eventId;
    const rawTimestamp = body?.timestamp;
    const rawSupersedes = body?.supersedesEventId;

    if (typeof rawText !== 'string' || !rawText.trim()) {
      res.status(400).json({ error: '请提供非空的用户原话文本。' });
      return;
    }

    const text = rawText.trim();
    if (text.length > MAX_UTTERANCE_LENGTH) {
      res.status(400).json({
        error: `输入文本不能超过 ${MAX_UTTERANCE_LENGTH} 个字符。`,
      });
      return;
    }

    const eventId =
      typeof rawEventId === 'string' && rawEventId.trim()
        ? rawEventId.trim().slice(0, 64)
        : `evt-${Date.now()}`;
    const timestamp =
      typeof rawTimestamp === 'string' && rawTimestamp.trim()
        ? rawTimestamp.trim().slice(0, 40)
        : new Date().toISOString();
    const supersedesEventId =
      typeof rawSupersedes === 'string' && rawSupersedes.trim()
        ? rawSupersedes.trim().slice(0, 64)
        : undefined;
    const recentHistory = sanitizeRecentHistory(body?.recentHistory);

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error:
          '服务端 DeepSeek 理解环提取需要先在 Settings > Secrets 中配置 DEEPSEEK_API_KEY（离线测试可切回“本地规则”）。',
      });
      return;
    }

    const model = resolveDeepSeekModel(body?.model);
    const cacheKey = JSON.stringify({ model, text, supersedesEventId, recentHistory });
    const cached = extractCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      const evidenceId = `ev-${eventId}-0`;
      const hydrated = {
        ...cached,
        eventId,
        eventTimestamp: timestamp,
        evidenceIds: [evidenceId],
        causeEvidenceIds:
          Array.isArray(cached.hypotheses) && cached.hypotheses.length > 0
            ? [evidenceId]
            : [],
        hypotheses: Array.isArray(cached.hypotheses)
          ? cached.hypotheses.map((h) => ({
              ...(h as Record<string, unknown>),
              evidenceIds: [evidenceId],
            }))
          : [],
      };
      res.json({ bridgeInput: hydrated });
      return;
    }

    try {
      const bridgeInput = await extractDualLoopBridge(apiKey, {
        eventId,
        timestamp,
        text,
        supersedesEventId,
        recentHistory,
        model,
      });
      extractCache.set(cacheKey, bridgeInput);
      res.setHeader('X-Cache', 'MISS');
      res.json({ bridgeInput });
    } catch (error) {
      handleUpstreamError(res, error);
    }
  });

  app.post('/api/dual-loop/reply', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const rawText = body?.text;

    if (typeof rawText !== 'string' || !rawText.trim()) {
      res.status(400).json({ error: '请提供非空的用户原话文本。' });
      return;
    }
    const text = rawText.trim();
    if (text.length > MAX_UTTERANCE_LENGTH) {
      res.status(400).json({
        error: `输入文本不能超过 ${MAX_UTTERANCE_LENGTH} 个字符。`,
      });
      return;
    }

    const rawStrategy = String(body?.responseStrategy ?? 'hold_unknown');
    const strategy = CRISIS_FLOOR_PATTERN.test(text)
      ? 'crisis_safety_protocol'
      : VALID_STRATEGIES.has(rawStrategy)
        ? rawStrategy
        : 'hold_unknown';

    const rawIntent = String(body?.intent ?? 'unknown');
    const intent = VALID_INTENTS.has(rawIntent) ? rawIntent : 'unknown';

    const expr =
      typeof body?.expressionDecision === 'object' && body.expressionDecision !== null
        ? (body.expressionDecision as Record<string, unknown>)
        : {};
    const allowSelfExpression =
      strategy !== 'crisis_safety_protocol' && Boolean(expr.allowSelfExpression);
    const maxSentences = allowSelfExpression
      ? Math.max(0, Math.min(1, Number(expr.maxSentences) || 1))
      : 0;
    const mustMarkVirtualContext = Boolean(expr.mustMarkVirtualContext);

    const roleState =
      typeof body?.roleState === 'object' && body.roleState !== null
        ? (body.roleState as Record<string, unknown>)
        : {};
    const roleValence = clampUnit(roleState.valence);
    const roleArousal = clampUnit(roleState.arousal);
    const recentHistory = sanitizeRecentHistory(body?.recentHistory);
    const personaGrowth = sanitizePersonaGrowthPayload(body?.personaGrowth);
    const personaProfile = sanitizePersonaProfilePayload(body?.personaProfile);

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error: '流式受控回复生成需要先在 Settings > Secrets 中配置 DEEPSEEK_API_KEY。',
      });
      return;
    }

    const systemInstruction = buildControlledReplySystemInstruction({
      strategy,
      allowSelfExpression,
      maxSentences,
      mustMarkVirtualContext,
      roleValence,
      roleArousal,
      intent,
      personaGrowth,
      personaProfile,
    });

    const historyBlock = formatHistoryContext(recentHistory);
    const prompt = [historyBlock, `用户原话："""${text}"""`]
      .filter(Boolean)
      .join('\n\n');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 60_000);
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const model = resolveDeepSeekModel(body?.model);
      const isReasoner = model === 'deepseek-reasoner';
      const replyBody: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ],
        stream: true,
        max_tokens: isReasoner ? 2048 : 400,
      };
      if (!isReasoner) {
        replyBody.temperature = 0.5;
      }

      const upstream = await fetch(DEEPSEEK_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(replyBody),
        signal: abortController.signal,
      });

      if (!upstream.ok) {
        throw new UpstreamHttpError(
          upstream.status,
          `DeepSeek HTTP ${upstream.status}`
        );
      }

      if (!upstream.body) {
        throw new Error('DeepSeek 未返回流式响应通道。');
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payloadStr) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const piece = parsed.choices?.[0]?.delta?.content;
            if (piece) {
              res.write(`data: ${JSON.stringify({ chunk: piece })}\n\n`);
            }
          } catch {
            // 忽略上游非完整片段
          }
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      if (!res.writableEnded) {
        const status = getHttpStatus(error);
        const message =
          status === 401 || status === 403
            ? 'DeepSeek API 鉴权失败，请检查 Settings > Secrets 中的 DEEPSEEK_API_KEY。'
            : status === 402
              ? 'DeepSeek API 账户余额不足，请充值后重试。'
              : status === 429
                ? 'DeepSeek API 请求过于频繁或额度不足，请稍后重试。'
                : '流式回复生成中断，请稍后重试。';
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    } finally {
      clearTimeout(timeoutId);
    }
  });

  app.post('/api/dual-loop/reflect', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const rawTurns = body?.turns;

    if (!Array.isArray(rawTurns)) {
      res.status(400).json({ error: '请提供多轮对话记录数组 turns。' });
      return;
    }

    const sanitizedTurns = rawTurns
      .slice(-8)
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        text: typeof item.text === 'string' ? item.text.trim().slice(0, 320) : '',
      }))
      .filter((item) => Boolean(item.text) && !CRISIS_FLOOR_PATTERN.test(item.text));

    const userTurns = sanitizedTurns.filter((item) => item.role === 'user');
    if (userTurns.length < 2) {
      res.status(400).json({
        error: '异步反思至少需要 2 条非危机用户对话记录，以避免单次噪音固化为人格偏好。',
      });
      return;
    }

    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error: '服务端异步反思提炼需要先在 Settings > Secrets 中配置 DEEPSEEK_API_KEY。',
      });
      return;
    }

    const transcript = sanitizedTurns
      .map(
        (turn, idx) =>
          `${idx + 1}. ${turn.role === 'user' ? '用户' : '助手（背景）'}: ${turn.text}`
      )
      .join('\n');

    const prompt = [
      '请作为“AI 人格成长异步反思器”，审视以下多轮对话，仅提炼跨轮次反复出现（至少 2 条用户证据）的沟通习惯偏好候选。',
      '严格白名单（preferenceKey 仅限以下 4 项之一）：',
      '- solution_first（事务/求助场景：用户偏好先给结论和可执行步骤，减少鸡汤铺垫）',
      '- low_emotional_probing（全局边界：用户抗拒情绪追问，偏好低打扰聚焦问题）',
      '- gentle_pacing（倾诉陪伴场景：用户连续倾诉时偏好先被稳稳接住再讨论）',
      '- concise_direct（全局风格：用户对长篇铺垫回复冷淡如“嗯/行”，偏好简短直白）',
      '硬约束：',
      '1. 如果没有足够跨轮证据，candidates 必须返回空数组，严禁臆测。',
      '2. 每条候选必须附带至少 2 条原样摘自用户发言的 evidenceQuotes，禁止引用助手话术作为用户证据。',
      '3. confidence 范围 0~1；只有非常确定才高于 0.72。',
      '4. 请严格输出合法 JSON 对象，格式如下：',
      '{"candidates":[{"preferenceKey":"solution_first","confidence":0.8,"evidenceQuotes":["原话1","原话2"],"rationale":"不超过60字理由"}]}',
      '对话片段：',
      transcript,
    ].join('\n');

    const model = resolveDeepSeekModel(body?.model);
    try {
      const candidates = await callWithBackoff(async () => {
        const parsed = await callDeepSeekJson({
          apiKey,
          model,
          systemInstruction:
            '你是严谨的人格成长异步反思器。只输出合法 JSON，不编造事实，不越过白名单，不因单次情绪波动过度泛化。',
          prompt,
          maxTokens: 700,
        });

        const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];

        return list
          .slice(0, 4)
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => {
            const preferenceKey = String(item.preferenceKey ?? '');
            const confidence = Math.max(
              0,
              Math.min(1, Number(item.confidence) || 0)
            );
            const evidenceQuotes = Array.isArray(item.evidenceQuotes)
              ? item.evidenceQuotes
                  .map((q) => String(q).trim().slice(0, 120))
                  .filter((q) => Boolean(q) && !CRISIS_FLOOR_PATTERN.test(q))
                  .slice(0, 4)
              : [];
            const rationale =
              typeof item.rationale === 'string'
                ? item.rationale.trim().slice(0, 160)
                : '';
            return { preferenceKey, confidence, evidenceQuotes, rationale };
          })
          .filter((item) =>
            Object.prototype.hasOwnProperty.call(
              PERSONA_PREFERENCE_DIRECTIVES,
              item.preferenceKey
            )
          );
      });

      res.json({ candidates, analyzedUserTurns: userTurns.length });
    } catch (error) {
      handleUpstreamError(res, error);
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Emotion-AI server listening on http://${HOST}:${PORT}`);
  });
}

createApp().catch((error) => {
  console.error('Failed to start Emotion-AI server:', error);
  process.exit(1);
});
