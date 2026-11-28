import express from 'express';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { signSessionToken } from './sessionAuth.ts';
import { createDaoRouter } from './router.ts';
import { scope, secret, temporaryDatabase } from './testSupport.ts';

const grant = {
  sourceId: 'journal', sensitivity: 'Personal', purposes: ['self-record'],
  collectionMode: 'manual', retentionPolicy: {}, expectedConsentVersion: 0,
  permissions: { allowRead: true, allowUpload: true, allowAnalysis: true, allowPsychologicalInference: false,
    allowLongTermMemory: false, allowCharacterUse: false },
};
const record = {
  sourceId: 'journal', category: 'UserProvided', sensitivity: 'Personal', purpose: 'self-record',
  type: 'journal', occurredAt: '2026-11-28T01:10:00Z', data: { title: 'Cold start check' }, expectedConsentVersion: 1,
};

async function withClient(work: (client: {
  runtime: ReturnType<typeof createDaoRouter>['runtime'];
  call: (path: string, options?: RequestInit) => Promise<Response>;
  stream: (lastId?: string) => Promise<{ response: Response; next: () => Promise<string>; stop: () => Promise<void> }>;
}) => Promise<void>, directory?: string, leaseSeconds = 60) {
  const tmp = directory ? undefined : temporaryDatabase();
  const dao = createDaoRouter({ secret, directory: directory ?? tmp!.directory, ownerId: scope.ownerId, heartbeatMs: 15, pollMs: 5 });
  const server = express().use('/api/dao', dao.router).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP listener');
    const url = `http://127.0.0.1:${address.port}/api/dao`;
    const session = signSessionToken(secret, scope, leaseSeconds);
    const headers = {
      Authorization: `Bearer ${session}`,
      'X-Dao-Env': scope.env, 'X-Dao-Character-Id': scope.characterId, 'X-Dao-Session-Id': scope.sessionId,
    };
    const call = (path: string, opts: RequestInit = {}) => fetch(url + path, {
      ...opts, headers: { ...headers, ...opts.headers }, signal: AbortSignal.timeout(5000),
    });
    await work({
      call, runtime: dao.runtime,
      stream: async (lastId?: string) => {
        const response = await call('/stream', lastId ? { headers: { 'Last-Event-ID': lastId } } : undefined);
        if (!response.body) throw new Error('Missing stream body');
        const reader = response.body.getReader();
        const decode = new TextDecoder();
        let buffer = '';
        return {
          response, stop: () => reader.cancel(),
          next: async () => {
            while (!buffer.includes('\n\n')) {
              const piece = await reader.read();
              if (piece.done) throw new Error('Unexpected stream end');
              buffer += decode.decode(piece.value, { stream: true });
            }
            const boundary = buffer.indexOf('\n\n');
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            return frame;
          },
        };
      },
    });
  } finally {
    const stopped = new Promise<void>((resolve) => { server.close(() => resolve()); });
    server.closeAllConnections();
    await stopped;
    await dao.close();
    tmp?.remove();
  }
}

function write(method: 'PUT' | 'POST', body: unknown, key: string): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } };
}

