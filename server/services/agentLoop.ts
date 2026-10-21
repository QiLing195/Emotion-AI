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

export const MAX_AGENT_ROUNDS = 2;
export const MAX_TOOL_CALLS = 4;

export function agentToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_AGENT_TOOLS === 'true';
}

export type ToolName = 'check_my_state' | 'recall_recent_events';

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

  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    // 最后一轮不再给工具（有界收尾，避免"还想查"）
    const tools = round < maxRounds ? toolDeclarations() : null;
    const out = await input.callModel(messages, tools);
    if (typeof out?.text === 'string' && out.text.trim()) lastText = out.text;

    const calls = Array.isArray(out?.functionCalls) ? out.functionCalls : [];
    if (!calls.length || round >= maxRounds) {
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
  return { text: lastText, rounds, toolTrace, usedTools: toolTrace.length > 0 };
}
