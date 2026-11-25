/**
 * Memory-write boundary for explicit "check first, then decide whether to remember" requests.
 * Chat transcript persistence is separate; this guard controls automatic long-term episode capture
 * and claims in the assistant's visible reply.
 */

export function isExplicitNoMemoryWriteRequest(userText: string): boolean {
  const text = String(userText ?? '').replace(/[\s，,。；;！!？?]/gu, '');
  const negatedRefusal = /(?:不是|并非)(?:不|不要|不想|不希望|不必|无需)/u.test(text);
  return !negatedRefusal
    && /(?:(?<!要)不要|别|不必|无需|不需要|不用|不想|不希望|请勿).{0,12}(?:记(?:住|下)?|记录|保存|存下来|写入记忆|加入记忆)/u.test(text);
}

export function shouldSkipAutomaticMemoryWrite(userText: string): boolean {
  const text = String(userText ?? '').replace(/[\s，,。；;！!？?]/gu, '');
  if (isExplicitNoMemoryWriteRequest(userText)) return true;
  const hasRememberAction = /(?:记(?:住|下)?|记录|保存|存下来|写入记忆|加入记忆)/u.test(text);
  if (!hasRememberAction) return false;

  return /(?:先|等|待).{0,24}(?:确认|核实|查清|弄清|验证|确定).{0,28}(?:再|之后|以后|然后).{0,16}(?:决定|判断|考虑|看).{0,12}(?:要不要|是否|记不记|记录|保存|记住|写入)/u.test(text)
    || /(?:确认|核实|查清|弄清|验证|确定).{0,24}(?:来源|归属|是谁说的).{0,24}(?:再|之后|以后).{0,16}(?:决定|判断|考虑).{0,12}(?:要不要|是否|记不记|记录|保存|记住)/u.test(text)
    || /(?:先别|暂时不要|暂不|先不).{0,12}(?:记住|记下|记录|保存|写入记忆)/u.test(text);
}

export function enforceDeferredMemoryWriteReply(
  candidate: string,
  userText: string,
  priorContext = '',
): { text: string; changed: boolean; changes: string[] } {
  if (!shouldSkipAutomaticMemoryWrite(userText)) {
    return { text: candidate, changed: false, changes: [] };
  }

  const correctedPriorAttribution = /(?:不是我|我朋友说的|朋友说的).{0,32}(?:记到我身上|归到我|算到我)|(?:记到我身上|归到我|算到我).{0,32}(?:一次|之前|又)/u.test(priorContext);
  if (isExplicitNoMemoryWriteRequest(userText)) {
    return {
      text: '好，这条不会写成你的个人事实或长期记忆。',
      changed: true,
      changes: ['explicit_no_memory_write'],
    };
  }
  const apology = correctedPriorAttribution
    ? '你提醒得对，我之前把朋友的话归到你身上了，对不起。'
    : '';
  const sourceWasProvided = /(?:朋友|同事|家人|他说|她说).{0,20}(?:不是我|不是你|不代表我|不代表你)|(?:不是我|不代表我).{0,20}(?:朋友|同事|家人)/u.test(priorContext);
  const source = sourceWasProvided
    ? '按你提供的对话，这句话来自另一位说话者，不是你的个人偏好。'
    : '目前没有可核实的来源，我先不把它归到你名下。';
  const nextStep = sourceWasProvided
    ? '核实后再决定是否记录。'
    : '你补充可核实来源后，我们再决定是否记录。';
  return {
    text: `${apology}${source}本轮不会把它写成你的个人事实或长期记忆；${nextStep}`,
    changed: true,
    changes: ['deferred_memory_write_no_persist_claim'],
  };
}
