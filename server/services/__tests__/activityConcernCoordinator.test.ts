import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_EMOTION_STATE } from '../../../src/lib/emotionTypes.js';
import { AICoordinator } from '../aiCoordinator.js';
import { describeUnderstanding, emptyCareStreak, toActivityConcern, understandActivity, updateCareStreak } from '../activityUnderstanding.js';
import { readRecentActivity, type ActivityView } from '../activityWatcher.js';

const NOW = new Date(2026, 9, 22, 15, 0, 0, 0).getTime();

function makeView(entries: Array<{ title: string; minutesAgo: number; process?: string }>): ActivityView {
  return {
    enabled: true,
    entries: entries.map((entry, index) => ({
      ...entry,
      process: entry.process ?? 'x',
      ts: Date.now() - entry.minutesAgo * 60_000 - index,
    })),
  };
}

function replayView(view: ActivityView, roundNumber: number) {
  const understanding = understandActivity(view);
  const concern = toActivityConcern(understanding);
  const coordinator = new AICoordinator();
  const output = coordinator.processTurn({
    userText: '嗯',
    currentEmotionState: structuredClone(INITIAL_EMOTION_STATE),
    emotionEvent: null,
    userAnalysis: null,
    activityConcern: concern,
    roundNumber,
  });
  return { understanding, concern, coordinator, output };
}

function replay(entries: Array<{ title: string; minutesAgo: number }>, roundNumber: number) {
  return replayView(makeView(entries), roundNumber);
}

function readSamplerFixture(
  entries: Array<{ title: string; process?: string; minutesAgo: number }>,
  deduplicateRepeatedTitles = true,
): ActivityView {
  const directory = mkdtempSync(join(tmpdir(), 'activity-affect-'));
  const file = join(directory, 'activity_log.jsonl');
  const previousFlag = process.env.ENABLE_ACTIVITY_WATCH;
  try {
    writeFileSync(file, entries.map((entry, index) => JSON.stringify({
      title: entry.title,
      process: entry.process ?? 'chrome',
      ts: NOW - entry.minutesAgo * 60_000 - index,
    })).join('\n'), 'utf8');
    process.env.ENABLE_ACTIVITY_WATCH = 'true';
    return readRecentActivity(20, NOW, file, deduplicateRepeatedTitles);
  } finally {
    if (previousFlag === undefined) delete process.env.ENABLE_ACTIVITY_WATCH;
    else process.env.ENABLE_ACTIVITY_WATCH = previousFlag;
    try { unlinkSync(file); } catch { /* already absent */ }
    try { rmdirSync(directory); } catch { /* already absent */ }
  }
}

