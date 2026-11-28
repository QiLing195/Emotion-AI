import { DAO_PROJECTION_VERSION } from '../contracts/dao-v31/index.ts';
import type { DaoResponseData, DaoScope } from '../contracts/dao-v31/index.ts';
import type { M1PersistencePort } from './m1Types.ts';
import { initialRuntime } from './projection.ts';
import { eventView, PersonalDataHub } from './dataHub.ts';

export class DaoViews {
  readonly #store: M1PersistencePort;
  readonly #hub: PersonalDataHub;

  constructor(store: M1PersistencePort, hub: PersonalDataHub) {
    this.#store = store;
    this.#hub = hub;
  }

  snapshot(scope: DaoScope) {
    return this.#store.read(scope, async (tx) => {
      const { state, hash } = tx.runtime() ?? initialRuntime;
      const data: DaoResponseData<'getStateSnapshot'> = {
        scope, sequence: state.sequence, stateVersion: state.stateVersion, stateHash: hash,
        userProfile: { version: 0, items: [] },
        characterPersonality: { version: 0, constitutionId: 'baseline', traits: {}, interactionObservationIds: [] },
        relationshipState: { version: 0, affinity: 0, trust: 0 },
        characterEmotion: { version: 0, valence: 0, arousal: 0, A: 0, B: 0, layers: {} },
        regulationState: { regulation: 0, recoveryRate: 0, resilience: 0, stressLoad: 0, adaptation: 0 },
        emotionProvenance: null,
        trackMetrics: (['A', 'B1', 'B2', 'C', 'D'] as const).map((track) => ({
          track, pending: 0, completed: 0, failures: 0, degraded: false,
        })),
      };
      return { data, version: await tx.getConsentVersion() };
    });
  }

  events(scope: DaoScope, after: number, limit: number) {
    return this.#store.read(scope, async (tx) => {
      const { entities, proofIds } = await this.#hub.visible(tx);
      const items: DaoResponseData<'listEvents'>['items'][number][] = [];
      let position = after;
      while (items.length <= limit) {
        const rows = tx.history(position, Math.max(limit, 50));
        for (const row of rows) {
          const visible = eventView(row.event, entities, proofIds);
          if (visible) items.push({ event: visible, commits: [row.commit] });
          if (items.length > limit) break;
        }
        if (rows.length === 0 || items.length > limit) break;
        position = rows[rows.length - 1].event.sequence;
      }
      const next = items.length > limit ? items[limit - 1].event.sequence : undefined;
      return { items: items.slice(0, limit), next, version: await tx.getConsentVersion() };
    });
  }

  outbox(scope: DaoScope, after: number) {
    return this.#store.read(scope, async (tx) => {
      const outbox = tx.outbox(after, 64);
      if (!outbox.length) return { lastId: after, frames: [] };
      const { entities, proofIds } = await this.#hub.visible(tx);
      const frames: { id: number; name: 'system_event' | 'commit_record' | 'consent_revoked'; data: unknown }[] = [];
      for (const { id, notification } of outbox) {
        if (notification.event === 'consent_revoked') {
          frames.push({ id, name: notification.event, data: notification.data });
          continue;
        }
        const event = await tx.getEvent(notification.eventId);
        const visible = event && eventView(event, entities, proofIds);
        if (!visible) continue;
        const data = notification.event === 'system_event' ? visible : await tx.getCommit(visible.eventId, DAO_PROJECTION_VERSION);
        if (data) frames.push({ id, name: notification.event, data });
      }
      return { lastId: outbox[outbox.length - 1].id, frames, version: await tx.getConsentVersion() };
    });
  }
}
