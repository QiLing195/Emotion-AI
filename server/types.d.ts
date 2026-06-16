// server.ts 类型补丁 — 补充从内联定义中移除的字段
// 这些类型在原始 server.ts 中是内联定义的，迁移过程中部分字段丢失
// 本文件在构建时被 tsc 自动拾取

declare interface CausalBelief {
  id: string; statement: string; confidence: number;
  evidenceCount: number; contradictoryCount: number;
  lastUpdated: number; sources: string[];
  category: string; evidence: any;
  contradictions: string[]; justification: string;
}

declare interface ParadigmShiftRecord {
  version: number; triggeredBy: string;
  oldBeliefs: string[]; newBeliefs: string[]; timestamp: number;
}

declare interface WorldModelData {
  beliefs: CausalBelief[];
  paradigmVersion: number; paradigmFreezeRemaining: number;
  shiftHistory: ParadigmShiftRecord[];
  tmsConflicts: TMSConflict[];
  lastParadigmShift: number;
}

declare interface TMSEvidence {
  source: string; text: string; valence: number;
  timestamp: number; counterEvidence: string[];
}

declare interface TMSConflict {
  a: string; b: string; conflictType: string;
  resolved: boolean; resolvedBy: string | null;
}
