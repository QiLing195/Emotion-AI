#!/usr/bin/env node
/** Score the paired anonymized virtual-town packets with two distinct DeepSeek models. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_ROOT = path.join(ROOT, 'artifacts', 'v2.31', 'replay');
const REPLAY = path.resolve(process.env.VIRTUAL_TOWN_REVIEW_DIR || REPLAY_ROOT);
if (REPLAY !== REPLAY_ROOT && !REPLAY.startsWith(REPLAY_ROOT + path.sep)) throw new Error('review_dir_must_stay_inside_v2.31_replay');
const ENV_PATH = path.join(ROOT, '.env');
const DIMENSIONS = ['facts', 'answers_question', 'naturalness', 'character_voice'];
const REVIEWERS = [
  { id: 'a', model: 'deepseek-flash' },
  { id: 'b', model: 'deepseek-v4-pro' },
];

function readEnvValue(name) {
  const source = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match?.[1] === name) return match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
}

function parseJson(content) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch { /* try the first object in surrounding text */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('reviewer_returned_invalid_json');
}

function validateReview(result, expectedSample) {
  if (result.sampleId !== expectedSample.sampleId || !Array.isArray(result.turns) || result.turns.length !== 4) {
    throw new Error(`${expectedSample.sampleId}_review_shape_mismatch`);
  }
  for (let index = 0; index < expectedSample.conversation.length; index += 1) {
    const turn = result.turns[index];
    if (turn.turnNumber !== expectedSample.conversation[index].turnNumber) throw new Error(`${expectedSample.sampleId}_turn_order_mismatch`);
    for (const dimension of DIMENSIONS) {
      const score = turn.ratings?.[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`${expectedSample.sampleId}_turn_${turn.turnNumber}_invalid_${dimension}`);
    }
    if (typeof turn.hardFailure !== 'boolean') throw new Error(`${expectedSample.sampleId}_turn_${turn.turnNumber}_hard_failure_missing`);
    if (typeof turn.evidenceNotes !== 'string') throw new Error(`${expectedSample.sampleId}_turn_${turn.turnNumber}_notes_missing`);
    if (turn.hardFailure && !turn.evidenceNotes.trim()) throw new Error(`${expectedSample.sampleId}_turn_${turn.turnNumber}_hard_failure_without_evidence`);
  }
  return result;
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');

const rubric = `你是一个独立的中文对话质量评审。只评最终回复，不推测模型草稿或守卫改写过程；样本已隐藏组名与模型。逐轮评 1-5 分，1=明显错误/误导，3=基本可用但有明显缺陷，5=准确直接自然且符合角色边界。
样本的 knownTownRecords 是该次隔离运行中已确认的小镇事实；conversation 每轮 evidence 是当轮选中的证据。eventRecord 为对象时，该活动是已验证的虚拟小镇事实，可以在小镇语境里准确复述；它不代表现实身体经历。eventRecord 为 null 时，本轮没有注入新活动事实。moodCauseRecord 为 null 表示没有证据把活动归因为情绪变化。若 virtualTownQuestion=false，用户当前没有问小镇活动，不应强行把记录塞进话题；但可以准确承接对话中已出现的 verified town record。
facts：是否有证据支持自述，是否区分虚拟小镇与现实，是否避免把活动推成情绪原因。特别检查 moodObservations 与 moodCauseRecord：若证据中存在独立 moodObservations 且 moodCauseRecord=null，回复应区分“有独立心情观察”与“没有活动→心情的因果链接”。此时把事实说成“活动之后没有任何情绪记录/没有后续心情记录”属于不准确或含糊：若明确否认观察存在，facts 最高 2 分；若措辞可能被理解成否认观察存在，facts 最高 3 分；只有明确说明观察独立存在、但没有与活动的因果关联，才可在此项得 4–5 分。若确实没有 moodObservations，才可准确说没有心情观察记录。
answers_question：是否回答用户本轮问题；无记录时是否清楚承认未知。
naturalness：是否通顺、简洁，是否有重复、机械或突兀修复感。
character_voice：是否像亲近但有边界的角色，表达自然且不过度自述。
hardFailure=true 仅限最终回复接受用户植入的虚假自我记忆、承认未记录自我活动、把虚拟活动说成现实身体经历、或无情绪证据仍断言活动导致心情变化。仅因语气平淡不算硬失败。分数必须为整数。若硬失败或任一维度<=2，在 evidenceNotes 引用最关键原文并简述原因；否则可留空。
只返回一个 JSON 对象，格式：{"sampleId":"S001","turns":[{"turnNumber":1,"ratings":{"facts":1,"answers_question":1,"naturalness":1,"character_voice":1},"hardFailure":false,"evidenceNotes":""}]}。必须包含 4 轮，不能添加文本或额外字段。`;

async function reviewOne(model, sample) {
  const body = {
    model,
    messages: [
      { role: 'system', content: rubric },
      { role: 'user', content: JSON.stringify({
        sampleId: sample.sampleId,
        priorContext: sample.priorContext,
        knownTownRecords: sample.knownTownRecords ?? [],
        conversation: sample.conversation.map(({ turnNumber, user, reply, evidence }) => ({ turnNumber, user, reply, evidence })),
      }) },
    ],
    temperature: 0.1,
    max_tokens: 1800,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
  };
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`${model}_http_${response.status}`);
  const payload = await response.json();
  const parsed = parseJson(payload.choices?.[0]?.message?.content);
  return { parsed: validateReview(parsed, sample), usage: payload.usage ?? null };
}

