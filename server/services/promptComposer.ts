/**
 * v2.02：Prompt Composer —— 每轮只产出一份有优先级、可追溯的最终 system prompt。
 *
 * 为什么需要它（harness 建议第 3 条）：
 *   现在 `server.ts` 在不同位置 `enrichedSystemPrompt += ...` 追加人格/记忆/动机/策略/活动/状态/评价片段。
 *   灵活，但两个模块可能各自给模型一份相近甚至冲突的"表达许可"（v1.60 的"可以说一句自己"、
 *   v1.64 的叠加式表达、v1.65 的统一表达）。这里不重写决策链，只做三件事：
 *     1) 给每个块一个类别 + 优先级 + 来源（可观测）；
 *     2) **同类别最多保留一份**（expression_permit / strategy / intent），其余标记 suppressed 并不拼进去；
 *     3) 输出 manifest（只含块名/类别/字数/是否被抑制，不含正文）供 trace 与 /api/diagnostics 使用。
 *
 * 刻意不做：不改变块的原有顺序与内容；不把每一步拆成转发参数的小模块；不做第二套策略判断。
 */

export type BlockCategory =
  | 'hard'         // 安全/边界/自检（永不被抑制）
  | 'persona'      // 人格底座
  | 'facts'        // 证据/记忆/活动/搜索结果
  | 'strategy'     // 本轮主策略
  | 'intent'       // 动机（她想说什么）
  | 'expression_permit' // 允许她"说一句自己"（**最多一份**）
  | 'tone'         // 语气/反机械化/心情/小屋/评价
  | 'misc';

export interface PromptBlockInput {
  id: string;
  category: BlockCategory;
  /** 数字越大越优先（同类别冲突时保留大的；相同则保留先加入的） */
  priority?: number;
  text: string;
  source?: string;
}

export interface PromptBlockRecord {
  id: string;
  category: BlockCategory;
  priority: number;
  chars: number;
  source: string;
  /** true = 检测到同类冲突，这一块没有拼进最终 prompt */
  suppressed: boolean;
}

/** 表达许可的"标记"：策略片段里可能夹带它（v1.60 / v1.64），用于拆分与冲突检测。 */
const EXPRESSION_MARKERS = [
  '【这一轮你可以说一句自己',
  '【你可以说一句自己',
  '【允许你说一句自己',
  '【你可以说一句自己（也可以不说）】',
];

function looksLikeExpressionPermit(text: string): boolean {
  return EXPRESSION_MARKERS.some(m => text.includes(m));
}

/**
 * 把一段策略文本拆成「策略主体」与「表达许可」。没有标记时原样返回 strategy。
 * 只按标记第一次出现切分；保留两块之间的换行。
 */
export function splitStrategyAndPermit(text: string): { strategy: string; permit: string | null } {
  if (!text || !looksLikeExpressionPermit(text)) return { strategy: text, permit: null };
  let cut = -1;
  for (const m of EXPRESSION_MARKERS) {
    const i = text.indexOf(m);
    if (i >= 0 && (cut < 0 || i < cut)) cut = i;
  }
  if (cut <= 0) return { strategy: text, permit: null };
  return { strategy: text.slice(0, cut).trimEnd(), permit: text.slice(cut).trim() };
}

export class PromptComposer {
  private blocks: Array<PromptBlockInput & { accepted: boolean }> = [];
  private seenUnique = new Map<BlockCategory, string>();

  /** 单例类别：同类只能留一份 */
  private static readonly SINGLETON: ReadonlySet<BlockCategory> = new Set(['strategy', 'intent', 'expression_permit']);

  add(block: PromptBlockInput): this {
    const text = String(block.text ?? '');
    if (!text.trim()) return this;
    const priority = Number.isFinite(block.priority) ? Number(block.priority) : 0;
    const accepted = this.canAccept(block.category, priority);
    const prevHolderId = this.seenUnique.get(block.category);
    this.blocks.push({ ...block, text, priority, accepted });
    if (accepted && PromptComposer.SINGLETON.has(block.category)) {
      // 高优先级顶替：把旧的那份标记为未接受（否则 manifest 里会出现两份"已接受"）
      if (prevHolderId && prevHolderId !== block.id) {
        const prev = this.blocks.find(b => b.id === prevHolderId && b.accepted);
        if (prev) prev.accepted = false;
      }
      this.seenUnique.set(block.category, block.id);
    }
    return this;
  }

  /** 策略片段可能夹带表达许可：拆开分别登记，避免"策略 + 两份许可"悄悄进 Prompt。 */
  addStrategySnippet(text: string, source = 'aiCoordinator.strategySnippet'): this {
    const { strategy, permit } = splitStrategyAndPermit(text);
    if (strategy) this.add({ id: 'strategy', category: 'strategy', priority: 60, text: strategy, source });
    if (permit) this.add({ id: 'expression_permit', category: 'expression_permit', priority: 40, text: permit, source: `${source}#permit` });
    return this;
  }

  private canAccept(category: BlockCategory, priority: number): boolean {
    if (!PromptComposer.SINGLETON.has(category)) return true;
    const holderId = this.seenUnique.get(category);
    if (!holderId) return true;
    const holder = this.blocks.find(b => b.id === holderId && b.accepted);
    if (!holder) return true;
    // 高优先级可顶替；同优先级保留先到的
    return priority > holder.priority;
  }

  /** 最终文本 = 已接受块按加入顺序拼接（保持原行为；被抑制的块不出现） */
  compose(): { text: string; manifest: PromptBlockRecord[] } {
    const accepted = this.blocks.filter(b => b.accepted);
    const text = accepted.map(b => b.text).join('\n\n');
    const manifest = this.blocks.map(b => ({
      id: b.id,
      category: b.category,
      priority: b.priority,
      chars: b.text.length,
      source: b.source ?? '',
      suppressed: !b.accepted,
    }));
    return { text, manifest };
  }

  /** 供测试/诊断：当前是否已有一份表达许可 */
  hasExpressionPermit(): boolean {
    return this.blocks.some(b => b.accepted && b.category === 'expression_permit');
  }

  getManifest(): PromptBlockRecord[] {
    return this.compose().manifest;
  }
}

/** 给日志/诊断的一行人话（不含正文） */
export function summarizeManifest(manifest: PromptBlockRecord[]): string {
  const total = manifest.filter(m => !m.suppressed).reduce((n, m) => n + m.chars, 0);
  const permits = manifest.filter(m => m.category === 'expression_permit' && !m.suppressed).length;
  const suppressed = manifest.filter(m => m.suppressed).map(m => `${m.category}:${m.id}`);
  return `blocks=${manifest.length} chars=${total} expressionPermits=${permits}`
    + (suppressed.length ? ` suppressed=${suppressed.join(',')}` : '');
}
