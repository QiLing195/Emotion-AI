import type { ApiError, JsonObject } from '../contracts/dao-v31/index.ts';

export class DaoError extends Error {
  readonly status: number;
  readonly code: ApiError['code'];
  readonly retryable: boolean;
  readonly details?: JsonObject;

  constructor(status: number, code: ApiError['code'], message: string, details?: JsonObject, retryable = false) {
    super(message);
    this.name = 'DaoError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export const conflict = (message: string) => new DaoError(409, 'CONFLICT', message);
export const invalid = (message: string) => new DaoError(400, 'INVALID_REQUEST', message);
export const denied = (message = 'Current consent does not authorize this operation') => new DaoError(403, 'FORBIDDEN', message);
export const missing = () => new DaoError(404, 'NOT_FOUND', 'Resource is unavailable in this scope');
