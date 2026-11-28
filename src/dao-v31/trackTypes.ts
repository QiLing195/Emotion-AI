import type { DaoResponseData, EntityRef } from '../contracts/dao-v31/index.ts';
import type { ConsentedEntity, GrantUse } from './m1Types.ts';

export type TrackMetrics = DaoResponseData<'getStateSnapshot'>['trackMetrics'][number];
export type Track = TrackMetrics['track'];
export const tracks: readonly Track[] = ['A', 'B1', 'B2', 'C', 'D'];
export const emptyTrack = (track: Track): TrackMetrics => ({ track, pending: 0, completed: 0, failures: 0, degraded: false });

export type MemoryQuery = Readonly<{ text: string; tags?: readonly string[]; entities?: readonly string[]; limit?: number }>;
export type MemoryCandidate = Readonly<{ entity: ConsentedEntity; textRank: number | null; metadataMatches: number }>;
export type RetrievalContext = Readonly<{
  retrievalId: string; turnId: string; snapshotVersion: number; memoryIndexVersion: number;
  consentVersion: number; retrievedAt: number; expiresAt: number;
}>;

export type AppraisalJob = Readonly<{
  jobId: string; turnId: string; eventId: string; context: RetrievalContext; use: GrantUse;
  evidence: readonly EntityRef[]; dependsOn: readonly string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  attempts: number; maxRetries: number; availableAt: number; expiresAt: number;
  leaseId?: string; leaseUntil?: number; outcome?: string; commitEventId?: string;
}>;
export type CircuitState = Readonly<{ failures: number; opensUntil: number }>;

export const normalizeTerm = (value: string) => value.normalize('NFKC').trim().toLowerCase();

export function memoryTerms(body: ConsentedEntity['body']) {
  const result: { kind: 'tag' | 'entity'; term: string }[] = [];
  for (const [kind, values] of [['tag', body.tags], ['entity', body.entities]] as const) {
    if (!Array.isArray(values)) continue;
    for (const term of new Set(values.slice(0, 32).filter((value): value is string => typeof value === 'string').map(normalizeTerm))) {
      if (term && term.length <= 128) result.push({ kind, term });
    }
  }
  return result;
}
