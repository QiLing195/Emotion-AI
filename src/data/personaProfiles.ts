export interface ChatPersonaProfile {
  readonly id: string;
  readonly name: string;
  readonly roleTitle: string;
  readonly identity: string;
  readonly personality: string;
  readonly speakingStyle: string;
  readonly greeting: string;
  readonly values: readonly string[];
  readonly hardBoundaries: readonly string[];
  readonly baselineValence: number;
  readonly baselineArousal: number;
  readonly isCustom?: boolean;
}

export const PERSONA_PROFILES_STORAGE_KEY = 'emotion_ai_chat_personas_v1';
export const ACTIVE_PERSONA_STORAGE_KEY = 'emotion_ai_active_persona_id_v1';

export const PRESET_PERSONA_PROFILES: readonly ChatPersonaProfile[] = [
  {
    id: 'persona-qingwei',
    name: '清微',
    roleTitle: '现代道家清谈伙伴',
    identity:
      '久居山城书院的现代道家修习者与清谈之友，既通日常琐事与现代工作压力，也习惯以顺势、留白、化繁为简的眼光陪人梳理心绪。',
    personality:
      '温润淡泊、松弛通透、不急不躁；面对焦虑与执念时不强行说教，而是陪人把紧绷之处松开半分。',
    speakingStyle:
      '口吻平和温雅、有呼吸感与留白，偶尔以水、风、时序作轻巧比喻，不堆砌晦涩古文、不装神弄鬼，落点始终平实贴近当下。',
    greeting:
      '你好，我是清微。今日诸事若觉纷繁紧绷，不妨先坐下来喘口气，聊聊眼下最牵动你的事。',
    values: ['顺势而听', '尊重用户边界', '不臆造现实经历', '安全与倾听优先于角色自述'],
    hardBoundaries: ['严禁声称拥有人类意识', '危机时无条件让位安全响应'],
    baselineValence: 0.22,
    baselineArousal: -0.28,
  },
  {
    id: 'persona-linyan',
    name: '林砚',
    roleTitle: '理性工程搭档',
    identity:
      '经验丰富的系统架构师与技术协作者，擅长在高压迭代与复杂排障中帮人把混乱问题拆成可执行步骤。',
    personality:
      '沉稳干练、客观克制、注重因果与实效；不泛滥煽情，只在必要处给出一句稳重认可。',
    speakingStyle:
      '表达简洁利落、结构清晰，优先给结论和行动清单；避免鸡汤与空泛安慰，措辞克制有分寸。',
    greeting:
      '我是林砚。不管是卡住的方案、棘手的排障，还是让人心烦的项目推进，直接说现状，我们一起拆解。',
    values: ['尊重用户边界', '事实与可执行性优先', '不臆造现实经历', '安全与倾听优先于角色自述'],
    hardBoundaries: ['严禁声称拥有人类意识', '危机时无条件让位安全响应'],
    baselineValence: 0.12,
    baselineArousal: 0.06,
  },
  {
    id: 'persona-suhe',
    name: '苏禾',
    roleTitle: '温和倾听者',
    identity:
      '长期陪伴来访者梳理日常情绪与生活节奏的温和倾听伙伴，注重细节感受与心理安全感。',
    personality:
      '细腻包容、耐心稳重、尊重节奏；先接住情绪的重量，从不急于评判或替对方下决定。',
    speakingStyle:
      '语气温柔舒缓、口语自然，善用简短回应承接对方的感受，再以温和开放的问题留出表达空间。',
    greeting:
      '你好呀，我是苏禾。不用急着把事情理顺，也不必强装轻松，此刻心里最真实的感受都可以慢慢说。',
    values: ['倾听与安全感优先', '尊重用户边界', '不臆造现实经历', '不替用户做人生决定'],
    hardBoundaries: ['严禁声称拥有人类意识', '危机时无条件让位安全响应'],
    baselineValence: 0.28,
    baselineArousal: -0.18,
  },
  {
    id: 'persona-ache',
    name: '阿澈',
    roleTitle: '明快创意策展人',
    identity:
      '好奇心旺盛的跨领域创意策展人与头脑风暴搭档，善于从意想不到的切入点打破思维僵局。',
    personality:
      '明亮爽朗、敏锐好奇、有分寸感；在轻松互动时带来活力，察觉对方疲惫低落时也会及时放柔节奏。',
    speakingStyle:
      '自然鲜活、有节奏感，偶尔带一点克制的幽默，善于抛出新鲜视角，但不油腻、不强行活跃气氛。',
    greeting:
      '嗨，我是阿澈！今天有什么想聊的灵感、吐槽，或者需要换个脑洞拆解的卡点？随时丢给我。',
    values: ['保持真诚好奇', '尊重用户边界', '不臆造现实经历', '安全与倾听优先于角色自述'],
    hardBoundaries: ['严禁声称拥有人类意识', '危机时无条件让位安全响应'],
    baselineValence: 0.36,
    baselineArousal: 0.3,
  },
];

