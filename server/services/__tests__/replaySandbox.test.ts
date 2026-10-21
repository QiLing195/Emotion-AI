import { describe, it, expect } from 'vitest';
import { forcedBranch, sandboxEnabled, runSandboxReplay } from '../replaySandbox.js';

describe('开关与强制分支解析（默认关、只认三个合法值）', () => {
  it('沙盒默认关，显式 true 才开', () => {
    expect(sandboxEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(sandboxEnabled({ ENABLE_SANDBOX_REPLAY: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(sandboxEnabled({ ENABLE_SANDBOX_REPLAY: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('REPLAY_FORCE_BRANCH 只接受 silence/voice/voice_with_cause', () => {
    expect(forcedBranch({} as NodeJS.ProcessEnv)).toBeNull();
    expect(forcedBranch({ REPLAY_FORCE_BRANCH: 'silence' } as NodeJS.ProcessEnv)).toBe('silence');
    expect(forcedBranch({ REPLAY_FORCE_BRANCH: 'voice' } as NodeJS.ProcessEnv)).toBe('voice');
    expect(forcedBranch({ REPLAY_FORCE_BRANCH: 'voice_with_cause' } as NodeJS.ProcessEnv)).toBe('voice_with_cause');
    expect(forcedBranch({ REPLAY_FORCE_BRANCH: 'anything' } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('入参校验（不真起进程）', () => {
  it('没有他的话 ⇒ 明确拒绝，不启沙盒', async () => {
    const r = await runSandboxReplay({ hisMessages: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('hisMessages_empty');
    expect(r.runs).toHaveLength(0);
  });

  it('消息数超上限被截到 3 条；非法 choices 被过滤 ⇒ 拒绝', async () => {
    const empty = await runSandboxReplay({
      hisMessages: ['a', '', 'b', 'c', 'd'],
      choices: ['bogus' as never],
    });
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('choices_invalid');
    expect(empty.hisMessages).toHaveLength(3);
  });

  it('返回结构里带 limitations（说明隔离与不回档；用非法 choices 避免真起进程）', async () => {
    const r = await runSandboxReplay({ hisMessages: ['在吗'], choices: ['bogus' as never] });
    expect(r.limitations.some(l => l.includes('不写线上'))).toBe(true);
  });
});
