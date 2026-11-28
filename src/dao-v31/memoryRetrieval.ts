import { randomUUID } from 'node:crypto';
import type { DaoScope, EntityRef } from '../contracts/dao-v31/index.ts';
import type { ConsentedEntity, M1PersistencePort, M1ReadTransaction } from './m1Types.ts';
import { invalid } from './errors.ts';
import { isIdentifier } from './sessionAuth.ts';
import { PersonalDataHub } from './dataHub.ts';
import { isUnit, DAY } from './dynamics.ts';
import { normalizeTerm } from './trackTypes.ts';
import type { MemoryCandidate, MemoryQuery, RetrievalContext } from './trackTypes.ts';
import { round6 } from './determinism.ts';
import { meter, trackUpdate } from './trackMetrics.ts';

export const B1_BUDGET_MS = 30;
export type RetrievalMetrics = Readonly<{
  latencyMs: number; timeout: boolean; resultCount: number; indexVersion: string; fallbackUsed: boolean;
}>;
export type MemoryHit = Readonly<{ entity: ConsentedEntity; score: number }>;
export type QuickResult = Readonly<{ hits: readonly MemoryHit[]; indexVersion: string; consentVersion: number }>;
export type QuickLookup = (scope: DaoScope, query: MemoryQuery, now: number, budgetMs: number) => Promise<QuickResult | null>;
const version = (tx: M1ReadTransaction) => tx.runtime()?.state.stateVersion ?? 0;

function normalized(query: MemoryQuery): MemoryQuery {
  if (!query || typeof query.text !== 'string' || query.text.length > 256
    || [query.tags, query.entities].some((terms) => terms !== undefined && (!Array.isArray(terms)
      || terms.length > 16 || terms.some((item) => typeof item !== 'string' || item.length > 128)))
    || (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 20))) {
    throw invalid('Invalid memory retrieval query');
  }
  const terms = (values: readonly string[] = []) => [...new Set(values.map(normalizeTerm).filter(Boolean))];
  return { text: normalizeTerm(query.text), tags: terms(query.tags), entities: terms(query.entities), limit: query.limit ?? 8 };
}

function rank(candidates: readonly MemoryCandidate[], authorized: ReadonlySet<string>, now: number, limit: number) {
  return candidates.filter(({ entity }) => authorized.has(entity.ref.entityId)).map(({ entity, textRank, metadataMatches }) => {
    const confidence = isUnit(entity.body.confidence) ? entity.body.confidence : 0.5;
    const importance = isUnit(entity.body.importance) ? entity.body.importance : 0.5;
    const recency = Math.exp(-Math.max(0, now - Date.parse(entity.occurredAt)) / (30 * DAY));
    // SQLite assigns better BM25 relevance a lower value. Bounded scores let
    // a real metadata match still matter when a query term is very common.
    const text = textRank === null ? 0 : 0.75 + 0.25 * -Math.expm1(Math.min(0, textRank));
    return { entity, score: round6(text * 0.4 + Math.min(1, metadataMatches / 2) * 0.28 + confidence * 0.12 + importance * 0.12 + recency * 0.08) };
  }).sort((a, b) => b.score - a.score || (a.entity.ref.entityId < b.entity.ref.entityId ? -1 : 1)).slice(0, limit);
}

export async function lookupMemory(tx: M1ReadTransaction, hub: PersonalDataHub, query: MemoryQuery, now: number): Promise<QuickResult> {
  const candidates = tx.memoryCandidates(query, 28);
  const visible = await hub.authorizedEvidence(tx, candidates.map(({ entity }) => entity.ref));
  return { hits: rank(candidates, visible, now, query.limit ?? 8), indexVersion: String(tx.memoryIndexVersion()),
    consentVersion: await tx.getConsentVersion() };
}

export class MemoryRetrieval {
  readonly #store: M1PersistencePort;
  readonly #hub: PersonalDataHub;
  readonly #now: () => number;
  readonly #lookup?: QuickLookup;

  constructor(store: M1PersistencePort, hub: PersonalDataHub, now = Date.now, lookup?: QuickLookup) {
    this.#store = store;
    this.#hub = hub;
    this.#now = now;
    this.#lookup = lookup;
  }

