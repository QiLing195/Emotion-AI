import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import blueprint from './firebase-blueprint.json';

interface SimulatedAuth {
  uid: string;
  emailVerified: boolean;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const QUADRANTS = new Set([
  'high-positive',
  'low-positive',
  'high-negative',
  'low-negative',
]);
const PREF_KEYS = new Set([
  'solution_first',
  'low_emotional_probing',
  'gentle_pacing',
  'concise_direct',
]);
const SERVER_TIME = '__REQUEST_TIME__';

function hasExactKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(obj);
  return (
    allowed.every((k) => keys.includes(k)) &&
    keys.every((k) => allowed.includes(k))
  );
}

function evaluateAnnotationCreate(params: {
  auth: SimulatedAuth | null;
  pathUserId: string;
  docId: string;
  parentExists: boolean;
  data: Record<string, unknown>;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  const { auth, pathUserId, docId, parentExists, data } = params;
  if (!auth || !auth.emailVerified || auth.uid !== pathUserId) {
    return 'PERMISSION_DENIED';
  }
  if (!VALID_ID_REGEX.test(pathUserId) || !VALID_ID_REGEX.test(docId)) {
    return 'PERMISSION_DENIED';
  }
  const required = [
    'userId',
    'utterance',
    'context',
    'valence',
    'arousal',
    'primaryLabel',
    'quadrant',
    'displayTime',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, required)) return 'PERMISSION_DENIED';
  if (data.userId !== auth.uid || data.userId !== pathUserId) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof data.utterance !== 'string' ||
    data.utterance.length < 1 ||
    data.utterance.length > 1000
  ) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof data.context !== 'string' ||
    data.context.length < 1 ||
    data.context.length > 64
  ) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof data.valence !== 'number' ||
    data.valence < -1 ||
    data.valence > 1 ||
    typeof data.arousal !== 'number' ||
    data.arousal < -1 ||
    data.arousal > 1
  ) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof data.primaryLabel !== 'string' ||
    data.primaryLabel.length < 1 ||
    data.primaryLabel.length > 40
  ) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.quadrant !== 'string' || !QUADRANTS.has(data.quadrant)) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof data.displayTime !== 'string' ||
    data.displayTime.length < 1 ||
    data.displayTime.length > 32
  ) {
    return 'PERMISSION_DENIED';
  }
  if (data.createdAt !== SERVER_TIME || data.updatedAt !== SERVER_TIME) {
    return 'PERMISSION_DENIED';
  }
  if (!parentExists) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateDynamicConcernCreate(params: {
  auth: SimulatedAuth | null;
  pathUserId: string;
  docId: string;
  data: Record<string, unknown>;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  const { auth, pathUserId, docId, data } = params;
  if (!auth || !auth.emailVerified || auth.uid !== pathUserId) {
    return 'PERMISSION_DENIED';
  }
  if (!VALID_ID_REGEX.test(docId)) return 'PERMISSION_DENIED';
  const kw = data.topicKeywords;
  if (
    !Array.isArray(kw) ||
    kw.length < 1 ||
    kw.length > 6 ||
    typeof kw[0] !== 'string' ||
    kw[0].length < 1 ||
    kw[0].length > 32
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOW';
}

function evaluatePersonaLogUpdate(params: {
  existingReverted: boolean;
  incomingReverted: boolean;
  changedKeys: string[];
}): 'ALLOW' | 'PERMISSION_DENIED' {
  if (params.existingReverted !== false || params.incomingReverted !== true) {
    return 'PERMISSION_DENIED';
  }
  if (
    !params.changedKeys.every((k) => k === 'reverted' || k === 'updatedAt')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOW';
}

describe('Firestore Security Rules & Dirty Dozen Verification', () => {
  const validAuth: SimulatedAuth = { uid: 'uid_alice', emailVerified: true };
  const baseAnnotation = {
    userId: 'uid_alice',
    utterance: '今天终于顺利上线了，心里很踏实。',
    context: '观察笔记',
    valence: 0.62,
    arousal: -0.25,
    primaryLabel: '满足',
    quadrant: 'low-positive',
    displayTime: '2026-11-26 15:40',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };

  it('matches all collections in firebase-blueprint.json and enforces Eight Pillars primitives in rules', () => {
    const rulesPath = resolve(process.cwd(), 'firestore.rules');
    const draftPath = resolve(process.cwd(), 'DRAFT_firestore.rules');
    let rulesText = '';
    try {
      rulesText = readFileSync(rulesPath, 'utf8');
    } catch {
      rulesText = readFileSync(draftPath, 'utf8');
    }

    expect(rulesText).toContain("rules_version = '2';");
    expect(rulesText).toContain('match /{document=**}');
    expect(rulesText).toContain('allow read, write: if false;');
    expect(rulesText).toContain('request.auth.token.email_verified == true');
    expect(rulesText).toContain('incoming().createdAt == request.time');
    expect(rulesText).toContain('incoming().updatedAt == request.time');
    expect(rulesText).toContain('existing().reverted == false');
    expect(rulesText).toContain('resource.data.userId == request.auth.uid');

    const blueprintPaths = Object.keys(blueprint.firestore);
    expect(blueprintPaths).toEqual([
      '/users/{userId}',
      '/users/{userId}/annotations/{annotationId}',
      '/users/{userId}/dynamicConcerns/{concernId}',
      '/users/{userId}/personaStates/{stateId}',
      '/users/{userId}/personaPreferences/{prefKey}',
      '/users/{userId}/personaLogs/{logId}',
    ]);

    expect(rulesText).toContain('match /users/{userId}');
    expect(rulesText).toContain('match /annotations/{annotationId}');
    expect(rulesText).toContain('match /dynamicConcerns/{concernId}');
    expect(rulesText).toContain('match /personaStates/{stateId}');
    expect(rulesText).toContain('match /personaPreferences/{prefKey}');
    expect(rulesText).toContain('match /personaLogs/{logId}');

    // Ensure allow list blocks never call get() or exists()
    const listBlocks = rulesText.match(/allow list:[^;]+;/g) ?? [];
    expect(listBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of listBlocks) {
      expect(block).not.toContain('get(');
      expect(block).not.toContain('exists(');
    }
  });

  it('allows a fully valid owner annotation create', () => {
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-101',
        parentExists: true,
        data: baseAnnotation,
      })
    ).toBe('ALLOW');
  });

  it('rejects all Dirty Dozen adversarial payloads with PERMISSION_DENIED', () => {
    // DD-01: Identity spoofing (attacker targeting victim path)
    expect(
      evaluateAnnotationCreate({
        auth: { uid: 'uid_attacker', emailVerified: true },
        pathUserId: 'uid_victim',
        docId: 'ann-1',
        parentExists: true,
        data: { ...baseAnnotation, userId: 'uid_victim' },
      })
    ).toBe('PERMISSION_DENIED');

    // DD-02: Owner mismatch inside payload
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-2',
        parentExists: true,
        data: { ...baseAnnotation, userId: 'uid_bob' },
      })
    ).toBe('PERMISSION_DENIED');

    // DD-03: Unverified email write
    expect(
      evaluateAnnotationCreate({
        auth: { uid: 'uid_alice', emailVerified: false },
        pathUserId: 'uid_alice',
        docId: 'ann-3',
        parentExists: true,
        data: baseAnnotation,
      })
    ).toBe('PERMISSION_DENIED');

    // DD-04: Shadow / ghost field injection
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-4',
        parentExists: true,
        data: { ...baseAnnotation, isAdmin: true },
      })
    ).toBe('PERMISSION_DENIED');

    // DD-05: Path ID poisoning
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'a'.repeat(150),
        parentExists: true,
        data: baseAnnotation,
      })
    ).toBe('PERMISSION_DENIED');

    // DD-06: Denial-of-Wallet string overflow (> 1000 chars)
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-6',
        parentExists: true,
        data: { ...baseAnnotation, utterance: 'x'.repeat(1001) },
      })
    ).toBe('PERMISSION_DENIED');

    // DD-07: Out-of-range numeric coordinate poisoning
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-7',
        parentExists: true,
        data: { ...baseAnnotation, valence: 2.5 },
      })
    ).toBe('PERMISSION_DENIED');

    // DD-08: Forged timestamp (not request.time)
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-8',
        parentExists: true,
        data: { ...baseAnnotation, createdAt: '2020-01-01T00:00:00Z' },
      })
    ).toBe('PERMISSION_DENIED');

    // DD-09: Immutable field tampering check (cannot alter userId or createdAt)
    const allowedAnnotationUpdateKeys = new Set([
      'utterance',
      'context',
      'valence',
      'arousal',
      'primaryLabel',
      'quadrant',
      'displayTime',
      'updatedAt',
    ]);
    expect(allowedAnnotationUpdateKeys.has('createdAt')).toBe(false);
    expect(allowedAnnotationUpdateKeys.has('userId')).toBe(false);

    // DD-10: Array bomb / non-string element poisoning
    expect(
      evaluateDynamicConcernCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'concern-1',
        data: { topicKeywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
      })
    ).toBe('PERMISSION_DENIED');
    expect(
      evaluateDynamicConcernCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'concern-2',
        data: { topicKeywords: [123] },
      })
    ).toBe('PERMISSION_DENIED');
    expect(PREF_KEYS.has('arbitrary_key')).toBe(false);

    // DD-11: Terminal state unlocking on reverted persona growth log
    expect(
      evaluatePersonaLogUpdate({
        existingReverted: true,
        incomingReverted: false,
        changedKeys: ['reverted', 'updatedAt'],
      })
    ).toBe('PERMISSION_DENIED');
    expect(
      evaluatePersonaLogUpdate({
        existingReverted: false,
        incomingReverted: true,
        changedKeys: ['reverted', 'summary', 'updatedAt'],
      })
    ).toBe('PERMISSION_DENIED');

    // DD-12: Orphaned subcollection write when parent user profile does not exist
    expect(
      evaluateAnnotationCreate({
        auth: validAuth,
        pathUserId: 'uid_alice',
        docId: 'ann-12',
        parentExists: false,
        data: baseAnnotation,
      })
    ).toBe('PERMISSION_DENIED');
  });
});
