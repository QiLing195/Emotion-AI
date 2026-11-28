import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { contractArtifacts } from './publishContracts.ts';
import type { DaoOperationId, DaoPathParams, DaoQuery, DaoRequestBody } from '../contracts/dao-v31/index.ts';
import { DaoError, invalid } from './errors.ts';

const schemaId = 'urn:dao:contracts:v31';
const ajv = new Ajv2020({ strict: false, ownProperties: true });
addFormats(ajv);
ajv.addSchema(JSON.parse(contractArtifacts()['schemas.json']), schemaId);

export function validateSchema<T>(name: string, input: unknown): T {
  const schema = ajv.getSchema<T>(`${schemaId}#/$defs/${name}`);
  if (!schema) throw new Error('Unknown DAO request schema: ' + name);
  if (!schema(input)) {
    const issue = schema.errors?.[0];
    const consent = name === 'putConsent_Request' && issue?.instancePath.startsWith('/permissions') && issue.keyword === 'const';
    throw new DaoError(400, consent ? 'INVALID_CONSENT_DEPENDENCY' : 'INVALID_REQUEST',
      consent ? 'Consent dimensions have unsatisfied prerequisites' : 'Request does not match the DAO contract',
      { field: issue?.instancePath || '/', rule: issue?.keyword || 'schema' });
  }
  return input as T;
}

function checkJson(value: unknown, depth = 0): void {
  if (depth > 64) throw invalid('JSON is nested too deeply');
  if (typeof value === 'number' && !Number.isFinite(value)) throw invalid('JSON numbers must be finite');
  if (value !== null && typeof value === 'object') {
    for (const field of Object.values(value)) checkJson(field, depth + 1);
  }
}

export function bodyFor<K extends DaoOperationId>(operation: K, value: unknown) {
  checkJson(value);
  return validateSchema<DaoRequestBody<K>>(`${operation}_Request`, value);
}
export const paramsFor = <K extends DaoOperationId>(operation: K, value: unknown) =>
  validateSchema<DaoPathParams<K>>(`${operation}_Path`, value);
export const queryFor = <K extends DaoOperationId>(operation: K, value: unknown) =>
  validateSchema<DaoQuery<K>>(`${operation}_Query`, value);
