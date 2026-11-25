import { describe, expect, it } from 'vitest';
import { enforceDeferredMemoryWriteReply, shouldSkipAutomaticMemoryWrite } from '../memoryWriteGuard.js';

describe('明确延后记忆的请求', () => {
  it('先核实来源再决定是否记忆时延后自动写入', () => {
    expect(shouldSkipAutomaticMemoryWrite('这次请先确认来源，再决定要不要记。')).toBe(true);
  });

  it('普通记忆请求不被误判为延后', () => {
    expect(shouldSkipAutomaticMemoryWrite('请记住我喜欢喝拿铁。')).toBe(false);
    expect(shouldSkipAutomaticMemoryWrite('今天杭州下雨了。')).toBe(false);
    expect(shouldSkipAutomaticMemoryWrite('我不是不要记录这件事，而是想先问清楚。')).toBe(false);
  });

  it('明确拒绝记忆也阻断自动提炼，但双重否定不误判', () => {
    expect(shouldSkipAutomaticMemoryWrite('请不要把这条记录成我的长期偏好。')).toBe(true);
    expect(shouldSkipAutomaticMemoryWrite('这个只是临时想法，别记住。')).toBe(true);
    expect(enforceDeferredMemoryWriteReply('好，我记下了。', '请不要把这条记录成我的长期偏好。').text)
      .toBe('好，这条不会写成你的个人事实或长期记忆。');
  });

  it('用确定回复消除与“我记下了”相矛盾的承诺', () => {
    const result = enforceDeferredMemoryWriteReply(
      '好，我记下了。',
      '这次请先确认来源，再决定要不要记。',
      '那是我朋友说的，不是我。你之前已经把这件事记到我身上一次了。',
    );

    expect(result.changed).toBe(true);
    expect(result.text).toContain('朋友的话归到你身上');
    expect(result.text).toContain('本轮不会把它写成你的个人事实或长期记忆');
    expect(result.text).not.toContain('我记下了');
  });

  it('没有来源证据时不声称自己已经核查或即将主动核查', () => {
    const result = enforceDeferredMemoryWriteReply(
      '好的。',
      '这条信息先确认来源，再决定是否记下来。',
    );

    expect(result.text).toContain('目前没有可核实的来源');
    expect(result.text).toContain('你补充可核实来源后');
    expect(result.text).not.toContain('我会先核对来源');
  });
});
