/**
 * Agent 工具层 + 有界循环（v1.72）—— 让她能"先查一下再回答"。
 *
 * 背景：项目在 LLM/上下文/记忆三项上很深，但 `aiProvider` 只是**预留**了 tools/functionCalls 管道，
 * 没有工具注册表、没有执行器、也没有把 functionCalls 接回主流程（全仓无人消费）。
 *
 * 本模块补的是**最小闭环**：
 *   generate →（模型请求工具）→ 执行 → 结果回灌 → generate → 最终回复
 * 有界：最多 `MAX_ROUNDS = 2` 轮（用户裁定"循环可以进行两轮"）。
 *
 * 设计约束：
 *   · 工具必须**可审计**：每个调用记 trace（工具名/入参摘要/耗时/是否成功）；
 *   · 工具失败 ⇒ 把错误当结果回灌（让她知道"没查到"），**绝不让主流程抛错**；
 *   · 超过轮次上限 ⇒ 用最后一次 text 收尾（不无限循环）；
 *   · 默认关：`ENABLE_AGENT_TOOLS=true` 才进入；关着时行为与旧版逐字节相同（单测钉住"只调一次模型"）。
 */

import { MAX_HORIZON_HOURS } from './herFollowups.js';
import { parseCnTime, toLocalIso } from './cnTimeParse.js';

export const MAX_AGENT_ROUNDS = 2;      // 最多 2 轮**工具**调用
export const MAX_MODEL_CALLS = 3;      // 2 轮工具 + 1 次收尾生成（总模型调用上限）
export const MAX_TOOL_CALLS = 4;

export function agentToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_AGENT_TOOLS === 'true';
}

export type ToolName = 'check_my_state' | 'recall_recent_events' | 'recall_memory' | 'time_now' | 'remember_this' | 'read_my_notes' | 'set_followup' | 'get_weather' | 'search_map' | 'read_my_activity';

export interface ToolTraceEntry {
  round: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  resultPreview: string;
}

export interface ToolContext {
  /** 她此刻的状态（情绪/低谷/小屋）——只读 */
  getState: () => unknown;
  /** 最近的事件/时间线节点——只读 */
  getRecentEvents: (limit?: number) => unknown;
  /** 按话题检索记忆——只读（没接就返回 []，工具会如实说"没查到"） */
  recallMemory?: (query: string, limit?: number) => unknown;
  /** 本地时间——只读 */
  getTime?: () => unknown;
  /** 记一条她自己的便签（唯一主动写自己状态的通路；未接则工具如实报错） */
  writeNote?: (note: string) => { ok: boolean; reason?: string; count?: number };
  /** 记一条"到点再问"（未接则如实报错） */
  addFollowup?: (what: string, dueInHours: number, dueAtLocal?: string | null) => { ok: boolean; reason?: string; dueAt?: number };
  /** 联网：天气（未接/失败都返回 { ok:false }） */
  getWeather?: (city: string) => Promise<unknown> | unknown;
  /** 联网：地名检索 */
  searchMap?: (place: string) => Promise<unknown> | unknown;
  /** 翻她自己的便签（未接则返回 []） */
  readNotes?: (limit?: number) => unknown;
  /** 看他在电脑上做什么（只读：窗口标题/进程；未接/没开都返回 enabled:false） */
  getActivity?: (limit?: number) => unknown;
  /** 外部 MCP server 的工具（声明 + 调用；没接就完全不出现） */
  mcp?: {
    declarations: () => Promise<Array<{ name: string; description: string; parameters: unknown }>> | Array<{ name: string; description: string; parameters: unknown }>;
    call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };
}

