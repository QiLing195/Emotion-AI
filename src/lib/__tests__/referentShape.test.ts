// ── v1.56 「指代消歧」：单测 ──
//
// 病灶（v1.55 量出）：原话「你想问他什么，问的应该是**这件事**的具体下文」里的「这件事」
// **没有指代** ⇒ 模型把它解析成**他刚说的那件**（阳台 24/24），而**她挂的那件**（海）**0/24**。
//
// 这一跑的唯一变量：把"谁的事"说清 ＋ 行动从"问他它的下文"改成"我自己说出来"。
// 必须锁死：①开关默认关 ②关着时逐字旧行为 ③开着时**不许出现无指代的「这件事」**
//           ④内容在场 ⑤与理由形状互不干扰 ⑥不加理由（v1.55 已验证无效的变量不能混进来）

import { describe, it, expect, afterEach } from 'vitest';
import { motiveReferentShapeEnabled, motiveReasonShapeEnabled, motiveToPromptSnippet } from '../motive';
import type { Motive } from '../motive';

// v1.56 已上线：默认**开**，`DISABLE_MOTIVE_REFERENT_SHAPE=true` 才回退
const KEY = 'DISABLE_MOTIVE_REFERENT_SHAPE';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});
const on = () => { delete process.env[KEY]; };
const off = () => { process.env[KEY] = 'true'; };

const CONTENT = '我想起他说过「等这个项目结束，我想去趟海边」';
const sel = { id: 'm1', kind: 'memory_echo', content: CONTENT, salience: 0.62 } as unknown as Motive;

describe('v1.56 指代消歧', () => {
  it('**已上线：默认开**；只有 DISABLE_MOTIVE_REFERENT_SHAPE=true 才回退', () => {
    on();
    expect(motiveReferentShapeEnabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'false']) { process.env[KEY] = v; expect(motiveReferentShapeEnabled(), v).toBe(true); }
    off();
    expect(motiveReferentShapeEnabled()).toBe(false);
  });

  it('回退（DISABLE=true）= 逐字旧行为（「这件事」无指代 —— 这就是要修的 bug）', () => {
    off();
    const s = motiveToPromptSnippet(sel);
    expect(s).toContain('这件事');
    expect(s).toContain('问的应该是这件事的具体下文');
  });

  it('开着：指代由**内容本身**锚定 —— 一个无指代的「这件事」都不许有', () => {
    on();
    const s = motiveToPromptSnippet(sel);
    expect(s).toContain(CONTENT);                       // 内容在场
    expect(s).toContain('我自己');                       // 说清是谁的事
    expect(s).toContain('想把它说出来');                 // 行动 = 说出来（不是问他）
    expect(s).not.toContain('这件事');                   // ← 本开关的核心守卫
    expect(s).not.toContain('问的应该是');               // ← 旧那句"问他下文"必须消失
  });

  it('⚠️ open_loop / worry **不**套用（它们的"这件事"本来就是**他的**，套上就说反了）', () => {
    on();
    for (const kind of ['open_loop', 'worry'] as const) {
      const s = motiveToPromptSnippet({ id: 'x', kind, content: '他面试那事有消息了吗', salience: 0.8 } as unknown as Motive);
      expect(s, kind).not.toContain('我自己心里挂着的就是');
      expect(s, kind).toContain('问的应该是这件事的具体下文');   // 对他那类**本来就是对的**，逐字不动
    }
  });

  it('开着时**不加理由**（v1.55 的变量已证无效，不能混进来）', () => {
    on();
    const s = motiveToPromptSnippet(sel);
    expect(s).not.toContain('因为');
    expect(s).not.toContain('表达倾向');
  });

  it('两个开关互不干扰：同时开时指代形状优先，关掉指代仍是理由形状', () => {
    on();
    process.env.ENABLE_MOTIVE_REASON_SHAPE = 'true';
    expect(motiveToPromptSnippet(sel)).not.toContain('这件事');   // 指代优先
    delete process.env.ENABLE_MOTIVE_REASON_SHAPE;
    expect(motiveToPromptSnippet(sel)).not.toContain('这件事');
    process.env.ENABLE_MOTIVE_REASON_SHAPE = 'true';
    off();
    expect(motiveReasonShapeEnabled()).toBe(true);
    expect(motiveToPromptSnippet(sel)).toContain('因为');          // 关掉指代后 → 理由形状
    delete process.env.ENABLE_MOTIVE_REASON_SHAPE;
  });
});
