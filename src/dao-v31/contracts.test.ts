import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CONSENT_DIMENSIONS, CONSENT_PREREQUISITES, DAO_CHECKPOINT_INTERVAL, DAO_CONTRACT_VERSION, daoOperations,
} from '../contracts/dao-v31/index.ts';
import type {
  ApiEnvelope, DaoChatFrames, DaoPersistencePort, DaoRequestBody, DaoResponseData, DaoScope,
  DataCategory, DataConsent, MikaTaskContract, ProvenanceRecord, SensitivityLevel, SystemEvent,
} from '../contracts/dao-v31/index.ts';
import { contractArtifacts } from './publishContracts.ts';

const artifacts = contractArtifacts();
const api = JSON.parse(artifacts['openapi.json']);
const schemas = JSON.parse(artifacts['schemas.json']);

describe('M0 versioned REST and SSE contract', () => {
  it('keeps published OpenAPI and JSON Schema byte-for-byte in sync with TypeScript', () => {
    for (const [name, source] of Object.entries(artifacts)) {
      expect(readFileSync(new URL(`../../docs/dao-v31/${name}`, import.meta.url), 'utf8')).toBe(source);
    }
    expect(api.info.version).toBe(DAO_CONTRACT_VERSION);
    expect(api.openapi).toBe('3.1.0');
  });

  it('provides exactly the 26 commissioned method/path pairs', () => {
    const specified = [
      'GET /health', 'GET /stream', 'GET /consents', 'PUT /consents/{category}',
      'POST /data/records', 'GET /data/observations', 'POST /governance/forget',
      'GET /provenance/{entityId}', 'POST /chat/reply', 'GET /state/snapshot',
      'GET /events', 'POST /tasks', 'GET /tasks', 'POST /tasks/{taskId}/approve',
      'POST /tasks/{taskId}/cancel', 'GET /orchestrator/ledger', 'GET /psychology/hypotheses',
      'POST /psychology/analyze', 'GET /user-profile', 'POST /user-profile/{itemId}/review',
      'POST /replay/run', 'POST /experiments/snapshot', 'POST /experiments/{expId}/promote',
      'GET /backup/export', 'POST /backup/restore', 'GET /export/obsidian',
    ].sort();
    const published = Object.entries<Record<string, unknown>>(api.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => method.toUpperCase() + ' ' + path.replace('/api/dao', '')),
    );
    expect(published.sort()).toEqual(specified);
    expect(Object.keys(daoOperations)).toHaveLength(specified.length);
  });

  it('requires bearer scope on all operations and idempotency on writes only', () => {
    expect(api.security).toEqual([{ daoBearer: [] }]);
    expect(api.components.securitySchemes.daoBearer).toEqual({ type: 'http', scheme: 'bearer' });
    for (const [path, methods] of Object.entries<Record<string, unknown>>(api.paths)) {
      for (const operation of Object.values(daoOperations).filter((entry) => entry.path === path)) {
        const wire = methods[operation.method] as { parameters: { name: string; in: string; required: boolean }[] };
        expect(wire.parameters.filter((item) => item.in === 'header' && item.required).map((item) => item.name))
          .toEqual(['X-Dao-Env', 'X-Dao-Character-Id', 'X-Dao-Session-Id', ...(operation.method === 'get' ? [] : ['Idempotency-Key'])]);
        expect(wire.parameters.every((item) => item.name !== 'ownerId')).toBe(true);
        expect(wire.parameters.filter((item) => item.in === 'path').map((item) => '{' + item.name + '}'))
          .toEqual(path.match(/{[^}]+}/g) ?? []);
      }
    }
  });

  it('publishes two typed SSE streams with anti-buffering headers and the replacement frame', () => {
    const runtime = api.paths['/api/dao/stream'].get.responses[200];
    const chat = api.paths['/api/dao/chat/reply'].post.responses[200];
    for (const response of [runtime, chat]) {
      expect(response.content).toHaveProperty('text/event-stream');
      expect(response.headers['X-Accel-Buffering'].schema.const).toBe('no');
    }
    expect(Object.keys(runtime['x-dao-sse-events'])).toEqual([
      'track_update', 'system_event', 'commit_record', 'task_status',
      'shadow_psychology', 'consent_revoked', 'stream_reset', 'error',
    ]);
    expect(Object.keys(chat['x-dao-sse-events'])).toEqual([
      'reply_started', 'reply_delta', 'safety_replaced', 'reply_done', 'error',
    ]);
    expect(schemas.$defs.chat_safety_replaced.properties.data.required).toContain('replacement');
    expectTypeOf<DaoChatFrames['safety_replaced']['data']['replacement']>().toEqualTypeOf<string>();
  });

  it('resolves every reference in both published documents', () => {
    function inspect(value: unknown, root: Record<string, unknown>) {
      if (value === null || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (key !== '$ref') {
          inspect(entry, root);
          continue;
        }
        expect(entry).toMatch(/^#\//);
        const node = (entry as string).slice(2).split('/').reduce<unknown>((state, segment) =>
          (state as Record<string, unknown> | undefined)?.[segment], root);
        expect(node, entry as string).toBeDefined();
      }
    }

    inspect(api, api);
    inspect(schemas, schemas);
  });

  it('preserves scope on persisted contracts and separates consent axes and four state objects', () => {
    expectTypeOf<SystemEvent['scope']>().toEqualTypeOf<DaoScope>();
    expectTypeOf<ProvenanceRecord['scope']>().toEqualTypeOf<DaoScope>();
    expectTypeOf<MikaTaskContract['scope']>().toEqualTypeOf<DaoScope>();
    expectTypeOf<DataConsent['category']>().toEqualTypeOf<DataCategory>();
    expectTypeOf<DataConsent['sensitivity']>().toEqualTypeOf<SensitivityLevel>();
    expectTypeOf<Parameters<DaoPersistencePort['write']>[0]>().toEqualTypeOf<DaoScope>();
    expectTypeOf<DaoRequestBody<'createTask'>['request']>().not.toHaveProperty('riskLevel');
    expectTypeOf<DaoResponseData<'getStateSnapshot'>>().toHaveProperty('userProfile');
    expectTypeOf<DaoResponseData<'getStateSnapshot'>>().toHaveProperty('characterPersonality');
    expectTypeOf<DaoResponseData<'getStateSnapshot'>>().toHaveProperty('relationshipState');
    expectTypeOf<DaoResponseData<'getStateSnapshot'>>().toHaveProperty('characterEmotion');
    expectTypeOf<Extract<ApiEnvelope<string>, { ok: false }>>().not.toHaveProperty('data');
    expect(CONSENT_DIMENSIONS).toHaveLength(6);
    expect(CONSENT_PREREQUISITES.allowPsychologicalInference).toEqual(['allowRead', 'allowAnalysis']);
    expect(DAO_CHECKPOINT_INTERVAL).toBe(100);
  });
});