/** 给 provider 的函数声明（Gemini 的 functionDeclarations 形状） */
export function toolDeclarations(extra: Array<{ name: string; description: string; parameters: unknown }> = []): unknown[] {
  return [
    {
      functionDeclarations: [
        {
          name: 'check_my_state',
          description: '查看我自己此刻的状态：被激起的情绪、心情底色、是否在低谷、此刻在小屋里做什么。回答涉及"你现在怎么样/你的心情/你在做什么"之前应该先查一次。',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'recall_memory',
          description: '按话题检索我过去的记忆（他说过的事、我们经历过的事）。回答"你还记得…吗/之前说过…吗"之前应该先查一次；查不到就说记不太清，不要编。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '要检索的话题关键词，比如"面试""生日""海边"' },
              limit: { type: 'number', description: '最多几条，默认 3，最多 5' },
            },
            required: ['query'],
          },
        },
        {
          name: 'time_now',
          description: '查看现在的日期、时间与星期（避免把"今天/明天"说错）。',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'remember_this',
          description: '把一件**你答应过/想记住**的事写进自己的便签（只追加、可审计）。比如"他说下周要体检，记得问"。不要用它记他的原话逐字复述。',
          parameters: {
            type: 'object',
            properties: {
              note: { type: 'string', description: '要记住的事，4~80 字，用你自己的话' },
              dueAtLocal: { type: 'string', description: '这件事如果有**明确时间**（如"下周三""明天下午三点"），把时间填这里（YYYY-MM-DDTHH:mm）。我会**同时帮你排一条到点提醒**；不填也行（只记便签）' },
            },
            required: ['note'],
          },
        },
        {
          name: 'read_my_notes',
          description: '翻一下自己写过的便签（之前记下的、答应过要记住的事）。他问"你还记着我什么吗/上次那事"时可以看。',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: '看几条，默认 5，最多 10' },
            },
            required: [],
          },
        },
        {
          name: 'set_followup',
          description: '把一件事记在心里：到时间你会**自己想起来**并主动提起（说什么、怎么说由你当时的感受决定，不是定时发一句预设的话）。**当他说"明天提醒我/记得问我"时用本工具记下这件事**。',
          parameters: {
            type: 'object',
            properties: {
              what: { type: 'string', description: '这件事是什么（4~120 字，用你自己的话概括；不要写成一条预设消息）' },
              dueAtLocal: { type: 'string', description: '他说了具体时间就填这里，格式 YYYY-MM-DDTHH:mm（本地时间，如 2026-10-23T15:00）。**优先用它，别自己算小时**' },
              dueInHours: { type: 'number', description: '没说具体时间时才用：几小时后发出，0.5~336（14 天内）' },
            },
            required: ['what', 'dueInHours'],
          },
        },
        {
          name: 'read_my_activity',
          description: '看**他此刻/刚才在电脑上做什么**（只读：前台窗口标题与程序名，不含你俩对话内容、不含键盘输入）。他问"我在干嘛/你猜我在做什么"、或你想知道他是不是在忙时用。',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: '看几条，默认 6，最多 20' },
            },
            required: [],
          },
        },
        {
          name: 'get_weather',
          description: '查某个城市现在的天气（温度/体感/湿度/风/天气）。他提到出门、天气、冷不冷热不热时可以用。查不到就如实说查不到。',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: '城市名，比如"北京""杭州"（不要带"市"也可以）' },
            },
            required: ['city'],
          },
        },
        {
          name: 'search_map',
          description: '查一个地名在哪里（省份/国家/经纬度）。注意：这是**地名库**检索，不是完整地图 POI——具体店铺/门牌查不到时如实说。',
          parameters: {
            type: 'object',
            properties: {
              place: { type: 'string', description: '要查的地名，比如"西湖""鼓浪屿"' },
            },
            required: ['place'],
          },
        },
        {
          name: 'recall_recent_events',
          description: '查看最近发生的事（我们之间最近几轮的状态变化与触发），用于避免记错或答非所问。',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: '要看几条，默认 5，最多 10' },
            },
            required: [],
          },
        },
        // 外部 MCP 工具（v1.82）：形如 mcp__<server>__<tool>，由 mcpClient 生成
        ...extra.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
      ],
    },
  ];
}

function clip(s: string, n = 240): string {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n) + '…';
}

