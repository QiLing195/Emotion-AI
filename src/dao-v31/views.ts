import { DAO_PROJECTION_VERSION } from '../contracts/dao-v31/index.ts';
import type { DaoResponseData, DaoScope } from '../contracts/dao-v31/index.ts';
import type { M1PersistencePort } from './m1Types.ts';
import { initialRuntime } from './projection.ts';
import { eventView, PersonalDataHub } from './dataHub.ts';
import { initialEmotion } from './emotionModel.ts';
import { emptyTrack, tracks } from './trackTypes.ts';

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
      const emotion = state.emotion ?? initialEmotion;
      const metrics = new Map(tx.trackMetrics().map((metric) => [metric.track, metric]));
      const latest = emotion.provenance;
      const evidence = latest ? (await this.#hub.visible(tx)).entities : new Set<string>();
      const data: DaoResponseData<'getStateSnapshot'> = {
        scope, sequence: state.sequence, stateVersion: state.stateVersion, stateHash: hash,
        userProfile: { version: 0, items: [] },
        characterPersonality: { version: 0, constitutionId: 'baseline', traits: {}, interactionObservationIds: [] },
        relationshipState: { version: 0, affinity: 0, trust: 0 },
        characterEmotion: {
          version: emotion.version, valence: emotion.valence, arousal: emotion.arousal, A: emotion.yi.A, B: emotion.yi.B,
          layers: { ...emotion.basic, ...emotion.cognitive, ...emotion.relationship },
        },
        regulationState: emotion.yi.regulation,
        emotionProvenance: latest && latest.evidenceIds.every((id) => evidence.has(id)) ? latest : null,
        trackMetrics: tracks.map((track) => metrics.get(track) ?? emptyTrack(track)),
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
      const frames: { id: number; name: 'system_event' | 'commit_record' | 'consent_revoked' | 'track_update'; data: unknown }[] = [];
      for (const { id, notification } of outbox) {
        if (notification.event === 'consent_revoked') {
          frames.push({ id, name: notification.event, data: notification.data });
          continue;
        }
        if (notification.event === 'track_update') {
          const reference = notification.data.eventId;
          const event = reference && await tx.getEvent(reference);
          if (!reference || (event && eventView(event, entities, proofIds))) frames.push({ id, name: notification.event, data: notification.data });
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
