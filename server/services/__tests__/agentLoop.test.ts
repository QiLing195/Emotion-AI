import { describe, it, expect } from 'vitest';
import {
  MAX_AGENT_ROUNDS,
  agentToolsEnabled,
  executeTool,
  runAgentLoop,
  toolDeclarations,
} from '../agentLoop.js';

const ctx = {
  getState: () => ({ emotion: { top: 'sad', delta: 0.18 }, lowPeriod: { active: true, turns: 3 }, room: { activity: '在听一首老歌' } }),
  getRecentEvents: (limit?: number) => Array.from({ length: Math.min(10, limit ?? 5) }, (_, i) => ({ round: i + 1, kind: 'state_change' })),
  recallMemory: (query: string, limit?: number) => Array.from({ length: Math.min(5, limit ?? 3) }, (_, i) => ({ summary: `${query} 相关记忆 ${i + 1}` })),
  getTime: () => ({ iso: '2026-10-21T14:00:00.000Z', local: '2026/10/21 22:00:00', weekday: '周三' }),
  writeNote: (note: string) => (note.length >= 4 ? { ok: true, count: 1 } : { ok: false, reason: 'too_short' }),
  addFollowup: (what: string, hours: number) => (hours > 0 && hours <= 72 ? { ok: true, dueAt: Date.now() + hours * 3600_000 } : { ok: false, reason: 'due_in_hours_out_of_range' }),
};

describe('开关与工具声明', () => {
  it('默认关，显式 true 才开', () => {
    expect(agentToolsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(agentToolsEnabled({ ENABLE_AGENT_TOOLS: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('声明里恰好有两个只读工具，且都带说明', () => {
    const decls = toolDeclarations() as Array<{ functionDeclarations: Array<{ name: string; description: string }> }>;
    const names = decls[0].functionDeclarations.map(d => d.name);
    expect(names).toEqual(['check_my_state', 'recall_memory', 'time_now', 'remember_this', 'set_followup', 'recall_recent_events']);
    for (const d of decls[0].functionDeclarations) expect(d.description.length).toBeGreaterThan(10);
  });
});

describe('工具执行（纯本地、失败不抛错）', () => {
  it('check_my_state 返回她此刻的状态', async () => {
    const r = await executeTool('check_my_state', {}, ctx);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.result)).toContain('sad');
  });

  it('recall_recent_events 的 limit 被夹到 1~10', async () => {
    const big = await executeTool('recall_recent_events', { limit: 999 }, ctx);
    expect((big.result as unknown[]).length).toBe(10);
    const small = await executeTool('recall_recent_events', { limit: 0 }, ctx);
    expect((small.result as unknown[]).length).toBe(1);
  });

  it('未知工具 ⇒ ok=false，不抛错', async () => {
    const r = await executeTool('rm_rf', {}, ctx);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain('unknown_tool');
  });
});

describe('有界循环', () => {
  it('模型不请求工具 ⇒ 只调一次模型，无 trace', async () => {
    let calls = 0;
    const out = await runAgentLoop({
      systemPrompt: 's', userMessage: '在吗', recentMessages: [], ctx,
      callModel: async () => { calls++; return { text: '在。' }; },
    });
    expect(calls).toBe(1);
    expect(out.text).toBe('在。');
    expect(out.usedTools).toBe(false);
    expect(out.toolTrace).toHaveLength(0);
  });

  it('模型请求 check_my_state ⇒ 执行、回灌、第二轮出最终文本', async () => {
    let calls = 0;
    const seen: string[] = [];
    const out = await runAgentLoop({
      systemPrompt: 's', userMessage: '你现在心情怎么样？', recentMessages: [], ctx,
      callModel: async (messages) => {
        calls++;
        if (calls === 1) return { text: '', functionCalls: [{ name: 'check_my_state', args: {} }] };
        seen.push(messages[messages.length - 1].content);
        return { text: '有点闷。' };
      },
    });
    expect(calls).toBe(2);
    expect(out.usedTools).toBe(true);
    expect(out.toolTrace[0].tool).toBe('check_my_state');
    expect(seen[0]).toContain('[工具结果 check_my_state]');
    expect(out.text).toBe('有点闷。');
  });

  it('第二轮仍请求工具 ⇒ 不再执行（有界），用最后一轮文本收尾', async () => {
    let calls = 0;
    const out = await runAgentLoop({
      systemPrompt: 's', userMessage: 'x', recentMessages: [], ctx,
      callModel: async () => { calls++; return { text: `第${calls}次`, functionCalls: [{ name: 'check_my_state' }] }; },
    });
    expect(calls).toBe(MAX_AGENT_ROUNDS);
    expect(out.rounds).toBe(MAX_AGENT_ROUNDS);
    expect(out.text).toBe(`第${MAX_AGENT_ROUNDS}次`);
    // 只在第一轮真执行了工具
    expect(out.toolTrace.every(t => t.round === 1)).toBe(true);
  });

  it('工具失败也回灌（她能看到"没查到"），循环不中断', async () => {
    const out = await runAgentLoop({
      systemPrompt: 's', userMessage: 'x', recentMessages: [], ctx,
      callModel: async (_m, tools) => (tools
        ? { text: '', functionCalls: [{ name: 'not_a_tool' }] }
        : { text: '嗯，我不太确定。' }),
    });
    expect(out.toolTrace[0].ok).toBe(false);
    expect(out.text).toBe('嗯，我不太确定。');
  });
});

describe('新增只读工具：recall_memory / time_now', () => {
  it('recall_memory 有结果时返回记忆摘要', async () => {
    const r = await executeTool('recall_memory', { query: '面试', limit: 2 }, ctx);
    expect(r.ok).toBe(true);
    expect((r.result as unknown[]).length).toBe(2);
    expect(JSON.stringify(r.result)).toContain('面试');
  });

  it('recall_memory 没结果时如实说"没检索到"（不是编）', async () => {
    const r = await executeTool('recall_memory', { query: '不存在的话题' }, { ...ctx, recallMemory: () => [] });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.result)).toContain('没检索到');
  });

  it('recall_memory 缺少 query ⇒ ok=false', async () => {
    const r = await executeTool('recall_memory', {}, ctx);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain('missing_query');
  });

  it('time_now 返回本地时间与星期', async () => {
    const r = await executeTool('time_now', {}, ctx);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.result)).toContain('周三');
  });
});
describe('写类工具：remember_this / set_followup（必须经审计层）', () => {
  it('remember_this 正常写入返回 ok', async () => {
    const r = await executeTool('remember_this', { note: '他说下周体检，记得问' }, ctx);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.result)).toContain('"ok":true');
  });

  it('remember_this 太短 ⇒ ok=false（不静默写垃圾）', async () => {
    const r = await executeTool('remember_this', { note: '嗯' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('没有接审计层 ⇒ 明确报 disabled，而不是假装成功', async () => {
    const r = await executeTool('remember_this', { note: '记一条' }, { ...ctx, writeNote: undefined });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain('notes_disabled');
  });

  it('set_followup 合法时间 ⇒ ok 且带 dueAt', async () => {
    const r = await executeTool('set_followup', { what: '明天问问面试结果', dueInHours: 12 }, ctx);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.result)).toContain('dueAt');
  });

  it('set_followup 时间越界 ⇒ ok=false', async () => {
    const r = await executeTool('set_followup', { what: '回头问', dueInHours: 999 }, ctx);
    expect(r.ok).toBe(false);
  });
});