/** 执行一个工具（纯本地、无网络；失败返回 {ok:false} 而不是抛错） */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; result: unknown; ms: number }> {
  const t0 = Date.now();
  try {
    // 外部 MCP 工具（v1.82）：mcp__<server>__<tool>
    if (name.startsWith('mcp__')) {
      if (!ctx.mcp) return { ok: false, result: { error: 'mcp_disabled（外部 MCP 没开）' }, ms: Date.now() - t0 };
      const r = await ctx.mcp.call(name, args);
      return { ok: Boolean((r as { ok?: boolean })?.ok), result: r, ms: Date.now() - t0 };
    }
    if (name === 'check_my_state') {
      const result = ctx.getState();
      return { ok: true, result, ms: Date.now() - t0 };
    }
    if (name === 'read_my_activity') {
      const raw = Number(args?.limit ?? 6);
      const limit = Math.max(1, Math.min(20, Number.isFinite(raw) ? raw : 6));
      const view = ctx.getActivity ? ctx.getActivity(limit) : { enabled: false, entries: [] };
      const entries = (view as { entries?: unknown[] })?.entries ?? [];
      return {
        ok: true,
        result: entries.length > 0 ? view : { ...(view as object), note: (view as { note?: string })?.note ?? '还没有活动记录。' },
        ms: Date.now() - t0,
      };
    }
    if (name === 'get_weather') {
      const city = String(args?.city ?? '').trim();
      if (!ctx.getWeather) return { ok: false, result: { error: 'external_tools_disabled（联网工具没开）' }, ms: Date.now() - t0 };
      const r = await ctx.getWeather(city);
      return { ok: Boolean((r as { ok?: boolean })?.ok), result: r, ms: Date.now() - t0 };
    }
    if (name === 'search_map') {
      const place = String(args?.place ?? '').trim();
      if (!ctx.searchMap) return { ok: false, result: { error: 'external_tools_disabled（联网工具没开）' }, ms: Date.now() - t0 };
      const r = await ctx.searchMap(place);
      return { ok: Boolean((r as { ok?: boolean })?.ok), result: r, ms: Date.now() - t0 };
    }
    if (name === 'remember_this') {
      const note = String(args?.note ?? '').trim();
      const dueAtLocal = args?.dueAtLocal == null ? null : String(args.dueAtLocal);
      if (!ctx.writeNote) return { ok: false, result: { error: 'notes_disabled（便签没开）' }, ms: Date.now() - t0 };
      const r = ctx.writeNote(note);
      // v1.79 联动：记便签时若带明确时间，顺手排一条"到点提醒"（模型不用自己算小时）
      //   ① 模型给了 dueAtLocal ⇒ 用它
      //   ② 没给，但便签文本里**有未来时间词**（下周三/明天/10月28日…）⇒ 本地解析后用它
      //      只认未来时间词，避免"他今天心情不好"这种被误排成提醒
      let followup: { ok: boolean; reason?: string; dueAt?: number; source?: string } | null = null;
      if (r.ok && ctx.addFollowup) {
        let targetLocal: string | null = dueAtLocal;
        let source = 'dueAtLocal';
        if (!targetLocal && /(下下?\s*(?:周|星期|礼拜)|明天|后天|大后天|\d{1,2}\s*月\s*\d{1,2}\s*[日号])/.test(note)) {
          const parsed = parseCnTime(note);
          if (parsed && parsed.dueAt > Date.now() && parsed.dueAt - Date.now() <= MAX_HORIZON_HOURS * 3_600_000) {
            targetLocal = toLocalIso(parsed.dueAt);
            source = 'parsed_from_note';
          }
        }
        if (targetLocal) {
          const res = ctx.addFollowup(note, 0, targetLocal);
          followup = { ...res, source };
        }
      }
      return {
        ok: r.ok,
        result: { ...r, ...(followup ? { followup } : {}) },
        ms: Date.now() - t0,
      };
    }
    if (name === 'read_my_notes') {
      const raw = Number(args?.limit ?? 5);
      const limit = Math.max(1, Math.min(10, Number.isFinite(raw) ? raw : 5));
      const notes = ctx.readNotes ? ctx.readNotes(limit) : [];
      const arr = Array.isArray(notes) ? notes : [];
      return {
        ok: true,
        result: arr.length > 0 ? arr : { found: 0, note: '便签是空的（还没记过什么）' },
        ms: Date.now() - t0,
      };
    }
    if (name === 'set_followup') {
      const what = String(args?.what ?? '').trim();
      const hours = Number(args?.dueInHours ?? 0);
      const dueAtLocal = args?.dueAtLocal == null ? null : String(args.dueAtLocal);
      if (!ctx.addFollowup) return { ok: false, result: { error: 'followup_disabled（追问没开）' }, ms: Date.now() - t0 };
      const r = ctx.addFollowup(what, hours, dueAtLocal);
      return { ok: r.ok, result: r, ms: Date.now() - t0 };
    }
    if (name === 'recall_memory') {
      const q = String(args?.query ?? '').trim();
      if (!q) return { ok: false, result: { error: 'missing_query（要检索什么？）' }, ms: Date.now() - t0 };
      const limit = Math.max(1, Math.min(5, Number(args?.limit ?? 3) || 3));
      const items = ctx.recallMemory ? ctx.recallMemory(q, limit) : [];
      const arr = Array.isArray(items) ? items.slice(0, limit) : [];
      return {
        ok: true,
        result: arr.length > 0 ? arr : { found: 0, note: `记忆里没检索到与「${q}」相关的事` },
        ms: Date.now() - t0,
      };
    }
    if (name === 'time_now') {
      const now = ctx.getTime ? ctx.getTime() : { iso: new Date().toISOString() };
      return { ok: true, result: now, ms: Date.now() - t0 };
    }
    if (name === 'recall_recent_events') {
      const raw = Number(args?.limit ?? 5);
      const limit = Math.max(1, Math.min(10, Number.isFinite(raw) ? raw : 5));
      const result = ctx.getRecentEvents(limit);
      return { ok: true, result, ms: Date.now() - t0 };
    }
    return { ok: false, result: { error: `unknown_tool（没有这个工具：${name}）` }, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, result: { error: e instanceof Error ? e.message : 'tool_failed' }, ms: Date.now() - t0 };
  }
}