describe('M1 Android-compatible bearer and scoped HTTP API', () => {
  it('authenticates a headless client with bearer and all scope headers', async () => withClient(async ({ call }) => {
    const bare = await call('/health', { headers: { Authorization: '' } });
    expect(bare.status).toBe(401);
    const wrongSession = await call('/health', { headers: { 'X-Dao-Session-Id': 'another-session' } });
    expect(wrongSession.status).toBe(403);
    expect((await call('/health', { headers: { 'X-Dao-Env': 'exp' } })).status).toBe(403);
    expect((await call('/health?token=invalid', { headers: { Authorization: 'Bearer v1.bad.invalid' } })).status).toBe(401);
    const valid = await call('/health');
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({
      ok: true, data: { env: 'prod', contractVersion: '3.1.0', sqlite: {
        journalMode: 'wal', foreignKeys: true, busyTimeoutMs: 5000, fts5: true, schemaVersion: 2,
      } },
      meta: { consentVersion: 0, projectionVersion: '1.0.0' },
    });
  }));

  it('serves the same data to a fresh bearer-only client after starting a new router on the same disk', async () => {
    const tmp = temporaryDatabase();
    try {
      await withClient(async ({ call }) => {
        expect((await call('/consents/UserProvided', write('PUT', grant, 'grant-1'))).status).toBe(200);
        expect((await call('/data/records', write('POST', record, 'record-1'))).status).toBe(201);
      }, tmp.directory);
      await withClient(async ({ call }) => {
        const response = await call('/data/observations', { credentials: 'omit' });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.data.items).toHaveLength(1);
        expect(body.data.items[0].summary).toBe('Cold start check');
        expect((await (await call('/consents')).json()).meta.consentVersion).toBe(1);
      }, tmp.directory, 90);
    } finally {
      tmp.remove();
    }
  });

  it('validates the contract, persists idempotent data and denies reads after revocation', async () => withClient(async ({ call }) => {
    expect((await call('/data/observations')).status).toBe(403);
    const illegal = await call('/consents/UserProvided', write('PUT', {
      ...grant, permissions: { ...grant.permissions, allowRead: false },
    }, 'bad-grant'));
    expect(await illegal.json()).toMatchObject({ ok: false, error: { code: 'INVALID_CONSENT_DEPENDENCY' } });
    expect((await call('/consents/UserProvided', write('PUT', grant, 'grant-1'))).status).toBe(200);
    const created = await call('/data/records', write('POST', record, 'record-1'));
    expect(created.status).toBe(201);
    const { data } = await created.json();
    const retry = await call('/data/records', write('POST', record, 'record-1'));
    expect((await retry.json()).data).toEqual(data);
    const changed = await call('/data/records', write('POST', { ...record, data: { title: 'changed' } }, 'record-1'));
    expect(changed.status).toBe(409);
    const observed = await call('/data/observations?limit=1&category=UserProvided', { headers: { Cookie: '' } });
    expect((await observed.json()).data.items.map((item: { summary: string }) => item.summary)).toEqual(['Cold start check']);
    expect((await call('/provenance/' + data.recordId)).status).toBe(200);
    const snapshot = await call('/state/snapshot');
    expect((await snapshot.json()).data).toMatchObject({ stateVersion: 2, userProfile: { items: [] } });
    const list = await call('/events?limit=1');
    const first = (await list.json()).data;
    expect(first.items).toHaveLength(1);
    expect((await (await call('/events?cursor=' + encodeURIComponent(first.nextCursor))).json()).data.items)
      .toMatchObject([{ event: { eventId: data.eventId } }]);
    const exported = await call('/backup/export');
    expect(exported.status).toBe(200);
    const backup = (await exported.json()).data;
    const restored = await call('/backup/restore', write('POST', {
      backup, expectedStateVersion: 2, expectedConsentVersion: 1,
    }, 'restore-1'));
    expect(restored.status).toBe(200);
    expect((await call('/consents/UserProvided', write('PUT', {
      ...grant, expectedConsentVersion: 1, permissions: { ...grant.permissions, allowAnalysis: false },
    }, 'revoke-1'))).status).toBe(200);
    expect((await call('/data/observations')).status).toBe(403);
    const after = (await (await call('/backup/export')).json()).data;
    expect(after.snapshot.entities.every((item: { layer: string }) => item.layer !== 'observation')).toBe(true);
  }));

  it('keeps real SSE connections alive and resumes committed data with scoped cursors', async () => withClient(async ({ call, stream }) => {
    await call('/consents/UserProvided', write('PUT', grant, 'grant-1'));
    const original = await stream();
    expect(original.response.headers.get('x-accel-buffering')).toBe('no');
    expect(original.response.headers.get('content-type')).toContain('text/event-stream');
    expect(await original.next()).toBe(': connected');
    expect(await original.next()).toBe(': ping');
    await call('/data/records', write('POST', record, 'record-1'));
    let cursor = '';
    for (let i = 0; i < 40; i++) {
      const frame = await original.next();
      if (frame.includes('event: system_event')) { cursor = frame.match(/^id: (.+)$/m)?.[1] ?? ''; break; }
    }
    expect(cursor).not.toBe('');
    await original.stop();

    const resumed = await stream(cursor);
    expect(await resumed.next()).toBe(': connected');
    let commitFrame = '';
    for (let i = 0; i < 40; i++) {
      const frame = await resumed.next();
      if (frame.includes('event: commit_record')) { commitFrame = frame; break; }
    }
    expect(commitFrame).toContain('"stateVersion":2');
    await call('/consents/UserProvided', write('PUT', {
      ...grant, expectedConsentVersion: 1, permissions: { ...grant.permissions, allowAnalysis: false },
    }, 'revoke-1'));
    let revoked = '';
    for (let i = 0; i < 40; i++) {
      const frame = await resumed.next();
      if (frame.includes('event: consent_revoked')) { revoked = frame; break; }
    }
    expect(revoked).toContain('"consentVersion":2');
    await resumed.stop();

    await call('/consents/UserProvided', write('PUT', {
      ...grant, expectedConsentVersion: 2, permissions: Object.fromEntries(Object.keys(grant.permissions).map((key) => [key, false])),
    }, 'revoke-all'));
    const filtered = await stream(cursor);
    expect(await filtered.next()).toBe(': connected');
    let nextCommit = '';
    for (let i = 0; i < 40; i++) {
      const frame = await filtered.next();
      if (frame.includes('event: commit_record')) { nextCommit = frame; break; }
    }
    expect(nextCommit).toContain('"stateVersion":3');
    expect(nextCommit).not.toContain('"stateVersion":2');
    await filtered.stop();

    const reset = await stream('unavailable');
    expect(await reset.next()).toBe(': connected');
    expect(await reset.next()).toContain('event: stream_reset');
    await reset.stop();
  }));

  it('publishes M2a track updates through the existing SSE and snapshot contracts', async () => withClient(async ({ call, stream, runtime }) => {
    const live = await stream();
    try {
      expect(await live.next()).toBe(': connected');
      await runtime.affect.settle(scope, 'http-clock', 0);
      let update = '';
      for (let i = 0; i < 40; i++) {
        const frame = await live.next();
        if (frame.includes('event: track_update')) { update = frame; break; }
      }
      expect(update).toContain('"track":"D"');
      expect(update).toContain('"status":"completed"');
      const { data } = await (await call('/state/snapshot')).json();
      expect(data.emotionProvenance.eventId).toBe('http-clock');
      expect(data.trackMetrics.find((metric: { track: string }) => metric.track === 'D')).toMatchObject({ completed: 1 });
    } finally {
      await live.stop();
    }
  }));
});