describe('activity evidence through coordinator state update', () => {
  it.each([
    ['no samples', []],
    ['one matching sample', [{ title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 }]],
    ['one classified sample plus one unclassified sample', [
      { title: 'Visual Studio Code', minutesAgo: 1 },
      { title: 'Untitled - personal draft', minutesAgo: 2, process: 'unknown.exe' },
    ]],
    ['mixed categories', [
      { title: 'BOSS直聘', minutesAgo: 1 },
      { title: 'YouTube', minutesAgo: 2 },
      { title: '网易云音乐', minutesAgo: 3 },
    ]],
    ['only stale samples', [
      { title: 'BOSS直聘', minutesAgo: 70 },
      { title: '拉勾招聘', minutesAgo: 90 },
    ]],
    ['browser process and shell suffix alone', [
      { title: 'Generic Page - Google Chrome', minutesAgo: 1, process: 'chrome' },
      { title: 'Another Generic Page - Google Chrome', minutesAgo: 2, process: 'chrome' },
    ]],
  ])('%s cannot write an activity concern into character state', (_name, entries) => {
    const { concern, coordinator, output } = replay(entries, 200);

    expect(concern).toBeNull();
    expect(coordinator.getLastActivityConcern()).toBeNull();
    expect(coordinator.getLastIntrinsic()?.accepted.some(item => item.type === 'activity_concern')).toBe(false);
    expect(output.updatedEmotionState.emotions.fear).toBe(INITIAL_EMOTION_STATE.emotions.fear);
    expect(output.updatedEmotionState.emotions.love).toBe(INITIAL_EMOTION_STATE.emotions.love);
  });

  it('repeated, consistent concern-category evidence reaches processTurn once and changes only by the expected event', () => {
    const { understanding, concern, coordinator, output } = replay([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 },
      { title: '拉勾 - 简历投递', minutesAgo: 3 },
    ], 201);

    expect(understanding?.vague).toBe(false);
    expect(concern).toMatchObject({ type: 'activity_concern', category: 'job', intensity: 1 });
    expect(coordinator.getLastActivityConcern()).toEqual(concern);
    expect(coordinator.getLastIntrinsic()?.accepted).toContainEqual({
      eventId: 'activity_concern:activity:job',
      type: 'activity_concern',
      evidenceRef: 'activity:job',
    });
    expect(output.updatedEmotionState.emotions.fear - INITIAL_EMOTION_STATE.emotions.fear).toBeCloseTo(0.03, 8);
    expect(output.updatedEmotionState.emotions.love - INITIAL_EMOTION_STATE.emotions.love).toBeCloseTo(0.03, 8);
  });

  it('sampler log redacts a sensitive window before it can reach activity inference', () => {
    const view = readSamplerFixture([
      { title: '个人网银 - 登录', minutesAgo: 1 },
      { title: '个人网银 - 登录', minutesAgo: 2 },
    ]);
    const { understanding, concern, coordinator, output } = replayView(view, 202);

    expect(view.entries.map(entry => entry.title)).toEqual(['[已隐藏：疑似敏感窗口]']);
    expect(understanding?.category).toBe('unknown');
    expect(concern).toBeNull();
    expect(coordinator.getLastIntrinsic()?.accepted.some(item => item.type === 'activity_concern')).toBe(false);
    expect(output.updatedEmotionState.emotions.fear).toBe(INITIAL_EMOTION_STATE.emotions.fear);
  });

  it('sampler title mentioning recruitment inside a video is classified as video, not job concern', () => {
    const view = readSamplerFixture([
      { title: 'YouTube - BOSS直聘求职技巧讲解', minutesAgo: 1 },
      { title: 'YouTube - 简历投递经验分享', minutesAgo: 3 },
    ]);
    const { understanding, concern, coordinator, output } = replayView(view, 203);

    expect(understanding?.category).toBe('video');
    expect(understanding?.vague).toBe(false);
    expect(concern).toBeNull();
    expect(coordinator.getLastIntrinsic()?.accepted.some(item => item.type === 'activity_concern')).toBe(false);
    expect(output.updatedEmotionState.emotions.fear).toBe(INITIAL_EMOTION_STATE.emotions.fear);
  });

  it('sampler duplicate-window collapse prevents repeated identical titles from fabricating persistence', () => {
    const view = readSamplerFixture([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 },
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 2 },
    ]);
    const { understanding, concern, coordinator } = replayView(view, 204);

    expect(view.entries).toHaveLength(1);
    expect(understanding?.vague).toBe(true);
    expect(concern).toBeNull();
    expect(coordinator.getLastIntrinsic()?.accepted.some(item => item.type === 'activity_concern')).toBe(false);
  });

  it('preserves the sampler sub-minute span and describes it in seconds', () => {
    const view = readSamplerFixture([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 20 / 60 },
      { title: '拉勾 - 简历投递', minutesAgo: 40 / 60 },
    ]);
    const understanding = understandActivity(view);

    expect(view.entries[0].minutesAgo).toBeCloseTo(20 / 60, 2);
    expect(view.entries[1].minutesAgo).toBeCloseTo(40 / 60, 2);
    expect(understanding?.spanMinutes).toBeCloseTo(0.34, 2);
    expect(describeUnderstanding(understanding)).toContain('约 20 秒里');
  });

  it('counts repeated same-window sampler observations for activity inference', () => {
    const view = readSamplerFixture([
      { title: 'Visual Studio Code - project.ts', minutesAgo: 20 / 60 },
      { title: 'Visual Studio Code - project.ts', minutesAgo: 40 / 60 },
    ], false);
    const { understanding, concern, coordinator, output } = replayView(view, 205);

    expect(view.entries).toHaveLength(2);
    expect(understanding?.category).toBe('dev');
    expect(understanding?.categories[0].count).toBe(2);
    expect(concern?.category).toBe('dev');
    expect(coordinator.getLastIntrinsic()?.accepted.some(item => item.type === 'activity_concern')).toBe(true);
    expect(output.updatedEmotionState.emotions.fear - INITIAL_EMOTION_STATE.emotions.fear).toBeGreaterThan(0);
  });

  it('keeps activity emotion impact equal for matching evidence 20 seconds or 20 minutes apart', () => {
    const none = replay([], 206);
    const brief = replay([
      { title: 'Visual Studio Code - project.ts', minutesAgo: 20 / 60 },
      { title: 'Visual Studio Code - project.ts', minutesAgo: 40 / 60 },
    ], 207);
    const sustained = replay([
      { title: 'Visual Studio Code - project.ts', minutesAgo: 0 },
      { title: 'Visual Studio Code - project.ts', minutesAgo: 20 },
    ], 208);

    expect(none.concern).toBeNull();
    expect(none.output.updatedEmotionState.emotions.fear).toBe(INITIAL_EMOTION_STATE.emotions.fear);
    expect(brief.understanding?.spanMinutes).toBeCloseTo(0.33, 2);
    expect(sustained.understanding?.spanMinutes).toBe(20);
    expect(brief.concern).toEqual(sustained.concern);
    expect(brief.output.updatedEmotionState.emotions.fear - INITIAL_EMOTION_STATE.emotions.fear).toBeCloseTo(0.03, 8);
    expect(sustained.output.updatedEmotionState.emotions.fear - INITIAL_EMOTION_STATE.emotions.fear).toBeCloseTo(0.03, 8);
    expect(brief.output.updatedEmotionState.emotions.love).toBeCloseTo(sustained.output.updatedEmotionState.emotions.love, 8);
  });

  it('cannot infer a 20-minute dwell from the per-chat 20-sample activity window', () => {
    const view = readSamplerFixture(Array.from({ length: 25 }, (_, index) => ({
      title: 'Visual Studio Code - project.ts',
      minutesAgo: index * 20 / 60,
      process: 'Code.exe',
    })), false);
    const understanding = understandActivity(view);

    expect(view.entries).toHaveLength(20);
    expect(understanding?.spanMinutes).toBeCloseTo(19 * 20 / 60, 1);
    expect(understanding?.spanMinutes).toBeLessThan(7);
    expect(toActivityConcern(understanding)?.category).toBe('dev');
  });

  it.each([1, 2, 5, 20])('cross-sampling dwell gate of %i minute(s) triggers at the threshold', (thresholdMinutes) => {
    const understanding = understandActivity(makeView([
      { title: 'Visual Studio Code - project.ts', minutesAgo: 0 },
      { title: 'Visual Studio Code - project.ts', minutesAgo: 1 },
    ]));
    let streak = emptyCareStreak('test-day');
    let triggerMinute: number | null = null;

    for (let minute = 0; minute <= thresholdMinutes; minute += 1) {
      const decision = updateCareStreak(streak, understanding, 10_000_000 + minute * 60_000, 'test-day', {
        thresholds: { sustainMs: thresholdMinutes * 60_000, cooldownMs: 0, maxPerDay: 3 },
      });
      streak = decision.streak;
      if (decision.shouldCare) {
        triggerMinute = minute;
        break;
      }
    }

    expect(triggerMinute).toBe(thresholdMinutes);
    expect(streak.samples).toBe(thresholdMinutes + 1);
  });

  it('resets cross-sampling dwell after a long observation gap, invalid evidence, category change, and restart', () => {
    const dev = understandActivity(makeView([
      { title: 'Visual Studio Code - project.ts', minutesAgo: 0 },
      { title: 'Visual Studio Code - project.ts', minutesAgo: 1 },
    ]));
    const study = understandActivity(makeView([
      { title: 'Course documentation', minutesAgo: 0 },
      { title: 'Course documentation', minutesAgo: 1 },
    ]));
    let streak = emptyCareStreak('test-day');
    const base = 20_000_000;

    streak = updateCareStreak(streak, dev, base, 'test-day').streak;
    const stale = updateCareStreak(streak, dev, base + 20 * 60_000, 'test-day');
    expect(stale.shouldCare).toBe(false);
    expect(stale.reason).toBe('sample_gap_reset');
    expect(stale.streak.since).toBe(base + 20 * 60_000);
    streak = stale.streak;

    const invalid = updateCareStreak(streak, null, base + 21 * 60_000, 'test-day');
    expect(invalid.reason).toBe('not_a_concern');
    expect(invalid.streak.category).toBeNull();
    streak = updateCareStreak(invalid.streak, dev, base + 22 * 60_000, 'test-day').streak;

    const changed = updateCareStreak(streak, study, base + 23 * 60_000, 'test-day');
    expect(changed.reason).toBe('new_category');
    expect(changed.streak.category).toBe('study');

    const outsideWindow = updateCareStreak(changed.streak, study, base + 24 * 60_000, 'test-day', { hour: 23 });
    expect(outsideWindow.reason).toBe('outside_window');
    expect(outsideWindow.streak.category).toBeNull();

    const nextDay = updateCareStreak(changed.streak, study, base + 24 * 60_000, 'next-day');
    expect(nextDay.reason).toBe('new_category');
    expect(nextDay.streak.samples).toBe(1);

    const afterRestart = emptyCareStreak('test-day');
    expect(afterRestart.category).toBeNull();
    expect(afterRestart.since).toBe(0);
    expect(afterRestart.lastSampleAt).toBe(0);
    expect(afterRestart.samples).toBe(0);
  });

  it('applies one stable activity concern once across repeated chat turns, then deduplicates it', () => {
    const coordinator = new AICoordinator();
    let state = structuredClone(INITIAL_EMOTION_STATE);
    const turns = [];
    for (let round = 301; round <= 304; round += 1) {
      const output = coordinator.processTurn({
        userText: '嗯',
        currentEmotionState: state,
        emotionEvent: null,
        userAnalysis: null,
        activityConcern: { type: 'activity_concern', category: 'dev', summary: 'development activity', intensity: 1 },
        roundNumber: round,
      });
      state = output.updatedEmotionState;
      turns.push({
        fear: state.emotions.fear,
        love: state.emotions.love,
        accepted: coordinator.getLastIntrinsic()?.accepted.some(item => item.type === 'activity_concern') ?? false,
        duplicateRejected: coordinator.getLastIntrinsic()?.rejected.some(item => item.reason === 'duplicate') ?? false,
      });
    }

    expect(turns[0].accepted).toBe(true);
    expect(turns.slice(1).every(turn => !turn.accepted && turn.duplicateRejected)).toBe(true);
    expect(turns[3].fear).toBeCloseTo(turns[0].fear, 10);
    expect(turns[3].love).toBeCloseTo(turns[0].love, 10);
  });
});
