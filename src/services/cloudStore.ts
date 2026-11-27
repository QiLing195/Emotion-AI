import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  EmotionAnnotation,
  QuadrantId,
  clampCoord,
  getQuadrant,
} from '../data/affectLexicon';
import {
  BoundedPersonaTraits,
  CurrentConcern,
  PersonaGrowthLogEntry,
  PersonaGrowthState,
  PersonaTraitKey,
  PreferenceContextScope,
  RelationshipPreference,
  RelationshipPreferenceKey,
} from '../dual-loop/contracts';
import {
  createInitialPersonaGrowthState,
  DEFAULT_BASELINE_TRAITS,
  MAX_TRAIT_DRIFT,
  sanitizePersonaGrowthState,
} from '../dual-loop/personaGrowth';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const VALID_PREFERENCE_KEYS = new Set<RelationshipPreferenceKey>([
  'solution_first',
  'low_emotional_probing',
  'gentle_pacing',
  'concise_direct',
]);
const VALID_SCOPES = new Set<PreferenceContextScope>([
  'task_and_help',
  'venting_and_support',
  'global',
]);
const VALID_TRIGGER_KINDS = new Set([
  'refusal_feedback',
  'correction_feedback',
  'explicit_preference',
  'pattern_consolidation',
  'reflection_consolidation',
  'homeostatic_decay',
]);
const TRAIT_KEYS: readonly PersonaTraitKey[] = [
  'directness',
  'empathyGranularity',
  'proactiveCheckIn',
  'restraint',
];

