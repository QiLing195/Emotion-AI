import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DAO_CONTRACT_VERSION, DAO_PROJECTION_VERSION, domainSchemas, id } from '../contracts/dao-v31/domain.ts';
import { contractOperations, sseSchemas } from '../contracts/dao-v31/operations.ts';
import { literal, object, ref } from '../contracts/dao-v31/schema.ts';
import type { Schema } from '../contracts/dao-v31/schema.ts';
import { apiSchemas, SCOPE_HEADERS } from '../contracts/dao-v31/wire.ts';

const BASE = new URL('../../docs/dao-v31/', import.meta.url);
const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const REQUIREMENTS = {
  [SCOPE_HEADERS.env]: ref('DaoEnv', domainSchemas.DaoEnv),
  [SCOPE_HEADERS.characterId]: id,
  [SCOPE_HEADERS.sessionId]: id,
};
const ERROR_RESPONSES = {
  400: 'Invalid request, header or body',
  401: 'Missing or invalid bearer token',
  403: 'Scope, current consent or policy denies access',
  404: 'Resource unavailable in this scope',
  409: 'Consent, state, task or idempotency conflict',
  429: 'Rate limit reached',
  500: 'Unexpected server error',
  503: 'Service or dependency unavailable',
} as const;

function successEnvelope(data: Schema) {
  return object({ ok: literal(true), data, meta: ref('ApiMeta', apiSchemas.ApiMeta) });
}

function response(description: string, name: string) {
  return { description, content: { 'application/json': { schema: { $ref: `#/$defs/${name}` } } } };
}

function parameter(name: string, location: 'header' | 'query' | 'path', required: boolean, schema: unknown) {
  return { name, in: location, required, schema };
}

function parametersFrom(schema: Schema | undefined, location: 'query' | 'path') {
  if (!schema) return [];
  const { properties, required } = schema;
  const requiredNames = new Set(required as string[]);
  return Object.entries(properties as Record<string, unknown>).map(([name, field]) =>
    parameter(name, location, requiredNames.has(name), field),
  );
}

function sseResponse(channel: keyof typeof sseSchemas) {
  return {
    description: channel === 'runtime' ? 'Scoped runtime stream' : 'Single-turn reviewed reply stream',
    headers: {
      'X-Accel-Buffering': { required: true, schema: { const: 'no' } },
      'Cache-Control': { required: true, schema: { const: 'no-cache, no-transform' } },
    },
    content: { 'text/event-stream': { schema: { type: 'string' } } },
    'x-dao-sse-events': Object.fromEntries(Object.keys(sseSchemas[channel]).map((name) =>
      [name, { $ref: `#/$defs/${channel}_${name}` }],
    )),
  };
}

export function contractArtifacts() {
  const definitions: Record<string, Schema> = { ...domainSchemas, ...apiSchemas };
  const paths: Record<string, Record<string, unknown>> = {};
  const errorResponses = Object.fromEntries(Object.entries(ERROR_RESPONSES).map(([status, description]) =>
    [status, response(description, 'ApiFailure')],
  ));
  const scopeHeaders = Object.entries(REQUIREMENTS).map(([header, schema]) => parameter(header, 'header', true, schema));
  for (const [channel, events] of Object.entries(sseSchemas)) {
    for (const [name, schema] of Object.entries(events)) definitions[`${channel}_${name}`] = schema;
  }

  for (const [operationId, operation] of Object.entries(contractOperations)) {
    const bodyName = `${operationId}_Request`;
    const outputName = `${operationId}_Response`;
    if (operation.body) definitions[bodyName] = operation.body;
    if (operation.query) definitions[`${operationId}_Query`] = operation.query;
    if (operation.pathParams) definitions[`${operationId}_Path`] = operation.pathParams;
    if (operation.output) definitions[outputName] = successEnvelope(operation.output);

    const parameters = [
      ...scopeHeaders,
      ...parametersFrom(operation.pathParams, 'path'),
      ...parametersFrom(operation.query, 'query'),
    ];
    if (operation.method !== 'get') parameters.push(parameter('Idempotency-Key', 'header', true, id));
    if (operation.stream === 'runtime') parameters.push(parameter('Last-Event-ID', 'header', false, id));

    const success = operation.stream
      ? sseResponse(operation.stream)
      : response('Successful response', outputName);
    (paths[operation.path] ??= {})[operation.method] = {
      operationId,
      summary: operation.summary,
      'x-dao-milestone': operation.milestone,
      parameters,
      ...(operation.body ? {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: `#/$defs/${bodyName}` } } },
        },
      } : {}),
      responses: { [operation.success]: success, ...errorResponses },
    };
  }

  const schemas = {
    $schema: DIALECT,
    title: 'Dao V3.1 wire schemas',
    description: 'Select a schema by JSON Pointer under $defs.',
    $defs: definitions,
  };
  const openApi = {
    openapi: '3.1.0',
    jsonSchemaDialect: DIALECT,
    info: { title: 'Dao Personal AI Server', version: DAO_CONTRACT_VERSION },
    'x-dao-projection-version': DAO_PROJECTION_VERSION,
    security: [{ daoBearer: [] }],
    paths,
    components: {
      securitySchemes: { daoBearer: { type: 'http', scheme: 'bearer' } },
      schemas: definitions,
    },
  };
  return {
    'schemas.json': JSON.stringify(schemas, null, 2) + '\n',
    'openapi.json': JSON.stringify(openApi, (key, value: unknown) =>
      key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')
        ? value.replace('#/$defs/', '#/components/schemas/')
        : value, 2) + '\n',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await Promise.all(Object.entries(contractArtifacts()).map(([name, content]) => writeFile(new URL(name, BASE), content)));
}
