import type { DaoScope, EntityRef } from '../contracts/dao-v31/index.ts';
import type { AppraisalInput } from './appraisal.ts';
import { AffectRuntime } from './affectRuntime.ts';
import { AppraisalQueue } from './appraisalQueue.ts';
import type { AppraisalPort } from './appraisalQueue.ts';
import type { ConsentManager } from './consentManager.ts';
import type { PersonalDataHub } from './dataHub.ts';
import { MemoryRetrieval } from './memoryRetrieval.ts';
import type { QuickLookup } from './memoryRetrieval.ts';
import type { GrantUse, M1PersistencePort } from './m1Types.ts';
import type { StateCoordinator } from './stateCoordinator.ts';
import type { WallClock } from './simulationClock.ts';
import type { MemoryQuery } from './trackTypes.ts';

type TurnWork = Readonly<{
  turnId: string;
  appraisal: AppraisalInput;
  applyEventId: string;
  settlementId: string;
  consentVersion: number;
  evidence: readonly EntityRef[];
  use: GrantUse;
  relationshipSignal: number;
  memoryQuery: MemoryQuery;
  appraisalJobId?: string;
}>;

export function createTrackRuntime(store: M1PersistencePort, consent: ConsentManager, hub: PersonalDataHub,
  coordinator: StateCoordinator, wall: WallClock = { now: Date.now }, lookup?: QuickLookup) {
  const affect = new AffectRuntime(store, consent, hub, coordinator, wall);
  const retrieval = new MemoryRetrieval(store, hub, () => wall.now(), lookup);
  const appraisals = new AppraisalQueue(store, consent, retrieval, affect, hub, () => wall.now());

  async function startTurn(scope: DaoScope, input: TurnWork) {
    // The wall clock establishes the current elapsed interval before A evaluates this turn.
    await affect.settle(scope, input.settlementId, input.consentVersion);
    const opened = await affect.openTurn(scope, input.appraisal.eventId, input.turnId, input.consentVersion);
    const snapshotVersion = (await coordinator.current(scope)).state.stateVersion;
    const [analysis, memory] = await Promise.all([
      affect.applyA(scope, input.use, {
        commitEventId: input.applyEventId, turnId: input.turnId, appraisal: input.appraisal, evidence: input.evidence,
        relationshipSignal: input.relationshipSignal, consentVersion: input.consentVersion, baseVersion: snapshotVersion,
      }),
      retrieval.quick(scope, input.memoryQuery),
    ]);
    const queued = input.appraisalJobId ? await appraisals.enqueue(scope, {
      jobId: input.appraisalJobId, eventId: input.appraisal.eventId, turnId: input.turnId,
      use: input.use, evidence: input.evidence,
    }) : null;
    return { opened, analysis, memory, queued };
  }

  return { affect, retrieval, appraisals, startTurn,
    runAppraisal: (scope: DaoScope, adapter: AppraisalPort) => appraisals.runNext(scope, adapter) };
}
