import type { Response } from 'express';
import type { ApiError, ApiMeta, DaoScope } from '../contracts/dao-v31/index.ts';
import type { M1PersistencePort } from './m1Types.ts';
import type { DaoCursors } from './cursors.ts';
import type { DaoViews } from './views.ts';

export const DAO_HEARTBEAT_MS = 25_000;
const PURPOSE = 'runtime-stream';

interface StreamOptions {
  readonly scope: DaoScope;
  readonly expiresAt: number;
  readonly lastEventId?: string;
  readonly store: M1PersistencePort;
  readonly cursors: DaoCursors;
  readonly views: DaoViews;
  readonly now: () => number;
  readonly meta: (consentVersion: number) => ApiMeta;
  readonly heartbeatMs?: number;
  readonly pollMs?: number;
}

export async function serveRuntimeStream(res: Response, options: StreamOptions) {
  const { scope, expiresAt, lastEventId, views, store, cursors, meta, now } = options;
  const initial = await store.read(scope, async (tx) => {
    const head = tx.latestOutbox();
    if (!lastEventId) return { after: head, reset: false, version: await tx.getConsentVersion() };
    const decoded = cursors.open(scope, PURPOSE, lastEventId);
    const valid = typeof decoded === 'number' && Number.isSafeInteger(decoded) && decoded > 0 && tx.hasOutbox(decoded);
    return { after: valid ? decoded : head, reset: !valid, version: await tx.getConsentVersion() };
  });
  if (res.destroyed) return;
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let closed = false;
  let busy = false;
  let position = initial.after;
  let version = initial.version;
  let poll: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let expiry: NodeJS.Timeout | undefined;
  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    clearTimeout(expiry);
    if (!res.destroyed && !res.writableEnded) res.end();
  }

  const send = (event: string, data: unknown, id?: number) => res.write(
    (id === undefined ? '' : 'id: ' + cursors.seal(scope, PURPOSE, id) + '\n')
    + 'event: ' + event + '\ndata: ' + JSON.stringify({ scope, meta: meta(version), data }) + '\n\n',
  );
  const fail = (error: ApiError) => {
    if (!closed && !res.destroyed) send('error', error);
    finish();
  };
  const expired = () => fail({ code: 'UNAUTHENTICATED', message: 'Stream token expired', retryable: false });
  res.once('close', finish);
  res.once('error', finish);
  res.on('drain', () => { void pump(); });
  res.write(': connected\n\n');
  if (initial.reset) send('stream_reset', { reason: 'cursor_unavailable' });

  async function pump() {
    if (closed || busy || res.writableNeedDrain) return;
    if (now() >= expiresAt) { expired(); return; }
    busy = true;
    try {
      const page = await views.outbox(scope, position);
      if (closed || res.destroyed) return;
      if (now() >= expiresAt) { expired(); return; }
      version = page.version ?? version;
      for (const frame of page.frames) {
        position = frame.id;
        if (!send(frame.name, frame.data, frame.id)) return;
      }
      position = page.lastId;
    } catch {
      fail({ code: 'UNAVAILABLE', message: 'Runtime stream unavailable', retryable: true });
    } finally {
      busy = false;
    }
  }

  heartbeat = setInterval(() => {
    if (now() >= expiresAt) expired();
    else if (!closed && !res.writableNeedDrain) res.write(': ping\n\n');
  }, options.heartbeatMs ?? DAO_HEARTBEAT_MS);
  poll = setInterval(() => { void pump(); }, options.pollMs ?? 500);
  expiry = setTimeout(expired, Math.max(1, expiresAt - now()));
  heartbeat.unref();
  poll.unref();
  expiry.unref();
  void pump();
}
