import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendTurnTrace,
  buildTurnTrace,
  hashUserId,
  turnTraceEnabled,
  turnTracePath,
  TURN_TRACE_MAX_BYTES,
} from '../turnTrace.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'turn-trace-'));
}

describe('v2.20 脱敏 turn trace', () => {
  it('只存结构，不携带用户原话/回复/记忆/causeQuote', () => {
    const rec = buildTurnTrace({
      round: 7,
      userId: 'secret-user-123',
      prompt: { blocks: 12, chars: 3456, permits: 1, suppressed: ['expression_permit#old'] },
      strategy: 'accompany',
      conflictPhase: 'normal',
      plan: {
        decision: 'express', reason: 'express:sad(transient)', emotion: 'sad', tone: 'soft',
        duration: 'transient', evidence: 'low_period', maxSentences: 1, maxQuestions: 1, confidence: 0.6,
        // 调用方如果多传了内容字段，也不能被写进去
        causeQuote: '他说他今天特别难过',
      },
      intrinsic: { accepted: [{ type: 'reunion', eventId: 'e1' }], rejected: [{ reason: 'expired' }] },
      enforcement: { changed: true, changes: ['questions_capped:2->1'] },
      budget: null,
      memory: { injected: 2, sources: { episodic: 2 }, proactivePicked: false },
      motive: { kind: 'state', salience: 0.34 },
      agent: { rounds: 2, usedTools: true, tools: ['check_my_state'] },
      reply: { chars: 52, questionMarks: 1 },
    } as never);

    const json = JSON.stringify(rec);
    expect(json).not.toContain('secret-user-123');
    expect(json).not.toContain('他说他今天特别难过');
    expect(json).not.toContain('causeQuote');
    expect(rec.user).toBe(hashUserId('secret-user-123'));
    expect(rec.user).toMatch(/^[a-f0-9]{8}$/);
    expect(rec.plan).toMatchObject({ decision: 'express', duration: 'transient' });
    expect(rec.intrinsic).toEqual({ accepted: ['reunion'], rejected: ['expired'] });
    expect(rec.budget).toBeNull();
  });

  it('appendTurnTrace 追加 JSONL 行', () => {
    const dir = tmpDir();
    try {
      const file = join(dir, 'turn_trace.jsonl');
      expect(appendTurnTrace(buildTurnTrace({ round: 1 }), { file })).toBe(true);
      expect(appendTurnTrace(buildTurnTrace({ round: 2 }), { file })).toBe(true);
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[1]).round).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('超过上限会轮转，且只保留 keep 份', () => {
    const dir = tmpDir();
    try {
      const file = join(dir, 'turn_trace.jsonl');
      // 每行约 300+ 字节；maxBytes 设小，保证多次触发轮转
      for (let i = 0; i < 40; i++) {
        appendTurnTrace(buildTurnTrace({ round: i }), { file, maxBytes: 600, keep: 2 });
      }
      const rots = readdirSync(dir).filter(f => f.startsWith('turn_trace.jsonl.rot-'));
      expect(rots.length).toBeLessThanOrEqual(2);
      expect(rots.length).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('路径：MEMORIES_DIR / TURN_TRACE_FILE；开关默认开、false 可关', () => {
    expect(turnTraceEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(turnTraceEnabled({ ENABLE_TURN_TRACE: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(turnTracePath({ MEMORIES_DIR: 'D:/tmp/mem' } as unknown as NodeJS.ProcessEnv))
      .toContain('turn_trace.jsonl');
    expect(turnTracePath({ TURN_TRACE_FILE: 'D:/x/custom.jsonl' } as unknown as NodeJS.ProcessEnv))
      .toBe('D:/x/custom.jsonl');
    expect(TURN_TRACE_MAX_BYTES).toBeGreaterThan(0);
  });

  it('写入失败不抛（返回 false）', () => {
    // 用一个非法路径（父级是文件）模拟失败
    const dir = tmpDir();
    try {
      const asFile = join(dir, 'not-a-dir');
      appendTurnTrace(buildTurnTrace({}), { file: asFile }); // 先创建一个文件
      const ok = appendTurnTrace(buildTurnTrace({}), { file: join(asFile, 'x.jsonl') });
      expect(ok).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
