import { describe, expect, it } from 'vitest';
import fixtures from '../../../artifacts/emotion-learning/dual-loop-causal-review-v0.5/local-nlu-bridge-fixtures-v0.3.json';
import adversarialFixtures from '../../../artifacts/emotion-learning/dual-loop-causal-review-v0.5/affect-bridge-adversarial-v0.3.json';
import { analyzeAffectBridgeShadow, evaluateAffectBridgeShadow } from '../affectBridgeShadow.js';
import { analyzeEmotionEvent, analyzeUserEmotionLocally, fallbackEmotionEvent } from '../emotionAnalyzer.js';

const roleConcernReference = (owner: 'character' | 'user' | 'third_party' | 'unknown' = 'character') => ({
  owner,
  topic: fixtures.roleConcernReference.topic,
  eventReference: fixtures.roleConcernReference.eventReference,
});
const roleReferenceForCase = (override?: { owner?: string; eventReference?: string }) => {
  const owner = override?.owner === 'user' || override?.owner === 'third_party' || override?.owner === 'unknown'
    ? override.owner
    : 'character';
  return { ...roleConcernReference(owner), eventReference: override?.eventReference ?? fixtures.roleConcernReference.eventReference };
};

describe('affect bridge shadow diagnostics', () => {
  it.each(fixtures.cases)('$id stays within its hand-authored evidence contract', testCase => {
    const analysis = analyzeUserEmotionLocally(testCase.message);
    const shadow = analyzeAffectBridgeShadow(testCase.message, analysis);
    const expected = testCase.expected;

    expect(shadow.schemaVersion).toBe('affect-bridge-v0.4');
    expect(shadow.subject).toBe(expected.subject);
    expect(shadow.affectReportKind).toBe(expected.affectReportKind);
    expect(shadow.engagementBoundary).toBe(expected.engagementBoundary);
    expect(shadow.reports).toHaveLength(expected.reports.length);
    for (const [index, report] of expected.reports.entries()) {
      expect(shadow.reports[index]).toMatchObject(report);
    }

    const gate = evaluateAffectBridgeShadow(shadow, {
      confirmed: true,
      valuesPresent: true,
      concern: fixtures.roleConcern,
      reference: roleConcernReference(),
    });
    expect(gate.disposition).toBe(expected.bridgeDisposition);
    expect(gate.reason).toBe(expected.bridgeReason);
    expect(gate.delta).toBe(0);
  });

  it.each(adversarialFixtures.cases)('rejects or qualifies adversarial case: $id', testCase => {
    const analysis = analyzeUserEmotionLocally(testCase.message);
    const shadow = analyzeAffectBridgeShadow(testCase.message, analysis);
    const reference = roleReferenceForCase(testCase.roleReferenceOverride);
    const gate = evaluateAffectBridgeShadow(shadow, {
      confirmed: true,
      valuesPresent: true,
      concern: adversarialFixtures.roleConcern,
      reference,
    });

    expect(gate.disposition).toBe(testCase.expectedDisposition);
    expect(gate.reason).toBe(testCase.expectedReason);
    if ('expectedOwnerRelation' in testCase && testCase.expectedOwnerRelation) expect(gate.concernOwnerRelation).toBe(testCase.expectedOwnerRelation);
    if ('expectedEventIdentity' in testCase && testCase.expectedEventIdentity) expect(gate.eventIdentity).toBe(testCase.expectedEventIdentity);
    expect(gate.delta).toBe(0);
  });

  it('attaches diagnostics to the analyzer result without changing state-event values', async () => {
    const text = '面试结果还没出来，这让我这周很难过。';
    const result = await analyzeEmotionEvent(text, null);

    expect(result.affectBridgeShadow?.source).toBe('local_pattern_shadow');
    expect(result.event).toEqual(fallbackEmotionEvent(text, result.userAnalysis));
    expect(result.affectBridgeShadow?.reports[0]?.emotion).toBe('sad');
    expect(result.affectBridgeShadow?.reports[0]?.causeEvidence[0]).toContain('面试结果');
  });

  it('records topic overlap without claiming two different owners share one event', () => {
    const text = '面试结果还没出来，这让我这周很难过。';
    const shadow = analyzeAffectBridgeShadow(text, analyzeUserEmotionLocally(text));
    const characterConcern = evaluateAffectBridgeShadow(shadow, {
      confirmed: true, valuesPresent: true, concern: fixtures.roleConcern, reference: roleConcernReference(),
    });
    const userConcern = evaluateAffectBridgeShadow(shadow, {
      confirmed: true, valuesPresent: true, concern: fixtures.roleConcern,
      reference: roleConcernReference('user'),
    });
    const unknownOwner = evaluateAffectBridgeShadow(shadow, {
      confirmed: true, valuesPresent: true, concern: fixtures.roleConcern,
      reference: roleConcernReference('unknown'),
    });
    const missingEventReference = evaluateAffectBridgeShadow(shadow, {
      confirmed: true, valuesPresent: true, concern: fixtures.roleConcern,
      reference: { ...roleConcernReference(), eventReference: '' },
    });

    expect(characterConcern.concernOwnerRelation).toBe('different_owner_topic_overlap');
    expect(characterConcern.eventIdentity).toBe('unlinked');
    expect(userConcern.concernOwnerRelation).toBe('same_owner_topic_overlap');
    expect(userConcern.eventIdentity).toBe('unlinked');
    expect(unknownOwner).toMatchObject({ disposition: 'no_reading', reason: 'role_concern_owner_unconfirmed', delta: 0 });
    expect(missingEventReference).toMatchObject({ disposition: 'no_reading', reason: 'role_concern_event_reference_unconfirmed', delta: 0 });

    const linkedShadow = {
      ...shadow,
      reports: shadow.reports.map(report => ({ ...report, eventReference: fixtures.roleConcernReference.eventReference })),
    };
    const sameEvent = evaluateAffectBridgeShadow(linkedShadow, {
      confirmed: true, valuesPresent: true, concern: fixtures.roleConcern,
      reference: roleConcernReference('user'),
    });
    const otherEventShadow = {
      ...shadow,
      reports: shadow.reports.map(report => ({ ...report, eventReference: 'user-interview-event-elsewhere' })),
    };
    const differentEvent = evaluateAffectBridgeShadow(otherEventShadow, {
      confirmed: true, valuesPresent: true, concern: fixtures.roleConcern,
      reference: roleConcernReference('user'),
    });
    expect(sameEvent.eventIdentity).toBe('same_event');
    expect(differentEvent.eventIdentity).toBe('different_event');
  });

  it('does not bridge historical affect into a current role concern', () => {
    const text = '我上次因为面试结果没通过很难过。';
    const shadow = analyzeAffectBridgeShadow(text, analyzeUserEmotionLocally(text));
    expect(shadow.reports[0]).toMatchObject({ subject: 'user', temporalScope: 'historical' });
    expect(shadow.reports[0]?.causeEvidence.length).toBeGreaterThan(0);

    const gate = evaluateAffectBridgeShadow(shadow, {
      confirmed: true,
      valuesPresent: true,
      concern: fixtures.roleConcern,
      reference: roleConcernReference(),
    });
    expect(gate).toMatchObject({ disposition: 'no_reading', reason: 'affect_not_current', delta: 0 });

    const temporalExamples = [
      ['我昨天因为面试结果没通过很难过。', 'historical'],
      ['如果面试结果不理想，我可能会很难过。', 'hypothetical'],
      ['我明天会因为面试结果很难过。', 'hypothetical'],
      ['我这周一直因为面试结果很难过。', 'interval'],
      ['我现在因为面试结果很难过。', 'moment'],
    ] as const;
    for (const [textExample, expectedScope] of temporalExamples) {
      const example = analyzeAffectBridgeShadow(textExample, analyzeUserEmotionLocally(textExample));
      expect(example.reports[0]?.temporalScope).toBe(expectedScope);
    }
  });

  it('keeps affect inside Chinese curly single quotes attributed to the speaker', () => {
    const text = '我朋友说：‘因为面试结果我很难过。’';
    const shadow = analyzeAffectBridgeShadow(text, analyzeUserEmotionLocally(text));
    expect(shadow.reports[0]).toMatchObject({ subject: 'third_party', emotion: 'sad' });
    expect(shadow.affectReportKind).toBe('quoted_or_third_party');
    expect(shadow.reports.flatMap(report => [...report.evidence, ...report.causeEvidence])
      .every(span => text.includes(span))).toBe(true);

    const gate = evaluateAffectBridgeShadow(shadow, {
      confirmed: true,
      valuesPresent: true,
      concern: fixtures.roleConcern,
      reference: roleConcernReference(),
    });
    expect(gate).toMatchObject({ disposition: 'ambiguous_affect_context', reason: 'not_explicit_user_self_report', delta: 0 });
  });

  it('handles third-party subjects and quotation contrasts conservatively', () => {
    const cases = [
      { text: '我妹妹因为面试结果很焦虑。', subject: 'third_party', reportedBy: 'user' },
      { text: '我同事表示：“因为面试结果我很难过。”', subject: 'third_party', reportedBy: 'third_party' },
      { text: '我妹妹提到「因为面试结果我很难过」', subject: 'third_party', reportedBy: 'third_party' },
      { text: '我朋友说:"因为面试结果我很难过"', subject: 'third_party', reportedBy: 'third_party' },
      { text: '我朋友说：“她又说‘因为面试结果我很难过。’”', subject: 'third_party', reportedBy: 'third_party' },
      { text: '我刚才说：“因为面试结果我很难过。”', subject: 'user', reportedBy: 'user', gateReason: 'not_explicit_user_self_report' },
      { text: '“我因为结果很难过。”这句是我刚才说的。', subject: 'user', reportedBy: 'user', gateReason: 'not_explicit_user_self_report' },
      { text: '我刚才在群里写了“我现在很紧张”，这话是我说的。', subject: 'user', reportedBy: 'user', gateReason: 'not_explicit_user_self_report' },
      { text: '“因为面试结果我很难过。”', subject: 'unknown', reportedBy: 'unknown' },
      { text: '我妹妹说我因为面试结果很难过。', subject: 'user', reportedBy: 'third_party', gateReason: 'not_user_authored_affect_report' },
      { text: '我朋友说：“你因为面试结果很难过。”', subject: 'user', reportedBy: 'third_party', gateReason: 'not_user_authored_affect_report' },
      { text: '我朋友告诉我，我最近很焦虑。', subject: 'user', reportedBy: 'third_party', gateReason: 'not_user_authored_affect_report' },
      { text: '我室友跟我讲，她最近很委屈。', subject: 'third_party', reportedBy: 'third_party' },
      { text: '我哥哥提醒我最近很担心，叫我早点休息。', subject: 'user', reportedBy: 'third_party', gateReason: 'not_user_authored_affect_report' },
      { text: '晓文昨晚没通过面试，她现在有点焦虑。', subject: 'third_party', reportedBy: 'user' },
    ] as const;

    for (const sample of cases) {
      const shadow = analyzeAffectBridgeShadow(sample.text, analyzeUserEmotionLocally(sample.text));
      expect(shadow.reports[0]?.subject, sample.text).toBe(sample.subject);
      expect(shadow.reports[0]?.reportedBy).toBe(sample.reportedBy);
      expect(shadow.reports.flatMap(report => [...report.evidence, ...report.causeEvidence])
        .every(span => sample.text.includes(span))).toBe(true);
      const gate = evaluateAffectBridgeShadow(shadow, {
        confirmed: true,
        valuesPresent: true,
        concern: fixtures.roleConcern,
        reference: roleConcernReference(),
      });
      expect(gate.disposition).not.toBe('care_response_candidate');
      if ('gateReason' in sample) expect(gate.reason).toBe(sample.gateReason);
      expect(gate.delta).toBe(0);
    }
  });

  it('does not count the joy substring inside “不开心”', () => {
    const text = '班长说：“你最近很不开心。”';
    const shadow = analyzeAffectBridgeShadow(text, analyzeUserEmotionLocally(text));
    expect(shadow.reports.map(report => report.emotion)).toEqual(['sad']);
    expect(shadow.reports[0]).toMatchObject({ subject: 'user', reportedBy: 'third_party' });
    expect(shadow.affectReportKind).toBe('quoted_or_third_party');
    const gate = evaluateAffectBridgeShadow(shadow, {
      confirmed: true,
      valuesPresent: true,
      concern: fixtures.roleConcern,
      reference: roleConcernReference(),
    });
    expect(gate.disposition).not.toBe('care_response_candidate');
    expect(gate.delta).toBe(0);
  });

  it('switches experiencer within one sentence and keeps an unidentified reporter unknown', () => {
    const mixedText = '她最近很焦虑，我也有点焦虑。';
    const mixed = analyzeAffectBridgeShadow(mixedText, analyzeUserEmotionLocally(mixedText));
    expect(mixed.reports.map(({ subject, reportedBy }) => ({ subject, reportedBy }))).toEqual([
      { subject: 'third_party', reportedBy: 'user' },
      { subject: 'user', reportedBy: 'user' },
    ]);
    expect(mixed).toMatchObject({ subject: 'multiple', affectReportKind: 'mixed' });

    const unidentifiedText = '有人说我最近很担心。';
    const unidentified = analyzeAffectBridgeShadow(unidentifiedText, analyzeUserEmotionLocally(unidentifiedText));
    expect(unidentified.reports[0]).toMatchObject({ subject: 'user', reportedBy: 'unknown' });
    expect(unidentified.affectReportKind).toBe('quoted_or_third_party');
  });

  it('preserves raw emotion cues and leaves unsupported phrases unknown in the shadow map', () => {
    const direct = analyzeAffectBridgeShadow('我现在很难过。', analyzeUserEmotionLocally('我现在很难过。'));
    expect(direct.reports[0]).toMatchObject({
      emotionText: '难过',
      emotionMapping: { version: 'shadow-emotion-map-v0.1', canonical: 'sad' },
    });
    const explicitFear = analyzeAffectBridgeShadow('我很害怕。', analyzeUserEmotionLocally('我很害怕。'));
    expect(explicitFear.reports[0]?.emotionMapping.canonical).toBe('fear');

    for (const text of ['我对结果很不满意。', '我终于放心了。', '我有点失望。', '我最近很焦虑。', '我有点担心。']) {
      const shadow = analyzeAffectBridgeShadow(text, analyzeUserEmotionLocally(text));
      expect(shadow.reports[0], text).toMatchObject({
        emotionMapping: { version: 'shadow-emotion-map-v0.1', canonical: 'unknown' },
      });
      expect(shadow.reports[0]?.emotionText.length).toBeGreaterThan(0);
      const gate = evaluateAffectBridgeShadow(shadow, {
        confirmed: true,
        valuesPresent: true,
        concern: fixtures.roleConcern,
        reference: roleConcernReference(),
      });
      expect(gate).toMatchObject({ disposition: 'no_reading', reason: 'emotion_not_in_shadow_map', delta: 0 });
    }

    const fatigue = analyzeUserEmotionLocally('我今天有点疲惫。');
    const fatigueShadow = analyzeAffectBridgeShadow('我今天有点疲惫。', fatigue);
    expect(fatigue.bodyState?.fatigue).toBeTruthy();
    expect(fatigueShadow.reports).toEqual([]);
  });
});