export function sanitizeDocId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  if (cleaned.length > 0 && VALID_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}`;
}

function clampUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function clampString(value: string, maxLen: number, fallback: string): string {
  const trimmed = value.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildTraitMap(traits: BoundedPersonaTraits): BoundedPersonaTraits {
  return {
    directness: clampUnit(traits.directness, DEFAULT_BASELINE_TRAITS.directness),
    empathyGranularity: clampUnit(
      traits.empathyGranularity,
      DEFAULT_BASELINE_TRAITS.empathyGranularity
    ),
    proactiveCheckIn: clampUnit(
      traits.proactiveCheckIn,
      DEFAULT_BASELINE_TRAITS.proactiveCheckIn
    ),
    restraint: clampUnit(traits.restraint, DEFAULT_BASELINE_TRAITS.restraint),
  };
}

function buildPatternCountsMap(
  counts: Readonly<Record<string, number>>
): Record<string, number> {
  const result: Record<string, number> = {};
  const venting = counts.verified_venting;
  if (typeof venting === 'number' && Number.isFinite(venting)) {
    result.verified_venting = Math.max(
      0,
      Math.min(10000, Math.round(venting))
    );
  }
  return result;
}

function buildTraitDeltasMap(
  deltas: Partial<Record<PersonaTraitKey, number>>
): Partial<Record<PersonaTraitKey, number>> {
  const result: Partial<Record<PersonaTraitKey, number>> = {};
  for (const key of TRAIT_KEYS) {
    const val = deltas[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      result[key] = Math.max(-1, Math.min(1, Math.round(val * 1000) / 1000));
    }
  }
  return result;
}

// ==================== 1. User Profile ====================

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const displayName = clampString(
    user.displayName || user.email?.split('@')[0] || '研究者',
    80,
    '研究者'
  );

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId: user.uid,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.displayName !== displayName) {
      await updateDoc(ref, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== 2. Annotations ====================

function sanitizeAnnotationFields(annotation: EmotionAnnotation) {
  const valence = clampCoord(annotation.valence);
  const arousal = clampCoord(annotation.arousal);
  const quadrant: QuadrantId =
    annotation.quadrant === 'high-positive' ||
    annotation.quadrant === 'low-positive' ||
    annotation.quadrant === 'high-negative' ||
    annotation.quadrant === 'low-negative'
      ? annotation.quadrant
      : getQuadrant(valence, arousal);

  return {
    utterance: clampString(annotation.utterance, 1000, '（空白记录）'),
    context: clampString(annotation.context, 64, '观察笔记'),
    valence,
    arousal,
    primaryLabel: clampString(annotation.primaryLabel, 40, '中性'),
    quadrant,
    displayTime: clampString(annotation.createdAt, 32, '2026-11-26 00:00'),
  };
}

export function subscribeAnnotations(
  uid: string,
  onData: (annotations: EmotionAnnotation[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `users/${uid}/annotations`;
  const q = query(
    collection(db, 'users', uid, 'annotations'),
    where('userId', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: EmotionAnnotation[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const valence =
          typeof d.valence === 'number' ? clampCoord(d.valence) : 0;
        const arousal =
          typeof d.arousal === 'number' ? clampCoord(d.arousal) : 0;
        const quadrant: QuadrantId =
          d.quadrant === 'high-positive' ||
          d.quadrant === 'low-positive' ||
          d.quadrant === 'high-negative' ||
          d.quadrant === 'low-negative'
            ? d.quadrant
            : getQuadrant(valence, arousal);

        return {
          id: docSnap.id,
          utterance: typeof d.utterance === 'string' ? d.utterance : '',
          context: typeof d.context === 'string' ? d.context : '观察笔记',
          valence,
          arousal,
          primaryLabel:
            typeof d.primaryLabel === 'string' ? d.primaryLabel : '中性',
          quadrant,
          createdAt:
            typeof d.displayTime === 'string'
              ? d.displayTime
              : '2026-11-26 00:00',
        };
      });

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
          return;
        }
        throw wrapped;
      }
    }
  );
}

export async function createAnnotationDoc(
  uid: string,
  annotation: EmotionAnnotation
): Promise<string> {
  const docId = sanitizeDocId(annotation.id, 'ann');
  const path = `users/${uid}/annotations/${docId}`;
  const fields = sanitizeAnnotationFields(annotation);

  try {
    await setDoc(doc(db, 'users', uid, 'annotations', docId), {
      userId: uid,
      ...fields,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAnnotationDoc(
  uid: string,
  annotation: EmotionAnnotation
): Promise<void> {
  const docId = sanitizeDocId(annotation.id, 'ann');
  const path = `users/${uid}/annotations/${docId}`;
  const fields = sanitizeAnnotationFields(annotation);

  try {
    await updateDoc(doc(db, 'users', uid, 'annotations', docId), {
      ...fields,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAnnotationDoc(
  uid: string,
  annotationId: string
): Promise<void> {
  const docId = sanitizeDocId(annotationId, 'ann');
  const path = `users/${uid}/annotations/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'annotations', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchCreateAnnotations(
  uid: string,
  items: readonly EmotionAnnotation[],
  existingIds: ReadonlySet<string>
): Promise<number> {
  const toCreate = items.filter(
    (item) => !existingIds.has(sanitizeDocId(item.id, 'ann'))
  );
  if (toCreate.length === 0) return 0;

  const path = `users/${uid}/annotations`;
  let created = 0;

  try {
    for (let i = 0; i < toCreate.length; i += 400) {
      const chunk = toCreate.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const docId = sanitizeDocId(item.id, 'ann');
        const fields = sanitizeAnnotationFields(item);
        batch.set(doc(db, 'users', uid, 'annotations', docId), {
          userId: uid,
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        created += 1;
      }
      await batch.commit();
    }
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function replaceAllAnnotationsInCloud(
  uid: string,
  currentCloudIds: readonly string[],
  nextItems: readonly EmotionAnnotation[]
): Promise<void> {
  const path = `users/${uid}/annotations`;
  const nextIds = new Set(nextItems.map((item) => sanitizeDocId(item.id, 'ann')));

  try {
    const batch = writeBatch(db);
    for (const oldId of currentCloudIds) {
      const safeOldId = sanitizeDocId(oldId, 'ann');
      if (!nextIds.has(safeOldId)) {
        batch.delete(doc(db, 'users', uid, 'annotations', safeOldId));
      }
    }
    const existingSet = new Set(
      currentCloudIds.map((id) => sanitizeDocId(id, 'ann'))
    );
    for (const item of nextItems.slice(0, 200)) {
      const docId = sanitizeDocId(item.id, 'ann');
      const fields = sanitizeAnnotationFields(item);
      const ref = doc(db, 'users', uid, 'annotations', docId);
      if (existingSet.has(docId)) {
        batch.update(ref, {
          ...fields,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          userId: uid,
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== 3. Dynamic Concerns ====================

function sanitizeConcernFields(concern: CurrentConcern) {
  const keywords = concern.topicKeywords
    .map((k) => k.trim().slice(0, 32))
    .filter((k) => k.length > 0)
    .slice(0, 6);

  return {
    topicKeywords: keywords.length > 0 ? keywords : ['未命名关切'],
    targetValenceDirection:
      concern.targetValenceDirection === -1 ||
      concern.targetValenceDirection === 1
        ? concern.targetValenceDirection
        : 0,
    targetArousalDirection:
      concern.targetArousalDirection === -1 ||
      concern.targetArousalDirection === 1
        ? concern.targetArousalDirection
        : 0,
    weight: clampUnit(concern.weight, 0.5),
    sourceEventId: clampString(concern.sourceEventId, 64, 'evt-unknown'),
    expiresAt: clampString(
      concern.expiresAt,
      40,
      new Date(Date.now() + 24 * 3600_000).toISOString()
    ),
    origin: 'dynamic' as const,
  };
}

export function subscribeDynamicConcerns(
  uid: string,
  onData: (concerns: CurrentConcern[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `users/${uid}/dynamicConcerns`;
  const q = query(
    collection(db, 'users', uid, 'dynamicConcerns'),
    where('userId', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: CurrentConcern[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const topicKeywords = Array.isArray(d.topicKeywords)
          ? d.topicKeywords.filter((k): k is string => typeof k === 'string')
          : [];
        return {
          id: docSnap.id,
          topicKeywords,
          targetValenceDirection:
            d.targetValenceDirection === -1 || d.targetValenceDirection === 1
              ? d.targetValenceDirection
              : 0,
          targetArousalDirection:
            d.targetArousalDirection === -1 || d.targetArousalDirection === 1
              ? d.targetArousalDirection
              : 0,
          weight: typeof d.weight === 'number' ? clampUnit(d.weight, 0.5) : 0.5,
          sourceEventId:
            typeof d.sourceEventId === 'string' ? d.sourceEventId : 'evt',
          expiresAt:
            typeof d.expiresAt === 'string'
              ? d.expiresAt
              : new Date().toISOString(),
          origin: 'dynamic',
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
          return;
        }
        throw wrapped;
      }
    }
  );
}

export async function syncDynamicConcernsToCloud(
  uid: string,
  nextConcerns: readonly CurrentConcern[],
  existingCloudIds: ReadonlySet<string>
): Promise<void> {
  const path = `users/${uid}/dynamicConcerns`;
  const nextIds = new Set<string>();

  try {
    const batch = writeBatch(db);
    for (const concern of nextConcerns.filter((c) => c.origin === 'dynamic')) {
      const docId = sanitizeDocId(concern.id, 'dyn');
      nextIds.add(docId);
      const fields = sanitizeConcernFields(concern);
      const ref = doc(db, 'users', uid, 'dynamicConcerns', docId);
      if (existingCloudIds.has(docId)) {
        batch.update(ref, {
          topicKeywords: fields.topicKeywords,
          targetValenceDirection: fields.targetValenceDirection,
          targetArousalDirection: fields.targetArousalDirection,
          weight: fields.weight,
          sourceEventId: fields.sourceEventId,
          expiresAt: fields.expiresAt,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          userId: uid,
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    for (const oldId of existingCloudIds) {
      if (!nextIds.has(oldId)) {
        batch.delete(doc(db, 'users', uid, 'dynamicConcerns', oldId));
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== 4. Persona Growth (State + Preferences + Logs) ====================

export interface PersonaCloudSnapshotMeta {
  hasStateDoc: boolean;
  prefKeys: Set<string>;
  logsById: Map<string, { reverted: boolean }>;
}

export function subscribePersonaGrowth(
  uid: string,
  onData: (state: PersonaGrowthState, meta: PersonaCloudSnapshotMeta) => void,
  onError?: (err: Error) => void
): () => void {
  let stateDoc: Record<string, unknown> | null = null;
  let hasStateDoc = false;
  let prefDocs: RelationshipPreference[] = [];
  let prefKeys = new Set<string>();
  let logDocs: PersonaGrowthLogEntry[] = [];
  let logsById = new Map<string, { reverted: boolean }>();

  let stateReady = false;
  let prefsReady = false;
  let logsReady = false;

  const emitIfReady = () => {
    if (!stateReady || !prefsReady || !logsReady) return;
    if (!hasStateDoc && prefDocs.length === 0 && logDocs.length === 0) {
      onData(createInitialPersonaGrowthState('2026-11-25T08:00:00Z'), {
        hasStateDoc: false,
        prefKeys: new Set(),
        logsById: new Map(),
      });
      return;
    }

    const assembled = sanitizePersonaGrowthState(
      {
        baselineTraits: stateDoc?.baselineTraits ?? DEFAULT_BASELINE_TRAITS,
        traits: stateDoc?.traits ?? DEFAULT_BASELINE_TRAITS,
        maxTraitDrift:
          typeof stateDoc?.maxTraitDrift === 'number'
            ? stateDoc.maxTraitDrift
            : MAX_TRAIT_DRIFT,
        preferences: prefDocs,
        patternCounts: stateDoc?.patternCounts ?? {},
        changelog: [...logDocs].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp)
        ),
        updatedAt:
          typeof stateDoc?.lastSyncIso === 'string'
            ? stateDoc.lastSyncIso
            : new Date().toISOString(),
      },
      '2026-11-25T08:00:00Z'
    );

    onData(assembled, {
      hasStateDoc,
      prefKeys: new Set(prefKeys),
      logsById: new Map(logsById),
    });
  };

  const statePath = `users/${uid}/personaStates/current`;
  const unsubState = onSnapshot(
    doc(db, 'users', uid, 'personaStates', 'current'),
    (snap) => {
      hasStateDoc = snap.exists();
      stateDoc = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      stateReady = true;
      emitIfReady();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, statePath);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
          return;
        }
        throw wrapped;
      }
    }
  );

  const prefsPath = `users/${uid}/personaPreferences`;
  const unsubPrefs = onSnapshot(
    query(
      collection(db, 'users', uid, 'personaPreferences'),
      where('userId', '==', uid)
    ),
    (snap) => {
      const nextKeys = new Set<string>();
      const nextPrefs: RelationshipPreference[] = [];
      for (const docSnap of snap.docs) {
        const d = docSnap.data();
        const key = d.key as RelationshipPreferenceKey;
        if (!VALID_PREFERENCE_KEYS.has(key)) continue;
        nextKeys.add(docSnap.id);
        nextPrefs.push({
          key,
          scope: VALID_SCOPES.has(d.scope) ? d.scope : 'global',
          label: typeof d.label === 'string' ? d.label : key,
          description: typeof d.description === 'string' ? d.description : '',
          confidence:
            typeof d.confidence === 'number' ? clampUnit(d.confidence, 0.5) : 0.5,
          evidenceCount:
            typeof d.evidenceCount === 'number' ? Math.max(1, d.evidenceCount) : 1,
          evidenceIds: Array.isArray(d.evidenceIds)
            ? d.evidenceIds.filter((x): x is string => typeof x === 'string')
            : [],
          locked: Boolean(d.locked),
          updatedAt:
            typeof d.updatedAtIso === 'string'
              ? d.updatedAtIso
              : new Date().toISOString(),
          expiresAt:
            typeof d.expiresAtIso === 'string' && d.expiresAtIso.length > 0
              ? d.expiresAtIso
              : null,
        });
      }
      prefKeys = nextKeys;
      prefDocs = nextPrefs;
      prefsReady = true;
      emitIfReady();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, prefsPath);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
          return;
        }
        throw wrapped;
      }
    }
  );

  const logsPath = `users/${uid}/personaLogs`;
  const unsubLogs = onSnapshot(
    query(
      collection(db, 'users', uid, 'personaLogs'),
      where('userId', '==', uid)
    ),
    (snap) => {
      const nextMap = new Map<string, { reverted: boolean }>();
      const nextLogs: PersonaGrowthLogEntry[] = [];
      for (const docSnap of snap.docs) {
        const d = docSnap.data();
        const reverted = Boolean(d.reverted);
        nextMap.set(docSnap.id, { reverted });
        nextLogs.push({
          id: docSnap.id,
          timestamp:
            typeof d.timestampIso === 'string'
              ? d.timestampIso
              : new Date().toISOString(),
          eventId: typeof d.eventId === 'string' ? d.eventId : 'evt',
          triggerKind: VALID_TRIGGER_KINDS.has(d.triggerKind)
            ? d.triggerKind
            : 'explicit_preference',
          summary: typeof d.summary === 'string' ? d.summary : '',
          evidenceIds: Array.isArray(d.evidenceIds)
            ? d.evidenceIds.filter((x): x is string => typeof x === 'string')
            : [],
          traitDeltas:
            d.traitDeltas && typeof d.traitDeltas === 'object'
              ? buildTraitDeltasMap(
                  d.traitDeltas as Partial<Record<PersonaTraitKey, number>>
                )
              : {},
          preferenceKey:
            typeof d.preferenceKey === 'string' &&
            VALID_PREFERENCE_KEYS.has(d.preferenceKey as RelationshipPreferenceKey)
              ? (d.preferenceKey as RelationshipPreferenceKey)
              : undefined,
          createdPreference: Boolean(d.createdPreference),
          reverted,
        });
      }
      logsById = nextMap;
      logDocs = nextLogs;
      logsReady = true;
      emitIfReady();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, logsPath);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
          return;
        }
        throw wrapped;
      }
    }
  );

  return () => {
    unsubState();
    unsubPrefs();
    unsubLogs();
  };
}

export async function savePersonaGrowthToCloud(
  uid: string,
  nextState: PersonaGrowthState,
  meta: PersonaCloudSnapshotMeta
): Promise<PersonaCloudSnapshotMeta> {
  const path = `users/${uid}/personaStates/current`;
  const nextPrefKeys = new Set<string>();
  const nextLogsById = new Map<string, { reverted: boolean }>();

  try {
    const batch = writeBatch(db);

    // 1) Profile state doc ('current')
    const stateRef = doc(db, 'users', uid, 'personaStates', 'current');
    const baselineTraits = buildTraitMap(nextState.baselineTraits);
    const traits = buildTraitMap(nextState.traits);
    const maxTraitDrift = Math.max(
      0,
      Math.min(0.5, Number.isFinite(nextState.maxTraitDrift) ? nextState.maxTraitDrift : MAX_TRAIT_DRIFT)
    );
    const patternCounts = buildPatternCountsMap(nextState.patternCounts);
    const lastSyncIso = clampString(
      nextState.updatedAt,
      40,
      new Date().toISOString()
    );

    if (meta.hasStateDoc) {
      batch.update(stateRef, {
        baselineTraits,
        traits,
        maxTraitDrift,
        patternCounts,
        lastSyncIso,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(stateRef, {
        userId: uid,
        baselineTraits,
        traits,
        maxTraitDrift,
        patternCounts,
        lastSyncIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 2) Scoped preferences subcollection
    for (const pref of nextState.preferences) {
      if (!VALID_PREFERENCE_KEYS.has(pref.key)) continue;
      nextPrefKeys.add(pref.key);
      const prefRef = doc(db, 'users', uid, 'personaPreferences', pref.key);
      const evidenceIds = pref.evidenceIds
        .map((id) => clampString(id, 64, 'ev'))
        .slice(0, 12);
      const payloadCommon = {
        scope: VALID_SCOPES.has(pref.scope) ? pref.scope : 'global',
        label: clampString(pref.label, 64, pref.key),
        description: clampString(pref.description, 200, pref.label),
        confidence: clampUnit(pref.confidence, 0.5),
        evidenceCount: Math.max(
          1,
          Math.min(1000, Math.round(pref.evidenceCount || 1))
        ),
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : ['ev-seed'],
        locked: Boolean(pref.locked),
        updatedAtIso: clampString(
          pref.updatedAt,
          40,
          new Date().toISOString()
        ),
        expiresAtIso: pref.expiresAt ? pref.expiresAt.slice(0, 40) : '',
      };

      if (meta.prefKeys.has(pref.key)) {
        batch.update(prefRef, {
          ...payloadCommon,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(prefRef, {
          userId: uid,
          key: pref.key,
          ...payloadCommon,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    for (const oldKey of meta.prefKeys) {
      if (!nextPrefKeys.has(oldKey)) {
        batch.delete(doc(db, 'users', uid, 'personaPreferences', oldKey));
      }
    }

    // 3) Auditable changelog subcollection (respecting terminal lock on reverted == true)
    const nextLogIds = new Set<string>();
    for (const entry of nextState.changelog.slice(0, 24)) {
      const logId = sanitizeDocId(entry.id, 'pgl');
      nextLogIds.add(logId);
      const existingLog = meta.logsById.get(logId);
      const logRef = doc(db, 'users', uid, 'personaLogs', logId);

      if (!existingLog) {
        const evidenceIds = entry.evidenceIds
          .map((id) => clampString(id, 64, 'ev'))
          .slice(0, 12);
        batch.set(logRef, {
          userId: uid,
          timestampIso: clampString(
            entry.timestamp,
            40,
            new Date().toISOString()
          ),
          eventId: clampString(entry.eventId, 64, 'evt'),
          triggerKind: VALID_TRIGGER_KINDS.has(entry.triggerKind)
            ? entry.triggerKind
            : 'explicit_preference',
          summary: clampString(entry.summary, 300, '人格状态更新'),
          evidenceIds,
          traitDeltas: buildTraitDeltasMap(entry.traitDeltas),
          preferenceKey:
            entry.preferenceKey && VALID_PREFERENCE_KEYS.has(entry.preferenceKey)
              ? entry.preferenceKey
              : '',
          createdPreference: Boolean(entry.createdPreference),
          reverted: Boolean(entry.reverted),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        nextLogsById.set(logId, { reverted: Boolean(entry.reverted) });
      } else if (!existingLog.reverted && entry.reverted) {
        // Terminal transition: false -> true
        batch.update(logRef, {
          reverted: true,
          updatedAt: serverTimestamp(),
        });
        nextLogsById.set(logId, { reverted: true });
      } else {
        nextLogsById.set(logId, existingLog);
      }
    }

    for (const oldLogId of meta.logsById.keys()) {
      if (!nextLogIds.has(oldLogId)) {
        batch.delete(doc(db, 'users', uid, 'personaLogs', oldLogId));
      }
    }

    await batch.commit();

    return {
      hasStateDoc: true,
      prefKeys: nextPrefKeys,
      logsById: nextLogsById,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== 5. Full Workspace Local-to-Cloud Migration ====================

export interface WorkspaceMigrationResult {
  readonly annotationsCreated: number;
  readonly concernsCreated: number;
  readonly personaMigrated: boolean;
}

/**
 * 全量工作区本地迁移：将本地浏览器中尚未存在于云端的标注记录、动态关切（合并去重）
 * 以及人格成长档案（仅当云端尚无成长记录时写入，避免覆盖已有云端档案）安全同步至个人 Firestore。
 */
export async function migrateLocalWorkspaceToCloud(params: {
  readonly uid: string;
  readonly localAnnotations: readonly EmotionAnnotation[];
  readonly existingCloudAnnotationIds: ReadonlySet<string>;
  readonly localConcerns: readonly CurrentConcern[];
  readonly localPersona: PersonaGrowthState | null;
}): Promise<WorkspaceMigrationResult> {
  const {
    uid,
    localAnnotations,
    existingCloudAnnotationIds,
    localConcerns,
    localPersona,
  } = params;

  // 1) 增量写入缺失的标注记录（不覆盖云端已有同 ID 记录）
  const annotationsCreated = await batchCreateAnnotations(
    uid,
    localAnnotations,
    existingCloudAnnotationIds
  );

  // 2) 增量合并本地动态关切（仅补齐云端不存在的动态关切，不删除已有云端项）
  let concernsCreated = 0;
  const dynamicLocals = localConcerns.filter((c) => c.origin === 'dynamic');
  if (dynamicLocals.length > 0) {
    const concernsPath = `users/${uid}/dynamicConcerns`;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'users', uid, 'dynamicConcerns'),
          where('userId', '==', uid)
        )
      );
      const existingConcernIds = new Set(snap.docs.map((d) => d.id));
      const missingConcerns = dynamicLocals.filter(
        (c) => !existingConcernIds.has(sanitizeDocId(c.id, 'dyn'))
      );

      if (missingConcerns.length > 0) {
        const batch = writeBatch(db);
        for (const concern of missingConcerns.slice(0, 4)) {
          const docId = sanitizeDocId(concern.id, 'dyn');
          const fields = sanitizeConcernFields(concern);
          batch.set(doc(db, 'users', uid, 'dynamicConcerns', docId), {
            userId: uid,
            ...fields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          concernsCreated += 1;
        }
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, concernsPath);
    }
  }

  // 3) 迁移本地人格成长状态（仅当本地存在成长记录且云端尚未建立成长档案时同步）
  let personaMigrated = false;
  if (localPersona) {
    const hasLocalGrowth =
      localPersona.preferences.length > 0 ||
      localPersona.changelog.length > 0 ||
      TRAIT_KEYS.some(
        (k) =>
          Math.abs(localPersona.traits[k] - localPersona.baselineTraits[k]) > 1e-6
      );

    if (hasLocalGrowth) {
      const statePath = `users/${uid}/personaStates/current`;
      try {
        const [stateSnap, prefsSnap, logsSnap] = await Promise.all([
          getDoc(doc(db, 'users', uid, 'personaStates', 'current')),
          getDocs(
            query(
              collection(db, 'users', uid, 'personaPreferences'),
              where('userId', '==', uid)
            )
          ),
          getDocs(
            query(
              collection(db, 'users', uid, 'personaLogs'),
              where('userId', '==', uid)
            )
          ),
        ]);

        const cloudIsFresh =
          prefsSnap.empty && logsSnap.empty && !stateSnap.exists();
        if (cloudIsFresh) {
          await savePersonaGrowthToCloud(uid, localPersona, {
            hasStateDoc: false,
            prefKeys: new Set(),
            logsById: new Map(),
          });
          personaMigrated = true;
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, statePath);
      }
    }
  }

  return {
    annotationsCreated,
    concernsCreated,
    personaMigrated,
  };
}