export interface AgentLoopInput {
  systemPrompt: string;
  /** 本轮他的话（作为 user message） */
  userMessage: string;
  /** 最近对话（不含本轮） */
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  ctx: ToolContext;
  /** 模型调用适配器：传 tools 时应返回 functionCalls */
  callModel: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    tools: unknown[] | null,
  ) => Promise<{ text: string; functionCalls?: Array<{ name: string; args?: Record<string, unknown> }> }>;
  maxRounds?: number;
}

export interface AgentLoopResult {
  text: string;
  rounds: number;
  toolTrace: ToolTraceEntry[];
  /** 是否真的调过工具（用于 A/B 与观测） */
  usedTools: boolean;
}

/**
 * 有界 agent 循环：最多 maxRounds 轮（默认 2）。
 * 第 1 轮：带工具请求；若模型要求工具 → 执行 + 结果回灌 → 第 2 轮再请求一次。
 * 第 2 轮仍要工具 ⇒ 不再执行（有界），直接用它的 text（若为空则退回上一次 text）。
 */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const maxRounds = Math.max(1, Math.min(MAX_AGENT_ROUNDS, input.maxRounds ?? MAX_AGENT_ROUNDS));
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...(input.recentMessages ?? []).slice(-10),
    { role: 'user', content: input.userMessage },
  ];
  const toolTrace: ToolTraceEntry[] = [];
  let totalCalls = 0;
  let lastText = '';
  let rounds = 0;
  let modelCalls = 0;

  // 外部 MCP 工具声明（懒加载一次；失败就当没有，不影响内置工具）
  let mcpDeclarations: Array<{ name: string; description: string; parameters: unknown }> = [];
  if (input.ctx.mcp) {
    try {
      mcpDeclarations = (await input.ctx.mcp.declarations()) ?? [];
    } catch (e) {
      console.warn(`[Agent] MCP 工具声明获取失败：${(e as Error).message}`);
      mcpDeclarations = [];
    }
  }

  // 最多 maxRounds 轮**工具**调用；每轮之后如果模型不再要工具就直接收尾，
  // 工具轮用尽后再给一次**不带工具**的收尾生成（让"工具失败后还能改口/补救"）。
  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    modelCalls++;
    const out = await input.callModel(messages, toolDeclarations(mcpDeclarations));
    if (typeof out?.text === 'string' && out.text.trim()) lastText = out.text;

    const calls = Array.isArray(out?.functionCalls) ? out.functionCalls : [];
    if (!calls.length) {
      return { text: lastText || (out?.text ?? ''), rounds, toolTrace, usedTools: toolTrace.length > 0 };
    }

    for (const c of calls) {
      if (totalCalls >= MAX_TOOL_CALLS) break;
      totalCalls++;
      const name = String(c?.name ?? '');
      const args = (c?.args ?? {}) as Record<string, unknown>;
      const exec = await executeTool(name, args, input.ctx);
      toolTrace.push({
        round, tool: name, args, ok: exec.ok, ms: exec.ms, resultPreview: clip(JSON.stringify(exec.result)),
      });
      messages.push({
        role: 'user',
        content: `[工具结果 ${name}] ${clip(JSON.stringify(exec.result), 800)}`,
      });
      console.log(`[AgentTool] r${round} ${name} ok=${exec.ok} ${exec.ms}ms ${clip(JSON.stringify(exec.result), 120)}`);
    }
  }

  // 收尾：不再给工具（有界），允许她基于工具结果说人话
  if (modelCalls < MAX_MODEL_CALLS) {
    const out = await input.callModel(messages, null);
    if (typeof out?.text === 'string' && out.text.trim()) lastText = out.text;
  }
  return { text: lastText, rounds, toolTrace, usedTools: toolTrace.length > 0 };
}
