import { describe, it, expect } from 'vitest';
import { PromptComposer, splitStrategyAndPermit, summarizeManifest } from '../promptComposer.js';

const PERMIT_A = '【这一轮你可以说一句自己（可选，不说也行）】\n- 你此刻有点沉。';
const PERMIT_B = '【你可以说一句自己（也可以不说）】\n- 你有点开心。';

describe('Prompt Composer（v2.02）', () => {
  it('单例类别：两份表达许可只保留一份，另一份标记 suppressed 且不进文本', () => {
    const c = new PromptComposer();
    c.add({ id: 'base', category: 'persona', priority: 100, text: '人格底座' });
    c.add({ id: 'permitA', category: 'expression_permit', priority: 40, text: PERMIT_A });
    c.add({ id: 'permitB', category: 'expression_permit', priority: 40, text: PERMIT_B });
    const { text, manifest } = c.compose();
    expect(text).toContain('你此刻有点沉');
    expect(text).not.toContain('你有点开心');
    expect(manifest.filter(m => m.category === 'expression_permit' && !m.suppressed)).toHaveLength(1);
    expect(manifest.find(m => m.id === 'permitB')!.suppressed).toBe(true);
  });

  it('高优先级可以顶替先到的许可；同优先级保留先到的', () => {
    const c = new PromptComposer();
    c.add({ id: 'low', category: 'expression_permit', priority: 40, text: PERMIT_A });
    c.add({ id: 'high', category: 'expression_permit', priority: 90, text: PERMIT_B });
    const { text } = c.compose();
    expect(text).toContain('你有点开心');
    expect(text).not.toContain('你此刻有点沉');
  });

  it('策略片段里夹带的表达许可会被拆出来，参与单例裁决', () => {
    const c = new PromptComposer();
    c.add({ id: 'base', category: 'persona', priority: 100, text: '人格底座' });
    c.addStrategySnippet(`【当前策略：安静陪着】\n先接住他。\n\n${PERMIT_A}`);
    c.add({ id: 'unified', category: 'expression_permit', priority: 40, text: PERMIT_B });
    const { text, manifest } = c.compose();
    expect(text).toContain('【当前策略：安静陪着】');
    expect(manifest.filter(m => m.category === 'strategy' && !m.suppressed)).toHaveLength(1);
    expect(manifest.filter(m => m.category === 'expression_permit' && !m.suppressed)).toHaveLength(1);
    // permitA 先到保留，unified 被抑制
    expect(text).not.toContain('你有点开心');
  });

  it('splitStrategyAndPermit 不误伤没有许可的策略片段', () => {
    expect(splitStrategyAndPermit('纯策略文本').permit).toBeNull();
    const r = splitStrategyAndPermit(`策略主体\n\n${PERMIT_B}`);
    expect(r.strategy).toBe('策略主体');
    expect(r.permit).toContain('你有点开心');
  });

  it('manifest 只含块元数据，不含正文；summary 可读', () => {
    const c = new PromptComposer();
    c.add({ id: 'base', category: 'persona', priority: 100, text: '很长的正文内容' });
    c.add({ id: 'permit', category: 'expression_permit', priority: 40, text: PERMIT_A });
    const manifest = c.getManifest();
    expect(JSON.stringify(manifest)).not.toContain('很长的正文内容');
    expect(manifest[0]).toMatchObject({ id: 'base', category: 'persona', chars: 7, suppressed: false });
    const summary = summarizeManifest(manifest);
    expect(summary).toContain('blocks=2');
    expect(summary).toContain('expressionPermits=1');
  });

  it('空文本块不会登记', () => {
    const c = new PromptComposer();
    c.add({ id: 'empty', category: 'tone', text: '   ' });
    expect(c.getManifest()).toHaveLength(0);
    expect(c.compose().text).toBe('');
  });
});
