// 记忆可见性审计：统计每条情景记忆的敏感度，以及各关系阶段下可见/被拦数量
// 运行: node node_modules/tsx/dist/cli.mjs scripts/visibility-report.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  STAGE_ORDER,
  SENSITIVITY_ORDER,
  SENSITIVITY_MIN_STAGE,
  SENSITIVITY_LABELS,
  inferSensitivity,
  stageRank,
} from '../src/lib/memoryVisibility.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const memories = path.join(root, 'memories');

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(memories, name), 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

interface Episode {
  id: string;
  eventSummary?: string;
  narrativeFragment?: string;
  tags?: string[];
  recallWeight?: number;
  emotionalImpact?: { valenceDelta?: number; arousalPeak?: number };
}

const episodes = readJson<{ episodes: Episode[] }>('episodic_memory.json', { episodes: [] }).episodes;
const rel = readJson<{ stage?: string }>('relationship_state_v2.json', {});
const currentStage = rel.stage ?? 'acquaintance';

const rows = episodes.map((ep) => {
  const sensitivity = inferSensitivity({
    text: `${ep.eventSummary ?? ''} ${ep.narrativeFragment ?? ''}`,
    tags: ep.tags,
    valenceDeltaAbs: Math.abs(ep.emotionalImpact?.valenceDelta ?? 0),
    arousalPeak: ep.emotionalImpact?.arousalPeak,
  });
  return { ep, sensitivity };
});

console.log(`情景记忆总数: ${rows.length} | 当前关系阶段: ${currentStage}\n`);

console.log('敏感度分布：');
for (const s of SENSITIVITY_ORDER) {
  const n = rows.filter((r) => r.sensitivity === s).length;
  console.log(`  ${SENSITIVITY_LABELS[s]}(${s}) 需到「${SENSITIVITY_MIN_STAGE[s]}」: ${n} 条`);
}

console.log('\n各阶段可见数量（当前阶段用 ← 标记）：');
for (const stage of STAGE_ORDER) {
  const visible = rows.filter((r) => stageRank(stage) >= stageRank(SENSITIVITY_MIN_STAGE[r.sensitivity])).length;
  const mark = stage === currentStage ? ' ← 当前' : '';
  console.log(`  ${stage.padEnd(12)} 可见 ${String(visible).padStart(2)}/${rows.length}  （被拦 ${rows.length - visible}）${mark}`);
}

console.log('\n当前阶段被拦下的记忆（她此刻不会主动提起）：');
for (const r of rows) {
  const min = SENSITIVITY_MIN_STAGE[r.sensitivity];
  if (stageRank(currentStage) < stageRank(min)) {
    console.log(`  [${SENSITIVITY_LABELS[r.sensitivity]}] 需到 ${min} | ${String(r.ep.eventSummary ?? '').slice(0, 34)}`);
  }
}
