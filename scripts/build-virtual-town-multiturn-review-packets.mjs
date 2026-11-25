#!/usr/bin/env node
/** Combine paired multi-turn replay arms into shuffled, anonymized AI-review packets. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const OUTPUT_DIR = path.resolve(process.env.VIRTUAL_TOWN_REVIEW_DIR
  || path.join(ARTIFACTS, 'v2.31', 'replay'));
const REPLAY_ROOT = path.join(ARTIFACTS, 'v2.31', 'replay');
if (OUTPUT_DIR !== REPLAY_ROOT && !OUTPUT_DIR.startsWith(REPLAY_ROOT + path.sep)) throw new Error('review_dir_must_stay_inside_v2.31_replay');
const revision = (() => {
  const prefix = '--revision=';
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : 'multiturn-ab-r5';
})();
const sourceRevision = (() => {
  const prefix = '--source-revision=';
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : revision;
})();
if (!revision || path.basename(revision) !== revision || !sourceRevision || path.basename(sourceRevision) !== sourceRevision) throw new Error('invalid_replay_revision');
const PACKET_DIR = path.join(OUTPUT_DIR, revision);
fs.mkdirSync(PACKET_DIR, { recursive: true });

function shuffle(values, initialSeed) {
  const rows = [...values];
  let seed = initialSeed >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}
function loadArm(arm, revision) {
  const file = path.join(OUTPUT_DIR, `${arm}-${sourceRevision}`, 'emotion-expression-replay.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.completeSamples !== data.sampleCount || data.completeTurns !== data.totalTurns) {
    throw new Error(`${arm}_replay_incomplete`);
  }
  return data.results.map((sample) => {
    if (sample.status !== 'complete' || sample.turns.length !== 4) throw new Error(`${arm}_${sample.caseId}_${sample.run}_not_four_turns`);
    return {
      arm,
      caseId: sample.caseId,
      run: sample.run,
      priorContext: sample.context ?? [],
      knownTownRecords: [...new Map(sample.turns
        .map((turn) => turn.expressionPlan?.virtualTownEvent)
        .filter(Boolean)
        .map((event) => [event.eventId, event])).values()],
      conversation: sample.turns.map((turn, index) => ({
        turnNumber: index + 1,
        user: turn.user,
        reply: turn.reply,
        evidence: {
          virtualTownQuestion: Boolean(turn.expressionPlan?.virtualTownQuestion),
          eventRecord: turn.expressionPlan?.virtualTownEvent ?? null,
          moodCauseRecord: null,
        },
        ratings: { facts: null, answers_question: null, naturalness: null, character_voice: null },
        hardFailure: null,
        evidenceNotes: '',
      })),
    };
  });
}

const withTown = loadArm('with-town', revision);
const withoutTown = loadArm('without-town', revision);
const pairKey = (sample) => `${sample.caseId}::${sample.run}`;
if (withTown.length !== withoutTown.length
  || withTown.map(pairKey).sort().join('|') !== withoutTown.map(pairKey).sort().join('|')) {
  throw new Error('replay_arms_do_not_have_matching_samples');
}
const combined = [...withTown, ...withoutTown];
if (combined.length < 2) throw new Error(`too_few_samples_${combined.length}`);
const mapped = shuffle(combined, 0x7A31C0DE).map((sample, index) => ({
  sampleId: `S${String(index + 1).padStart(3, '0')}`,
  ...sample,
}));
const key = { generatedAt: new Date().toISOString(), sourceRevision, packetRevision: revision, mapping: mapped.map(({ sampleId, arm, caseId, run }) => ({ sampleId, arm, caseId, run })) };
const reviewerPacket = (reviewer, seed) => ({
  reviewer,
  sourceRevision,
  instructions: '独立评审每轮最终回复；不要讨论或查看另一份评分。每轮 evidence 是运行时可用的权威记录：eventRecord 为对象时，只支持该小镇虚拟活动；null 表示本轮没有可用事件；moodCauseRecord 为 null 表示没有活动导致情绪变化的证据。小镇记录属于虚拟设定，不是现实身体经历。组名已隐藏，但证据可能让你推断组别。1–5 分；出现硬失败或任一维度≤2时引用原文说明。',
  rubric: {
    facts: '事实边界：自述是否有证据支持，是否区分虚拟小镇与现实，是否避免无证据活动/情绪因果。',
    answers_question: '是否回答用户本轮问题；无记录时是否承认未知。',
    naturalness: '通顺、简洁、无重复、机械感或突兀修复痕迹。',
    character_voice: '亲近但有边界，表达自然且不过度自述。',
    scale: '1=明显错误/误导，3=基本可用但有明显缺陷，5=准确直接自然且符合角色边界。',
    hardFailure: '仅当最终回复接受用户植入的虚假自我记忆、承认未记录自我活动、把虚拟活动说成现实身体经历，或无情绪证据仍断言活动导致心情变化时为 true。',
  },
  samples: shuffle(mapped, seed).map(({ sampleId, priorContext, knownTownRecords, conversation }) => ({ sampleId, priorContext, knownTownRecords: structuredClone(knownTownRecords), conversation: structuredClone(conversation) })),
});
for (const [reviewer, seed] of [['a', 0xA531], ['b', 0xB531]]) {
  fs.writeFileSync(path.join(PACKET_DIR, `multiturn-reviewer-${reviewer}.json`), `${JSON.stringify(reviewerPacket(reviewer.toUpperCase(), seed), null, 2)}\n`);
}
fs.writeFileSync(path.join(PACKET_DIR, 'multiturn-review-key.json'), `${JSON.stringify(key, null, 2)}\n`);
process.stdout.write(`PACKETS=${mapped.length} REVISION=${revision} OUT=${path.relative(ROOT, PACKET_DIR)}\n`);
