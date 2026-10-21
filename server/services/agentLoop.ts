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

export const MAX_AGENT_ROUNDS = 2;      // 最多 2 轮**工具**调用
export const MAX_MODEL_CALLS = 3;      // 2 轮工具 + 1 次收尾生成（总模型调用上限）
export const MAX_TOOL_CALLS = 4;

export function agentToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_AGENT_TOOLS === 'true';
}

export type ToolName = 'check_my_state' | 'recall_recent_events' | 'recall_memory' | 'time_now' | 'remember_this' | 'set_followup';

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
}

/** 给 provider 的函数声明（Gemini 的 functionDeclarations 形状） */
export function toolDeclarations(): unknown[] {
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
            },
            required: ['note'],
          },
        },
        {
          name: 'set_followup',
          description: '安排一条"到点再问"：到时间后你会主动发一条消息，内容就是这句话。**当他说"明天提醒我/记得问我/到时候提醒我"时，必须调用本工具排一条**，不要只在嘴上答应。',
          parameters: {
            type: 'object',
            properties: {
              what: { type: 'string', description: '到点想说的那句话（4~120 字）' },
              dueAtLocal: { type: 'string', description: '他说了具体时间就填这里，格式 YYYY-MM-DDTHH:mm（本地时间，如 2026-10-23T15:00）。**优先用它，别自己算小时**' },
              dueInHours: { type: 'number', description: '没说具体时间时才用：几小时后发出，0.5~72' },
            },
            required: ['what', 'dueInHours'],
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
    if (name === 'check_my_state') {
      const result = ctx.getState();
      return { ok: true, result, ms: Date.now() - t0 };
    }
    if (name === 'remember_this') {
      const note = String(args?.note ?? '').trim();
      if (!ctx.writeNote) return { ok: false, result: { error: 'notes_disabled（便签没开）' }, ms: Date.now() - t0 };
      const r = ctx.writeNote(note);
      return { ok: r.ok, result: r, ms: Date.now() - t0 };
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

  // 最多 maxRounds 轮**工具**调用；每轮之后如果模型不再要工具就直接收尾，
  // 工具轮用尽后再给一次**不带工具**的收尾生成（让"工具失败后还能改口/补救"）。
  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    modelCalls++;
    const out = await input.callModel(messages, toolDeclarations());
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
