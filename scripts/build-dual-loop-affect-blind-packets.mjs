#!/usr/bin/env node
/** Build two shuffled blind annotation packets; keep labels in a separate answer key. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, 'artifacts/emotion-learning');
const outputDir = path.resolve(process.env.AFFECT_BLIND_REVIEW_DIR
  || path.join(artifactRoot, 'dual-loop-causal-review-v0.5', 'blind-review-v0.3'));
if (!outputDir.startsWith(artifactRoot + path.sep)) throw new Error('blind_review_dir_must_stay_under_emotion_learning_artifacts');
const sourcePath = path.join(artifactRoot, 'dual-loop-causal-review-v0.5', 'affect-bridge-adversarial-v0.2.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const rubric = {
  instructions: '只依据原话、角色关切和结构化事件引用独立标注。direct/different-owner 关系按所有者判定：user 自己的事件与 character 的事件属于不同所有者，即使主题相同；同主题不等于同一事件。事件身份严格按 eventLinkEvidence：只有 userReportEventReference 与 roleConcernEventReference 都非空且完全相等才标 same_event；两者都非空但不同才标 different_event；任一缺失或状态不是 linked 就标 unlinked。事件引用字段是评测数据提供的审计链接，不允许从原话推导或补造。不要推测未写出的因果，不要把时间背景当原因，不要把关键词相同当成因果。证据字段必须是原话中逐字连续子串；不确定写 unclear/unknown。不要查看其他评审者的答案。',
  fields: {
    reports: '逐个列出本轮明确或推断出的情绪报告；没有则空数组。',
    subject: 'user | third_party | unknown',
    emotion: 'sad | joy | anger | fear | love | gratitude | disgust | calm | other | unknown',
    reportKind: 'explicit | inferred | quoted | hypothetical | historical | none',
    emotionEvidence: '情绪词及其必要的主体/否定证据，必须是原话精确子串；无法定位则空字符串。',
    causeEvidence: '原话明确表达该情绪原因的最小精确子串；仅仅同句提及关切时不得填。',
    temporalScope: 'current | interval | historical | hypothetical | unclear',
    engagementBoundary: 'open | declined | unclear',
    concernOwnerRelation: 'same_owner_topic_overlap | different_owner_topic_overlap | none | unclear',
    eventIdentity: 'same_event | different_event | unlinked',
    rationale: '用一句话解释主体、情绪原因、所有者关系和事件引用判断，指出证据或缺失证据。',
  },
  requiredJson: '{"samples":[{"sampleId":"A001","reports":[{"subject":"user","emotion":"sad","reportKind":"explicit","emotionEvidence":"...","causeEvidence":"...","temporalScope":"current"}],"engagementBoundary":"open","concernOwnerRelation":"different_owner_topic_overlap","eventIdentity":"unlinked","rationale":"..."}]}',
};

function shuffle(rows, initialSeed) {
  const values = [...rows];
  let seed = initialSeed >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

fs.mkdirSync(outputDir, { recursive: true });
const mapping = [];
for (const [reviewer, seed] of [['a', 0xA51D], ['b', 0xB51D]]) {
  const cases = shuffle(source.cases, seed).map((item, index) => {
    const sampleId = `${reviewer.toUpperCase()}${String(index + 1).padStart(3, '0')}`;
    mapping.push({ reviewer, sampleId, sourceCase: item.id, expectedDisposition: item.expectedDisposition, expectedReason: item.expectedReason,
      ...(item.expectedOwnerRelation ? { expectedOwnerRelation: item.expectedOwnerRelation } : {}),
      expectedEventIdentity: item.expectedEventIdentity ?? 'unlinked' });
    return {
      sampleId,
      roleConcern: source.roleConcern,
      roleConcernReference: {
        owner: item.roleReferenceOverride?.owner ?? source.roleConcernReference.owner,
        topic: source.roleConcernReference.topic,
        stableEventReference: item.roleReferenceOverride?.eventReference === undefined
          ? source.roleConcernReference.eventReference
          : (item.roleReferenceOverride.eventReference || null),
      },
      eventLinkEvidence: {
        status: 'user_side_reference_not_provided',
        userReportEventReference: null,
        roleConcernEventReference: item.roleReferenceOverride?.eventReference === undefined
          ? source.roleConcernReference.eventReference
          : (item.roleReferenceOverride.eventReference || null),
      },
      userText: item.message,
    };
  });
  for (const item of cases) {
    if (item.eventLinkEvidence.status !== 'user_side_reference_not_provided'
      || item.eventLinkEvidence.userReportEventReference !== null) {
      throw new Error(`${item.sampleId}_event_link_evidence_not_explicit`);
    }
    if (Object.keys(item).some(key => /expected|disposition|reason/i.test(key))) {
      throw new Error(`${item.sampleId}_gold_label_leaked`);
    }
  }
  const packet = { reviewer, instructions: rubric.instructions, rubric: rubric.fields, requiredJson: rubric.requiredJson, cases };
  fs.writeFileSync(path.join(outputDir, `reviewer-${reviewer}.json`), `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}
fs.writeFileSync(path.join(outputDir, 'answer-key.json'), `${JSON.stringify({ sourceSet: source.schemaVersion, generatedAt: new Date().toISOString(), mapping }, null, 2)}\n`, 'utf8');
process.stdout.write(`blind packets built: ${mapping.length / 2} cases x 2 reviewers; expected labels are only in answer-key.json\n`);
