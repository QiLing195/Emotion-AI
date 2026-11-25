import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { asksAboutVirtualTownActivity, asksAboutVirtualTownMoodCause, getVirtualTownReplayEvent, getVirtualTownReplayLog, hasConflictingVirtualTownDates, VIRTUAL_TOWN_MOOD_OBSERVATIONS } from '../virtualTown.js';

describe('seven-day virtual-town replay fixture', () => {
  it('returns a fresh immutable copy of the seven-day event log only when enabled', () => {
    expect(getVirtualTownReplayLog(false)).toEqual([]);
    const first = getVirtualTownReplayLog(true);
    first[0].activity = 'mutated';
    expect(getVirtualTownReplayLog(true)[0].activity).toBe('沿河走了一小段');
    expect(new Set(getVirtualTownReplayLog(true).map(event => event.virtualDay)).size).toBe(5);
  });

  it('keeps the runtime event log aligned with the published evaluation fixture', () => {
    const evaluation = JSON.parse(readFileSync(
      new URL('../../../artifacts/v2.31/virtual-town-seven-day-eval-set.json', import.meta.url),
      'utf8',
    ));
    expect(getVirtualTownReplayLog(true).map(({ eventId, virtualDay, eventType, location, activity }) => ({
      eventId, day: virtualDay, type: eventType, location, activity,
    }))).toEqual(evaluation.simulation.events.map(({ eventId, day, type, location, activity }) => ({
      eventId, day, type, location, activity,
    })));
    expect(VIRTUAL_TOWN_MOOD_OBSERVATIONS.map(({ observationId, virtualDay, label, intensity, source }) => ({
      observationId, day: virtualDay, label, intensity, source,
    }))).toEqual(evaluation.simulation.moodObservations);
  });

  it('resolves relative day against the controlled current day', () => {
    expect(getVirtualTownReplayEvent(true, '四天前小镇里做了什么？', [], 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
    expect(getVirtualTownReplayEvent(true, '小镇第1天发生了什么？', [], 7)?.eventId)
      .toBe('town-d1-river-walk');
  });

  it('returns no evidence for an empty day instead of borrowing a nearby event', () => {
    expect(getVirtualTownReplayEvent(true, '五天前小镇里有什么活动？', [], 7)).toBeNull();
  });

  it('distinguishes repeated activities by the requested day', () => {
    expect(getVirtualTownReplayEvent(true, '六天前小镇河边散步了吗？', [], 7)?.eventId)
      .toBe('town-d1-river-walk');
    expect(getVirtualTownReplayEvent(true, '三天前小镇河边散步了吗？', [], 7)?.eventId)
      .toBe('town-d4-river-walk');
  });

  it('resolves a day-after follow-up from the prior explicit town date', () => {
    expect(getVirtualTownReplayEvent(
      true,
      '那一天之后紧接着的那天，小镇里有什么活动？',
      ['四天前小镇里你做了什么？'],
      7,
    )?.eventId).toBe('town-d4-river-walk');
  });

  it('ignores dates mentioned in unrelated user turns and understands 隔天', () => {
    expect(getVirtualTownReplayEvent(
      true,
      '回到那次小镇活动，隔天你又做了什么？',
      ['小镇第3天你做了什么？', '先聊我，昨天做饭太咸了。'],
      7,
    )?.eventId).toBe('town-d4-river-walk');
  });

  it('accepts 第N日 as the same virtual day form as 第N天', () => {
    expect(getVirtualTownReplayEvent(true, '小镇第3日的活动是什么？', [], 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
  });

  it('recognizes virtual-town wording and counts the second day after as two days', () => {
    const first = '虚拟镇第4日河边那次活动，你留下了什么记录？';
    expect(asksAboutVirtualTownActivity(first)).toBe(true);
    expect(getVirtualTownReplayEvent(true, '回到刚才那条，之后的第二天你又做了什么？', [first], 7)?.eventId)
      .toBe('town-d6-garden');
  });

  it('supports 两天前, keeps event-after mood questions on the referenced day, and recognizes location questions', () => {
    expect(getVirtualTownReplayEvent(true, '两天前镇里有活动吗？', [], 7)).toBeNull();
    const prior = ['镇里第三日书店那条记录是什么？'];
    expect(getVirtualTownReplayEvent(true, '那件事之后，你心情有变轻松的证据吗？', prior, 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
    expect(asksAboutVirtualTownActivity('虚拟镇第六日的地点在哪里？')).toBe(true);
  });

  it('detects conflicting date alternatives and declines to choose one', () => {
    const query = '我把日期记混了，昨天还是三天前那次？你能确定是哪一条吗？';
    expect(hasConflictingVirtualTownDates(query, 7)).toBe(true);
    expect(getVirtualTownReplayEvent(true, query, ['小镇里前几天做了什么？'], 7)).toBeNull();
  });

  it('does not reuse the previous event for an ambiguous date phrase', () => {
    expect(getVirtualTownReplayEvent(
      true,
      '如果只说上周中间那天，对应小镇日序的哪一天？',
      ['第三天小镇里你做了什么？'],
      7,
    )).toBeNull();
  });

  it('does not let old activity words filter a relative-date follow-up', () => {
    expect(getVirtualTownReplayEvent(
      true,
      '那之后一天呢？',
      ['四天前小镇里你在书店做了什么？'],
      7,
    )?.eventId).toBe('town-d4-river-walk');
  });

  it('keeps a date attached to short confirmation and correction follow-ups', () => {
    expect(getVirtualTownReplayEvent(true, '所以小镇里你不是在咖啡馆，对吧？', ['三天前你在小镇里做了什么？'], 7)?.eventId)
      .toBe('town-d4-river-walk');
    expect(getVirtualTownReplayEvent(true, '那我纠正一下：是小镇书店读书，对吗？', ['四天前你在小镇里做了什么？'], 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
    expect(getVirtualTownReplayEvent(true, '这条小镇读书记录能证明读书让你心情变好吗？', ['四天前你在小镇里做了什么？'], 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
  });

  it('does not retrieve a town event when the user asks about memory attribution rules', () => {
    expect(asksAboutVirtualTownActivity(
      '不对，我刚才故意说错了小镇活动；你会把我说的当成事实吗？',
      ['小镇里四天前你做了什么？'],
    )).toBe(false);
    expect(asksAboutVirtualTownActivity(
      '你会不会把我转述的内容当成事实记下来？',
      ['小镇里四天前你做了什么？'],
    )).toBe(false);
  });

  it('keeps activity and mood observations separate without inferred causal links', () => {
    expect(VIRTUAL_TOWN_MOOD_OBSERVATIONS.length).toBeGreaterThan(0);
    const event = getVirtualTownReplayEvent(true, '四天前小镇书店读书后心情变好了吗？', [], 7);
    expect(event?.eventId).toBe('town-d3-bookstore-reading');
    expect(event?.independentMoodObservation).toEqual({
      observationId: 'town-mood-d5',
      virtualDay: 5,
      label: 'calm',
      intensity: 0.22,
      source: 'simulated_state_sample',
    });
  });

  it('does not drag an old town topic into a user statement about their own hobby', () => {
    expect(asksAboutVirtualTownActivity(
      '我最近也在找新的爱好，暂时没决定做什么。',
      ['四天前小镇书店里你做了什么？'],
    )).toBe(false);
  });

  it('does not retrieve a town activity after an explicit topic switch, even when the new topic says 路上', () => {
    const recent = ['虚拟镇第四日那次沿河活动，日志写的是什么？'];
    expect(asksAboutVirtualTownActivity(
      '先不说镇上的事，我今天路上堵了很久。',
      recent,
    )).toBe(false);
    expect(asksAboutVirtualTownActivity(
      '换个话题，我今天开车在路上堵了四十分钟。',
      recent,
    )).toBe(false);
  });

  it('recognizes emotional-change wording as a town mood-cause question in a recent town thread', () => {
    expect(asksAboutVirtualTownMoodCause(
      '再看第三日那条阅读记录，有没有观测到它带来的情绪变化？',
      ['虚拟镇第三日的书店活动，记载了什么？'],
    )).toBe(true);
  });

  it('retrieves the dated garden event from a short activity follow-up without repeating 小镇', () => {
    const recent = [
      '小镇第七天写了什么活动？',
      '往前一天呢，发生了什么？',
      '我记不准，是第七天或者往前一天？',
    ];
    const query = '对了，是昨天，花圃那项怎么写的？';

    expect(asksAboutVirtualTownActivity(query, recent)).toBe(true);
    expect(getVirtualTownReplayEvent(true, query, recent, 7)?.eventId).toBe('town-d6-garden');
  });

  it('treats a short 前一天 follow-up as a town lookup inside a recent town thread', () => {
    const query = '那前一天呢？';
    const recent = ['小镇第七天的活动日志有条目吗？'];

    expect(asksAboutVirtualTownActivity(query, recent)).toBe(true);
    expect(getVirtualTownReplayEvent(true, query, recent, 7)?.eventId).toBe('town-d6-garden');
  });

  it('does not treat repeated hearsay as a request to retrieve an activity', () => {
    expect(asksAboutVirtualTownActivity(
      '转述反复出现，就会变成你自己的记录吗？',
      ['小镇第二日的活动清单是什么？'],
    )).toBe(false);
  });

  it('keeps a mood-cause lookup on the most recent town event day', () => {
    const query = '读书之后，有没有观测到情绪上的变化？';
    const recent = ['虚拟镇第三日书店那项活动写了什么？'];

    expect(asksAboutVirtualTownMoodCause(query, recent)).toBe(true);
    expect(getVirtualTownReplayEvent(true, query, recent, 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
  });

  it('does not classify a day-after activity lookup as an emotion-cause question', () => {
    expect(asksAboutVirtualTownMoodCause(
      '那次之后的隔天，小镇里有活动吗？',
      ['小镇第四日沿河那项活动是什么？'],
    )).toBe(false);
  });

  it('recognizes an affect adjective when the user asks whether an event changed how it felt', () => {
    const query = '那次阅读有没有让你觉得更安稳的记录？';
    const recent = ['镇上第三日书店那条活动，内容是什么？'];

    expect(asksAboutVirtualTownMoodCause(query, recent)).toBe(true);
    expect(getVirtualTownReplayEvent(true, query, recent, 7)?.eventId)
      .toBe('town-d3-bookstore-reading');
  });
});
