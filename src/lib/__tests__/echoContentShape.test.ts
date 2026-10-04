// ── v1.54 `memory_echo` 的内容形态：从**记忆原文**造句，而不是把元指令贴上"我想起" ──
//
// 病灶（v1.50b 追到根）：`memoryEchoMotive()` 的入参是 `generateProactiveInjection()` 产出的
// **给模型看的元指令**（「【主动回忆·轻柔】你忽然想起三周前，当时他说"…"…不需要追问，只是轻轻提起。」），
// 旧代码把它截 60 字、前面加"我想起"就当成了**她此刻想说的话**：
//     `我想起【主动回忆·轻柔】你忽然想起三周前，当时他说"今天下午把阳台收拾了一下…`
// ⇒ 那不是一句话，是一段指令（还带【】与引号）；模型接不上（三跑 ~40 格零次），
//   而 `curious_followup` 那一档的指令里**自带问句范例**（"后来呢？/那个事情现在怎么样了？"）。
//
// 必须锁死：①开关默认关（关着时逐字旧行为）②开着且给原文时，内容里**不许**出现指令的痕迹
//           ③没给原文时向后兼容（走旧路）④空输入仍返回 null

import { describe, it, expect, afterEach } from 'vitest';
import { echoLineFromSummaryEnabled, memoryEchoMotive } from '../motive';

const KEY = 'ENABLE_ECHO_LINE_FROM_SUMMARY';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});
const on = () => { process.env[KEY] = 'true'; };
const off = () => { delete process.env[KEY]; };

/** 真实形态的元指令（与 `generateProactiveInjection` 同形） */
const INJECTION = '【主动回忆·好奇】你想起三周前他提到"等这个项目结束，我想去趟海边"，那时候的感觉很好。'
  + '如果你觉得自然，可以好奇地追问一句——"后来呢？"或"那个事情现在怎么样了？"。让他感受到你真的在乎。';
const SUMMARY = '等这个项目结束，我想去趟海边';

describe('v1.54 memory_echo 的内容形态（从记忆原文造句）', () => {
  it('开关默认关；只认字面 true', () => {
    off();
    expect(echoLineFromSummaryEnabled()).toBe(false);
    process.env[KEY] = '1';
    expect(echoLineFromSummaryEnabled()).toBe(false);
    on();
    expect(echoLineFromSummaryEnabled()).toBe(true);
  });

  it('关着 = 逐字旧行为（元指令被当成她想说的话 —— 这就是要修的 bug）', () => {
    off();
    const echo = memoryEchoMotive(INJECTION, 'ep_1', SUMMARY)!;
    expect(echo.content.startsWith('我想起')).toBe(true);
    expect(echo.content).toContain('【主动回忆');           // ← bug 本体
    expect(echo.content).toContain('可以好奇地追问');        // ← 指令里的**问句范例**也进来了
    // 60 字上限还会把指令**从中间截断**（截到"可以好奇地追问一"）—— 连一段完整指令都不是
    expect([...echo.content].length).toBeLessThan(70);   // 「我想起」+ 旧代码的 `slice(0, 60)`
    expect(echo.content.endsWith('。')).toBe(false);
  });

  it('开着：用记忆原文造句，指令的痕迹一个都不留', () => {
    on();
    const echo = memoryEchoMotive(INJECTION, 'ep_1', SUMMARY)!;
    expect(echo.kind).toBe('memory_echo');
    expect(echo.source?.memoryId).toBe('ep_1');
    expect(echo.content).toContain(SUMMARY.slice(0, 8));     // 她记着的是**那件事**
    for (const junk of ['【主动回忆', '不需要追问', '后来呢', '让他感受到', '你觉得自然']) {
      expect(echo.content, junk).not.toContain(junk);
    }
  });

  it('开着但没给原文 ⇒ 向后兼容（走旧路）；两边都空 ⇒ null', () => {
    on();
    expect(memoryEchoMotive(INJECTION, 'ep_1')!.content).toContain('【主动回忆');
    // ⚠️ "注入文本为空 + 有记忆原文"这一态**生产里不会出现**（调用点先判 `injectionText` 非空）。
    //    此时的正确语义是"我们手里**有**那件事的原文 ⇒ 就有可说的东西" ⇒ 给非空，
    //    而不是回到旧路去拿一段空气。
    expect(memoryEchoMotive('   ', 'ep_1', SUMMARY)).not.toBeNull();
    expect(memoryEchoMotive('   ', 'ep_1', SUMMARY)!.content).toContain('海边');
    // 两边都空 ⇒ 才真的是"没有素材" ⇒ null
    expect(memoryEchoMotive('', 'ep_1', '   ')).toBeNull();
    expect(memoryEchoMotive('   ')).toBeNull();
  });

  it('内容长度可控（不会把 60 字指令整段塞进末尾那个高注意力块）', () => {
    on();
    const long = '等这个项目结束，我想去趟海边，然后顺便把一直想去的那家店也走一遍，再看看有没有别的';
    const echo = memoryEchoMotive(INJECTION, 'ep_1', long)!;
    expect([...echo.content].length).toBeLessThanOrEqual(40);
  });
});