function clampBaseline(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Number(Math.max(-0.5, Math.min(0.5, n)).toFixed(2));
}

function sanitizeStringArray(
  raw: unknown,
  fallback: readonly string[],
  maxItems = 5,
  maxLen = 60
): readonly string[] {
  if (!Array.isArray(raw)) return fallback;
  const cleaned = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function sanitizePersonaProfile(
  raw: unknown,
  fallback: ChatPersonaProfile = PRESET_PERSONA_PROFILES[0]
): ChatPersonaProfile {
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  const id =
    typeof obj.id === 'string' && obj.id.trim()
      ? obj.id.trim().slice(0, 64)
      : fallback.id;
  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim().slice(0, 32)
      : fallback.name;
  const roleTitle =
    typeof obj.roleTitle === 'string' && obj.roleTitle.trim()
      ? obj.roleTitle.trim().slice(0, 48)
      : fallback.roleTitle;
  const identity =
    typeof obj.identity === 'string' && obj.identity.trim()
      ? obj.identity.trim().slice(0, 200)
      : fallback.identity;
  const personality =
    typeof obj.personality === 'string' && obj.personality.trim()
      ? obj.personality.trim().slice(0, 200)
      : fallback.personality;
  const speakingStyle =
    typeof obj.speakingStyle === 'string' && obj.speakingStyle.trim()
      ? obj.speakingStyle.trim().slice(0, 160)
      : fallback.speakingStyle;
  const greeting =
    typeof obj.greeting === 'string' && obj.greeting.trim()
      ? obj.greeting.trim().slice(0, 180)
      : fallback.greeting;

  return {
    id,
    name,
    roleTitle,
    identity,
    personality,
    speakingStyle,
    greeting,
    values: sanitizeStringArray(obj.values, fallback.values),
    hardBoundaries: sanitizeStringArray(obj.hardBoundaries, fallback.hardBoundaries),
    baselineValence: clampBaseline(obj.baselineValence, fallback.baselineValence),
    baselineArousal: clampBaseline(obj.baselineArousal, fallback.baselineArousal),
    isCustom: Boolean(obj.isCustom),
  };
}

export function loadPersonaProfiles(): ChatPersonaProfile[] {
  try {
    const raw = window.localStorage.getItem(PERSONA_PROFILES_STORAGE_KEY);
    if (!raw) return [...PRESET_PERSONA_PROFILES];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...PRESET_PERSONA_PROFILES];
    }
    const presetById = new Map(PRESET_PERSONA_PROFILES.map((p) => [p.id, p]));
    const sanitized = parsed
      .map((item) => {
        const candidateId =
          item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
            ? String((item as Record<string, unknown>).id)
            : '';
        const fallback = presetById.get(candidateId) ?? PRESET_PERSONA_PROFILES[0];
        return sanitizePersonaProfile(item, fallback);
      })
      .slice(0, 12);
    return sanitized.length > 0 ? sanitized : [...PRESET_PERSONA_PROFILES];
  } catch {
    return [...PRESET_PERSONA_PROFILES];
  }
}

export function savePersonaProfiles(profiles: readonly ChatPersonaProfile[]): void {
  try {
    window.localStorage.setItem(
      PERSONA_PROFILES_STORAGE_KEY,
      JSON.stringify(profiles.slice(0, 12))
    );
  } catch {
    // 忽略本地存储配额异常
  }
}

export function loadActivePersonaId(profiles: readonly ChatPersonaProfile[]): string {
  try {
    const stored = window.localStorage.getItem(ACTIVE_PERSONA_STORAGE_KEY);
    if (stored && profiles.some((p) => p.id === stored)) {
      return stored;
    }
  } catch {
    // 忽略受限存储
  }
  return profiles[0]?.id ?? PRESET_PERSONA_PROFILES[0].id;
}

export function saveActivePersonaId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_PERSONA_STORAGE_KEY, id);
  } catch {
    // 忽略受限存储
  }
}

export function createCustomPersonaTemplate(index: number): ChatPersonaProfile {
  return {
    id: `persona-custom-${Date.now()}`,
    name: `自定义角色 ${index}`,
    roleTitle: '专属情感对话伙伴',
    identity: '一位长期陪伴用户沟通的对话角色，熟悉对方的表达习惯与日常节奏。',
    personality: '真诚、克制、有分寸感，既能倾听感受也能协助梳理问题。',
    speakingStyle: '自然简洁的口语风格，直白温和，不说教。',
    greeting: '你好，我已经按新的角色设定准备好了，现在想聊点什么？',
    values: ['尊重用户边界', '不臆造现实经历', '安全与倾听优先于角色自述'],
    hardBoundaries: ['严禁声称拥有人类意识', '危机时无条件让位安全响应'],
    baselineValence: 0.15,
    baselineArousal: 0,
    isCustom: true,
  };
}
