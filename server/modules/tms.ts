// @ts-nocheck
// TMS + 范式管理 (从 server.ts L954-1103 抽取, 150行)

import type { ServerContext } from './context.js';

export function detectTMSConflicts(ctx: ServerContext): void {
    const activeBeliefs = ctx.worldModel.beliefs.filter((b: any) => b.status !== 'archived');
    if (activeBeliefs.length < 2) return;
    for (let i = 0; i < activeBeliefs.length; i++) {
        for (let j = i + 1; j < activeBeliefs.length; j++) {
            const a = activeBeliefs[i], b = activeBeliefs[j];
            const tension = (a as any).consequent !== (b as any).consequent &&
                (a as any).antecedent === (b as any).antecedent ? 0.8 :
                (a as any).consequent.includes('疏远') && (b as any).consequent.includes('关怀') ? 0.9 :
                (a as any).consequent.includes('信任') && (b as any).consequent.includes('抛弃') ? 0.9 : 0;
            if (tension > 0.5) {
                const exists = ctx.worldModel.tmsConflicts?.find((c: any) =>
                    (c.a === (a as any).id && c.b === (b as any).id) || (c.a === (b as any).id && c.b === (a as any).id));
                if (!exists) {
                    ctx.worldModel.tmsConflicts = ctx.worldModel.tmsConflicts || [];
                    ctx.worldModel.tmsConflicts.push({
                        a: (a as any).id, b: (b as any).id,
                        type: 'contradiction', resolved: false, resolvedBy: null,
                    });
                }
            }
        }
    }
}

export function getTMSContext(ctx: ServerContext): string {
    const conflicts = ctx.worldModel.tmsConflicts?.filter((c: any) => !c.resolved) || [];
    if (conflicts.length === 0) return '';
    return conflicts.map((c: any) => {
        const a = ctx.worldModel.beliefs.find((b: any) => b.id === c.a);
        const b = ctx.worldModel.beliefs.find((b: any) => b.id === c.b);
        if (!a || !b) return '';
        return `认知冲突: "${a.statement}" 与 "${b.statement}" 存在矛盾`;
    }).filter(Boolean).join('\n');
}

export function checkParadigmConditions(ctx: ServerContext, core: any): any {
    const activeBeliefs = ctx.worldModel.beliefs.filter((b: any) => b.status !== 'archived');
    const contradictions = ctx.worldModel.tmsConflicts?.filter((c: any) => !c.resolved).length || 0;
    const totalEvidence = activeBeliefs.reduce((s: number, b: any) => s + (b.evidenceCount || 0), 0);
    const shouldShift = contradictions >= 3 || totalEvidence >= 20;
    return { shifted: shouldShift, reason: shouldShift ? `矛盾数=${contradictions}, 证据数=${totalEvidence}` : '' };
}

export function checkParadigmShift(ctx: ServerContext, core: any): boolean {
    const result = checkParadigmConditions(ctx, core);
    return result.shifted;
}

export function executeParadigmShift(ctx: ServerContext, cause: string, core: any): void {
    ctx.worldModel.paradigmVersion++;
    ctx.worldModel.lastParadigmShift = Date.now();
    ctx.worldModel.shiftHistory = ctx.worldModel.shiftHistory || [];
    ctx.worldModel.shiftHistory.push({
        version: ctx.worldModel.paradigmVersion, triggeredBy: cause,
        oldBeliefs: [], newBeliefs: [], timestamp: Date.now(),
    });
}
