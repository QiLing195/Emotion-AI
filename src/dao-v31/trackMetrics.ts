import type { DaoScope, DaoStreamFrames } from '../contracts/dao-v31/index.ts';
import type { M1PersistencePort, M1WriteTransaction } from './m1Types.ts';
import { emptyTrack } from './trackTypes.ts';
import type { Track } from './trackTypes.ts';
import { round6 } from './determinism.ts';

type TrackUpdate = DaoStreamFrames['track_update']['data'];
export function trackUpdate(tx: M1WriteTransaction, update: TrackUpdate, pendingDelta: number, durationMs?: number) {
  const prior = tx.trackMetrics().find(({ track }) => track === update.track) ?? emptyTrack(update.track);
  const { status } = update;
  const terminal = status !== 'queued' && status !== 'running';
  tx.setTrackMetrics({
    ...prior, pending: Math.max(0, prior.pending + pendingDelta),
    completed: prior.completed + Number(status === 'completed'),
    failures: prior.failures + Number(status === 'failed' || status === 'expired'),
    degraded: terminal ? status === 'degraded' || status === 'failed' || status === 'expired' : prior.degraded,
    ...(durationMs !== undefined && { lastDurationMs: round6(Math.max(0, durationMs)) }),
  });
  tx.enqueue({ event: 'track_update', data: update });
}

export function meter(store: M1PersistencePort, scope: DaoScope, track: Track, status: TrackUpdate['status'], elapsedMs: number, detail?: string) {
  // Runtime counters are ancillary; an unavailable telemetry write must not delay B1.
  void store.write(scope, (tx) => trackUpdate(tx, { track, status, ...(detail && { detail }) }, 0, elapsedMs))
    .catch(() => {});
}