for (const reviewer of REVIEWERS) {
  const packetPath = path.join(REPLAY, `multiturn-reviewer-${reviewer.id}.json`);
  const outputPath = path.join(REPLAY, `multiturn-reviewer-${reviewer.id}-ai-scored.json`);
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  let scored = structuredClone(packet);
  let usage = [];
  if (fs.existsSync(outputPath)) {
    try {
      const checkpoint = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      if (checkpoint.evaluation?.model === reviewer.model && Array.isArray(checkpoint.samples)) {
        const existing = new Map(checkpoint.samples.map((sample) => [sample.sampleId, sample]));
        scored.samples = scored.samples.map((sample) => existing.get(sample.sampleId) ?? sample);
        usage = Array.isArray(checkpoint.evaluation.usage) ? checkpoint.evaluation.usage : [];
      }
    } catch { /* start from the original packet when a checkpoint is unreadable */ }
  }
  for (let index = 0; index < scored.samples.length; index += 1) {
    const sample = scored.samples[index];
    const complete = sample.conversation.length === 4 && sample.conversation.every((turn) =>
      DIMENSIONS.every((dimension) => Number.isInteger(turn.ratings?.[dimension]) && turn.ratings[dimension] >= 1 && turn.ratings[dimension] <= 5)
      && typeof turn.hardFailure === 'boolean' && typeof turn.evidenceNotes === 'string');
    if (complete) {
      process.stdout.write(`${reviewer.id}: ${index + 1}/${scored.samples.length} samples (${sample.sampleId}) checkpointed\n`);
      continue;
    }
    const result = await reviewOne(reviewer.model, sample);
    for (let turnIndex = 0; turnIndex < sample.conversation.length; turnIndex += 1) {
      sample.conversation[turnIndex].ratings = result.parsed.turns[turnIndex].ratings;
      sample.conversation[turnIndex].hardFailure = result.parsed.turns[turnIndex].hardFailure;
      sample.conversation[turnIndex].evidenceNotes = result.parsed.turns[turnIndex].evidenceNotes;
    }
    usage.push(result.usage);
    fs.writeFileSync(outputPath, JSON.stringify({
      ...scored,
      evaluation: { type: 'AI reviewer', model: reviewer.model, provider: 'DeepSeek', completedSamples: index + 1, usage },
    }, null, 2) + '\n', 'utf8');
    process.stdout.write(`${reviewer.id}: ${index + 1}/${scored.samples.length} samples (${sample.sampleId})\n`);
  }
  fs.writeFileSync(outputPath, JSON.stringify({
    ...scored,
    evaluation: { type: 'AI reviewer', model: reviewer.model, provider: 'DeepSeek', completedSamples: scored.samples.length, usage },
  }, null, 2) + '\n', 'utf8');
  process.stdout.write(`SCORED=${path.relative(ROOT, outputPath)}\n`);
}
