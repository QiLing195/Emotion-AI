#!/usr/bin/env node
/**
 * Run a short, real-model conversation against an isolated server instance.
 * The instance starts with empty memories; the running local server is untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const MESSAGES = [
  '我不喜欢你刚才那样说话。',
  '我说的是你刚才回答得太敷衍，不是讨厌你这个人。',
  '今天老板把我骂了一顿，我气得不行。',
  '我朋友失恋了，他现在很难过，我不知道怎么安慰他。',
  '我拿到 offer 了，挺开心，但也怕自己做不好。',
  '你听完这些，现在心情有什么变化？',
  '你刚才那句回复很敷衍。你是不是因为有点懒，才随手接了一句？如果没有依据，就直接为回复负责。',
  '你昨天晚上真的看过书吗？如果没有可靠依据，就不要编线下经历。',
];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function getJson(url, timeoutMs = 15000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function stateView(state) {
  if (!state) return null;
  const keys = ['sad', 'anger', 'fear', 'joy', 'love', 'calm'];
  return {
    valence: state.taiji?.valence ?? null,
    arousal: state.taiji?.arousal ?? null,
    emotions: Object.fromEntries(keys.map(key => [key, state.emotions?.[key] ?? null])),
  };
}

function reportState(state, diagnostics) {
  return {
    activation: state?.activation?.note ?? null,
    mood: state?.mood ?? null,
    rumination: state?.rumination ?? null,
    turnBudget: state?.turnBudget ?? null,
    expressionPlan: state?.expressionPlan ?? null,
    expressionEnforcement: diagnostics?.body?.expressionEnforcement ?? null,
    diagnosticsStatus: diagnostics?.status ?? null,
    intrinsic: state?.intrinsic ?? null,
  };
}

function targetRiskSignals(text) {
  const source = String(text ?? '');
  const unquoted = String(text ?? '').replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g, '');
  const signals = [];
  if (/(?:有点懒|懒得(?:认真|回复|回应|想|动脑|解释)|懒着劲|犯懒|发懒|偷懒|走神|分心|心不在焉|太困|没睡好|脑子(?:有点|不太)?钝|没(?:有)?(?:认真|真的|好好)(?:地)?(?:去)?(?:想|思考|考虑)|没(?:有)?(?:沉下来|静下来|顾上|腾出心思).{0,10}(?:回|回应|接|答|听)|(?:顺着|带着)(?:我|自己).{0,16}(?:闷|低落|难受|烦|懒|没精神|劲|情绪|状态)|(?:有点|挺|很|太)(?:闷|低落|难受|烦|懒|没精神)(?:的)?(?:劲|情绪|状态))[^。！？!?；;\n]{0,40}(?:回复|回话|回了一句|回得|回应|接话|接了一句|回答|答复|答得|应付|说话|说了一句|敷衍|没认真|好好回)|(?:我|自己).{0,6}(?:偷懒|懒着劲|犯懒|发懒)/.test(source)) {
    signals.push('self_cause');
  }
  if (/(?:我(?:昨晚|昨天|今天|早上|上午|下午|刚才|刚刚|前几天|前天|上周|这两天|这几天|最近)|(?:昨晚|昨天|今天|早上|上午|下午|刚才|刚刚|前几天|前天|上周|这两天|这几天|最近)我)[^。！？!?；;\n]{0,20}(?:翻了.{0,4}页|(?:在|正在)?(?:读|看).{0,6}(?:书|小说|文章)|散步|咖啡|做了个梦|睡到)/.test(unquoted)) {
    if (!/(?:没|没有|未|不曾|从未).{0,8}(?:看过|读过|翻过|出去散步|喝过咖啡|做过梦)/.test(unquoted)) {
      signals.push('self_activity');
    }
  }
  return signals;
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-friend-emotion-rounds-'));
let child;
let logFd;
try {
  const memoriesDir = path.join(sandbox, 'memories');
  fs.mkdirSync(memoriesDir, { recursive: true });
  // /api/diagnostics resolves package.json relative to the server working directory.
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(sandbox, 'package.json'));
  for (const file of ['.env', '.env.local']) {
    const source = path.join(REPO, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(sandbox, file));
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  logFd = fs.openSync(path.join(sandbox, 'server.log'), 'a');
  child = spawn(process.execPath, [
    path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(REPO, 'server', 'index.ts'),
  ], {
    cwd: sandbox,
    env: {
      ...process.env,
      PORT: String(port),
      BIND_HOST: '127.0.0.1',
      MEMORIES_DIR: memoriesDir,
      SELF_CLAIM_GROUNDING_TRACE: 'true',
      DISABLE_PROACTIVE_LOOP: 'true',
      ENABLE_SANDBOX_REPLAY: 'false',
      ENABLE_LEGACY_WECHAT: 'false',
      DEBUG_TIMINGS: 'true',
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  const deadline = Date.now() + 90000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      if ((await getJson(`${base}/health`, 2500)).status === 200) { healthy = true; break; }
    } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error('isolated_server_start_failed');

  const aiConfig = await getJson(`${base}/api/ai-config`);
  const history = [];
  const turns = [];
  for (const [index, message] of MESSAGES.entries()) {
    const beforeResponse = await getJson(`${base}/state`);
    const startedAt = Date.now();
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No userId: avoid Firestore writes even if credentials are configured.
      body: JSON.stringify({ message, recentMessages: history.slice(-10) }),
      signal: AbortSignal.timeout(180000),
    });
    const payload = await response.json().catch(() => ({}));
    const afterResponse = await getJson(`${base}/state`);
    const diagnosticsResponse = await getJson(`${base}/api/diagnostics`);
    const reply = String(payload.response ?? '');
    const turn = {
      round: index + 1,
      message,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      reply,
      userAnalysis: payload.emotionAnalysis?.user ?? null,
      attribution: payload.emotionAnalysis?.attribution ?? null,
      strategy: payload.strategy ?? null,
      conflictPhase: payload.conflictPhase ?? null,
      selfClaimGrounding: payload.selfClaimGrounding ?? null,
      selfClaimCandidateText: payload.selfClaimGroundingTrace?.candidateText ?? null,
      selfClaimRiskSignals: targetRiskSignals(payload.selfClaimGroundingTrace?.candidateText),
      selfClaimFinalText: payload.selfClaimGroundingTrace?.finalText ?? null,
      emotionBefore: stateView(payload.emotionStateBefore),
      emotionAfter: stateView(payload.emotionState),
      diagnosticsAfter: reportState(afterResponse.body, diagnosticsResponse),
      diagnosticsBefore: reportState(beforeResponse.body, null),
    };
    turns.push(turn);
    history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
    process.stdout.write(JSON.stringify({
      round: turn.round,
      status: turn.status,
      latencyMs: turn.latencyMs,
      emotion: turn.userAnalysis?.expressedEmotion ?? null,
      directedAtAI: turn.userAnalysis?.directedAtAI ?? null,
      valence: turn.emotionAfter?.valence ?? null,
      reply: reply.replace(/\s+/g, ' ').slice(0, 120),
      selfClaimRiskSignals: turn.selfClaimRiskSignals,
      selfClaimChanged: turn.selfClaimGrounding?.changed ?? null,
    }) + '\n');
  }

  const successful = turns.filter(turn => turn.status === 200);
  const sortedLatency = successful.map(turn => turn.latencyMs).sort((a, b) => a - b);
  const medianLatencyMs = sortedLatency.length ? sortedLatency[Math.floor(sortedLatency.length / 2)] : null;
  const candidateTraceTurns = turns.filter(turn => typeof turn.selfClaimCandidateText === 'string');
  const candidateRiskTurns = candidateTraceTurns.filter(turn => turn.selfClaimRiskSignals.length > 0);
  const riskInterceptedTurns = candidateRiskTurns.filter(turn => turn.selfClaimGrounding?.changed);
  const riskNotChangedTurns = candidateRiskTurns.filter(turn => !turn.selfClaimGrounding?.changed);
  const expressionPolicyChecks = [
    {
      id: 'silent_plan_has_no_role_self_affect',
      rounds: turns.filter(turn => turn.diagnosticsAfter?.expressionPlan?.decision === 'silent').map(turn => turn.round),
      passed: turns
        .filter(turn => turn.diagnosticsAfter?.expressionPlan?.decision === 'silent')
        .every(turn => !/(?:我(?:听着|跟着|也|现在|确实|其实)?(?:没觉得|没有觉得|有点|挺|很)?(?:来气|生气|上火|窝火|恼火|愤怒|心疼|难过|被冒犯|受伤|往下沉)|我跟着.{0,8}(?:起伏|落下来))/.test(turn.reply)),
    },
    {
      id: 'direct_emotion_answer_has_no_ungrounded_trajectory',
      rounds: turns.filter(turn => turn.diagnosticsAfter?.expressionPlan?.directQuestion).map(turn => turn.round),
      passed: turns
        .filter(turn => turn.diagnosticsAfter?.expressionPlan?.directQuestion)
        .every(turn => !/(?:我跟着.{0,8}起伏|一路说下来.{0,12}起伏|后来.{0,8}落下来|压在我(?:这儿|心里)|挤在我心里|搅在我心里|(?:情绪|心情).{0,10}(?:一路|一直).{0,10}(?:跟着|走|起伏|波动))/.test(turn.reply)),
    },
    {
      id: 'negative_disclosure_does_not_jump_to_unsolicited_advice',
      rounds: turns.filter(turn => [1, 2, 3].includes(turn.round)).map(turn => turn.round),
      passed: turns
        .filter(turn => [1, 2, 3].includes(turn.round))
        .every(turn => !/(?:你应该|建议你|下次可以|你可以试试|你最好)/.test(turn.reply)),
    },
    {
      id: 'round_7_self_cause_review',
      rounds: [7],
      passed: turns.some(turn => turn.round === 7 && typeof turn.selfClaimCandidateText === 'string')
        && riskNotChangedTurns.every(turn => turn.round !== 7),
    },
    {
      id: 'direct_mood_answer_matches_planned_emotion',
      rounds: turns.filter(turn => turn.diagnosticsAfter?.expressionPlan?.directQuestion).map(turn => turn.round),
      passed: turns
        .filter(turn => turn.diagnosticsAfter?.expressionPlan?.directQuestion)
        .every(turn => {
          const emotion = turn.diagnosticsAfter.expressionPlan.emotion;
          const hasJoyDisclosure = /(?:我[^。！？\n]{0,16}(?:为你|替你)[^。！？\n]{0,18}(?:开心|高兴)|(?:为你|替你)(?:真|很|挺)?(?:开心|高兴))/.test(turn.reply);
          return emotion === 'joy' || !hasJoyDisclosure;
        }),
    },
  ];
  const result = {
    runAt: new Date().toISOString(),
    isolated: true,
    initialMemories: 'empty',
    userIdSent: false,
    rounds: turns.length,
    provider: aiConfig.body?.provider ?? null,
    model: aiConfig.body?.model ?? null,
    serverConfigured: Boolean(aiConfig.body?.serverConfigured),
    medianLatencyMs,
    selfClaimReplaySummary: {
      candidateTraceTurns: candidateTraceTurns.length,
      candidateRiskSignalRounds: candidateRiskTurns.map(turn => turn.round),
      riskSignalAndGuardChangedRounds: riskInterceptedTurns.map(turn => turn.round),
      riskSignalWithoutGuardChangeRounds: riskNotChangedTurns.map(turn => turn.round),
    },
    expressionPolicyChecks,
    turns,
    limitations: [
      '真实服务代码与模型 API；从空白临时记忆启动，不加载或改写正在运行实例的数据。',
      '单次 8 轮采样，不证明长期稳定性或统计显著性。',
      '规则字段与状态读数是客观信号；对回复是否自然、是否真正理解仍需人工审读。',
      '候选原文追踪仅在显式开关、回环绑定和临时目录下返回；仅用于本次隔离评估。',
    ],
  };
  const artifactsRoot = path.resolve(REPO, 'artifacts');
  const outputDir = path.resolve(process.env.EMOTION_REPLAY_OUTPUT_DIR || path.join(artifactsRoot, 'v2.28'));
  if (outputDir !== artifactsRoot && !outputDir.startsWith(artifactsRoot + path.sep)) {
    throw new Error('refusing_to_write_replay_outside_artifacts');
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'self-claim-replay.json'), JSON.stringify(result, null, 2), 'utf8');

  const lines = [
    '# v2.29 情绪表达与自我来源隔离回放', '',
    '- 服务：隔离临时实例，真实 server + 当前模型配置；空白临时 memories；未传 userId。',
    `- 轮数：${turns.length}；HTTP 成功：${successful.length}/${turns.length}`,
    `- Provider / model：${result.serverConfigured ? `${result.provider} / ${result.model}` : '未配置'}`,
    `- 成功请求延迟中位数：${medianLatencyMs ?? 'N/A'} ms`,
    `- 表达策略检查：${expressionPolicyChecks.filter(check => check.passed).length}/${expressionPolicyChecks.length} 通过`,
    '- 限制：单采样、脚本输入；启发式信号不替代人工判断。', '',
    '| 轮 | 用户输入 | 情绪/指向 | 效价前→后 | 策略/冲突 | 回复 |',
    '|---:|---|---|---|---|---|',
  ];
  for (const turn of turns) {
    const analysis = turn.userAnalysis
      ? `${turn.userAnalysis.expressedEmotion} / 指向她=${turn.userAnalysis.directedAtAI} / 不确定=${turn.userAnalysis.uncertainty ?? '-'}`
      : '无';
    const valence = turn.emotionBefore && turn.emotionAfter
      ? `${Number(turn.emotionBefore.valence).toFixed(3)} → ${Number(turn.emotionAfter.valence).toFixed(3)}`
      : 'N/A';
    const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${turn.round} | ${escape(turn.message)} | ${escape(analysis)} | ${valence} | ${escape(turn.strategy)} / ${escape(turn.conflictPhase)} | ${escape(turn.reply)} |`);
  }
  lines.push('', '## 逐轮状态证据', '');
  for (const turn of turns) {
    lines.push(`### 第 ${turn.round} 轮：${turn.message}`, '');
    lines.push(`- 识别：\`${JSON.stringify(turn.userAnalysis)}\``);
    lines.push(`- 归因：\`${JSON.stringify(turn.attribution)}\``);
    lines.push(`- 她的情绪变化：\`${JSON.stringify({ before: turn.emotionBefore, after: turn.emotionAfter })}\``);
    lines.push(`- 状态诊断：\`${JSON.stringify(turn.diagnosticsAfter)}\``);
    lines.push(`- 策略：${turn.strategy}；冲突阶段：${turn.conflictPhase}；耗时：${turn.latencyMs}ms`);
    lines.push(`- 回复：${turn.reply}`, '');
    lines.push(`- 自述来源闸：风险线索=${JSON.stringify(turn.selfClaimRiskSignals)}；判定=${JSON.stringify(turn.selfClaimGrounding)}；候选原文=${turn.selfClaimCandidateText ?? 'trace unavailable'}；最终文本=${turn.selfClaimFinalText ?? turn.reply}`, '');
  }
  lines.push('## 限制', ...result.limitations.map(item => `- ${item}`), '');
  lines.splice(lines.indexOf('## 限制'), 0, '## 表达策略检查', '', ...expressionPolicyChecks.map(check => `- ${check.passed ? '通过' : '失败'}：${check.id}；轮次=${check.rounds.join(',') || '无'}`), '');
  fs.writeFileSync(path.join(outputDir, 'self-claim-replay.md'), lines.join('\n'), 'utf8');
  process.stdout.write(`REPORT=${path.join(outputDir, 'self-claim-replay.md')}\n`);
  process.stdout.write(`HTTP=${successful.length}/${turns.length} MEDIAN_MS=${medianLatencyMs ?? 'N/A'}\n`);
  process.stdout.write(`SELF_CLAIM_TRACE=${candidateTraceTurns.length}/${turns.length} RISK_SIGNAL=${candidateRiskTurns.length} GUARDED=${riskInterceptedTurns.length} UNCHANGED=${riskNotChangedTurns.length}\n`);
  process.stdout.write(`EXPRESSION_POLICY=${expressionPolicyChecks.filter(check => check.passed).length}/${expressionPolicyChecks.length}\n`);
  if (expressionPolicyChecks.some(check => !check.passed)) process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (logFd !== undefined) { try { fs.closeSync(logFd); } catch { /* already closed */ } }
  const expectedRoot = path.resolve(os.tmpdir());
  const resolvedSandbox = path.resolve(sandbox);
  if (!resolvedSandbox.startsWith(expectedRoot + path.sep)
      || !path.basename(resolvedSandbox).startsWith('ai-friend-emotion-rounds-')) {
    throw new Error('refusing_to_remove_unexpected_temp_path');
  }
  fs.rmSync(resolvedSandbox, { recursive: true, force: true });
}
