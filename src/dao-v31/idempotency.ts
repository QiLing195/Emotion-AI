import type { DaoOperationId, JsonObject } from '../contracts/dao-v31/index.ts';
import type { M1WriteTransaction } from './m1Types.ts';
import { DaoError } from './errors.ts';
import { integrityHash, jsonValue } from './exactJson.ts';

export interface IdempotencyKey {
  readonly operation: DaoOperationId;
  readonly path: string;
  readonly key: string;
  readonly body: unknown;
}

export async function idempotent<T extends object>(
  tx: M1WriteTransaction, request: IdempotencyKey | undefined, commit: () => Promise<T>,
): Promise<{ result: T; repeated: boolean }> {
  if (!request) return { result: await commit(), repeated: false };
  const { operation, path, key, body } = request;
  const requestHash = integrityHash(jsonValue(body));
  const previous = await tx.getIdempotencyResult(operation, path, key);
  if (previous) {
    if (previous.requestHash !== requestHash) throw new DaoError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key has already been used');
    return { result: previous.response as unknown as T, repeated: true };
  }
  const result = await commit();
  await tx.saveIdempotencyResult(operation, path, key, { requestHash, response: jsonValue(result) as JsonObject });
  return { result, repeated: false };
}
