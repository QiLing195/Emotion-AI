import { Worker } from 'node:worker_threads';
import type { DaoScope } from '../contracts/dao-v31/index.ts';
import type { MemoryQuery } from './trackTypes.ts';
import type { QuickResult } from './memoryRetrieval.ts';

export type MemoryWork = Readonly<{
  id: number; scope: DaoScope; query: MemoryQuery; now: number; deadline: number;
}>;
export type MemoryReply = Readonly<{ id: number; result: QuickResult | null; failed?: boolean }>;

class MemoryWorkerError extends Error {
  constructor() { super('B1 SQLite worker unavailable'); }
}

export class MemoryWorker {
  readonly #directory: string;
  #worker?: Worker;
  #closed = false;
  #serial = 0;
  readonly #pending = new Map<number, {
    resolve: (result: QuickResult | null) => void; reject: (error: Error) => void;
  }>();

  constructor(directory: string) { this.#directory = directory; }

  #get() {
    if (this.#closed) throw new MemoryWorkerError();
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('./memoryWorkerEntry.ts', import.meta.url), { workerData: this.#directory });
    this.#worker = worker;
    const disconnect = () => {
      if (this.#worker !== worker) return;
      this.#worker = undefined;
      for (const entry of this.#pending.values()) entry.reject(new MemoryWorkerError());
      this.#pending.clear();
    };
    worker.on('error', disconnect);
    worker.on('exit', disconnect);
    worker.on('message', (reply: MemoryReply) => {
      const entry = this.#pending.get(reply.id);
      if (!entry) return;
      this.#pending.delete(reply.id);
      if (reply.failed) entry.reject(new MemoryWorkerError());
      else entry.resolve(reply.result);
    });
    worker.unref();
    return worker;
  }

  lookup = (scope: DaoScope, query: MemoryQuery, now: number, budgetMs: number) => {
    if (this.#pending.size >= 32) return Promise.resolve(null);
    const worker = this.#get();
    const id = ++this.#serial;
    return new Promise<QuickResult | null>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        const work: MemoryWork = { id, scope, query, now, deadline: Date.now() + Math.ceil(budgetMs) };
        worker.postMessage(work);
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  };

  async close() {
    this.#closed = true;
    await this.#worker?.terminate();
  }
}