  async quick(scope: DaoScope, query: MemoryQuery, budgetMs = B1_BUDGET_MS): Promise<{ hits: readonly MemoryHit[]; metrics: RetrievalMetrics }> {
    const normalizedQuery = normalized(query);
    if (!Number.isFinite(budgetMs) || budgetMs < 0 || budgetMs > 1000) throw invalid('Invalid B1 latency budget');
    const start = performance.now();
    let timer: NodeJS.Timeout | undefined;
    let cancelled = budgetMs === 0;
    let indexVersion = 'unknown';
    const fallback = (timeout: boolean) => {
      cancelled = true;
      const latencyMs = round6(performance.now() - start);
      meter(this.#store, scope, 'B1', 'degraded', latencyMs, timeout ? 'timeout' : 'unavailable');
      return { hits: [], metrics: { latencyMs, timeout, resultCount: 0, indexVersion, fallbackUsed: true } };
    };
    if (cancelled) return fallback(true);
    try {
      const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => { cancelled = true; resolve(null); }, budgetMs); });
      const lookup = this.#lookup;
      const work = lookup ? lookup(scope, normalizedQuery, this.#now(), budgetMs).then(async (result) => {
        if (!result || cancelled) return null;
        const current = await this.#store.read(scope, async (tx) => !cancelled
          && result.indexVersion === String(tx.memoryIndexVersion()) && result.consentVersion === await tx.getConsentVersion());
        return current ? result : { ...result, hits: [], stale: true as const };
      }) : this.#store.read(scope, async (tx) => {
        if (cancelled || performance.now() - start >= budgetMs) return null;
        return lookupMemory(tx, this.#hub, normalizedQuery, this.#now());
      });
      const result = await Promise.race([deadline, work]);
      if (!result || performance.now() - start >= budgetMs) return fallback(true);
      if ('stale' in result) return fallback(false);
      const { hits } = result;
      indexVersion = result.indexVersion;
      const latencyMs = round6(performance.now() - start);
      meter(this.#store, scope, 'B1', 'completed', latencyMs);
      return { hits, metrics: { latencyMs, timeout: false, resultCount: hits.length, indexVersion, fallbackUsed: false } };
    } catch {
      return fallback(false);
    } finally {
      clearTimeout(timer);
    }
  }

  async context(tx: M1ReadTransaction, turnId: string, ttlMs: number): Promise<RetrievalContext> {
    if (!isIdentifier(turnId) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 300_000) throw invalid('Invalid retrieval lifetime');
    const now = this.#now();
    return {
      retrievalId: randomUUID(), turnId, snapshotVersion: version(tx), memoryIndexVersion: tx.memoryIndexVersion(),
      consentVersion: await tx.getConsentVersion(), retrievedAt: now, expiresAt: now + ttlMs,
    };
  }

  async valid(tx: M1ReadTransaction, context: RetrievalContext, turnId: string) {
    const time = this.#now();
    return context.turnId === turnId && time >= context.retrievedAt && time < context.expiresAt
      && context.snapshotVersion === version(tx) && context.memoryIndexVersion === tx.memoryIndexVersion()
      && context.consentVersion === await tx.getConsentVersion();
  }

  async deep(scope: DaoScope, turnId: string, retriever: (context: RetrievalContext, signal: AbortSignal) => Promise<readonly EntityRef[]>, ttlMs = 5000) {
    const context = await this.#store.write(scope, async (tx) => {
      const value = await this.context(tx, turnId, ttlMs);
      trackUpdate(tx, { track: 'B2', status: 'running', jobId: value.retrievalId }, 1);
      return value;
    });
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let errorStatus: 'expired' | 'failed' | undefined;
    let matches: readonly EntityRef[] = [];
    try {
      const timeout = new Promise<null>((done) => {
        timer = setTimeout(() => { controller.abort(); done(null); }, Math.max(0, context.expiresAt - this.#now()));
      });
      const result = await Promise.race([retriever(context, controller.signal), timeout]);
      if (result === null) errorStatus = 'expired';
      else if (result.length > 64 || result.some((entity) => entity.kind !== 'memory' || !isIdentifier(entity.entityId))) errorStatus = 'failed';
      else matches = result;
    } catch {
      errorStatus = 'failed';
    } finally { clearTimeout(timer); }
    return this.#store.write(scope, async (tx) => {
      const permitted = await this.valid(tx, context, turnId) && (await this.#hub.authorizedEvidence(tx, matches)).size
        === new Set(matches.map((ref) => ref.entityId)).size;
      const status = errorStatus ?? (permitted ? 'completed' : 'degraded');
      trackUpdate(tx, { track: 'B2', status, jobId: context.retrievalId,
        ...(status === 'degraded' && { detail: 'stale_retrieval_context' }) }, -1, this.#now() - context.retrievedAt);
      return { context, status, matches: status === 'completed' ? matches : [] };
    });
  }
}
