import { parentPort, workerData } from 'node:worker_threads';
import { SqliteDaoStore } from './sqliteStore.ts';
import { lookupMemory } from './memoryRetrieval.ts';
import { PersonalDataHub } from './dataHub.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { ConsentManager } from './consentManager.ts';
import type { MemoryReply, MemoryWork } from './memoryWorker.ts';

if (parentPort && typeof workerData === 'string') {
  const port = parentPort;
  const store = new SqliteDaoStore(workerData);
  const coordinator = new StateCoordinator(store);
  const consent = new ConsentManager(store, coordinator);
  const hub = new PersonalDataHub(store, consent, coordinator);
  port.on('message', (work: MemoryWork) => {
    const complete = (reply: MemoryReply) => port.postMessage(reply);
    if (Date.now() >= work.deadline) { complete({ id: work.id, result: null }); return; }
    void store.read(work.scope, (tx) => Date.now() >= work.deadline ? null : lookupMemory(tx, hub, work.query, work.now))
      .then((result) => complete({ id: work.id, result }),
        () => complete({ id: work.id, result: null, failed: true }));
  });
}
