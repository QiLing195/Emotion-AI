import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { DaoScope } from '../contracts/dao-v31/index.ts';
import { DaoError } from './errors.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const MAX_TTL = 3600;
const TOKEN_PART = /^[A-Za-z0-9_-]+$/u;

export interface SessionClaims {
  readonly scope: DaoScope;
  readonly expiresAt: number;
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function isScope(value: unknown): value is DaoScope {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isIdentifier(item.ownerId) && isIdentifier(item.characterId) && isIdentifier(item.sessionId)
    && (item.env === 'prod' || item.env === 'exp');
}

export function sameScope(left: DaoScope, right: DaoScope): boolean {
  return left.ownerId === right.ownerId && left.env === right.env
    && left.characterId === right.characterId && left.sessionId === right.sessionId;
}

export function sessionKey(secret: string): Buffer {
  if (!/^[a-f0-9]{64}$/iu.test(secret)) throw new Error('DAO_SESSION_SECRET must contain 32 hexadecimal bytes');
  return Buffer.from(secret, 'hex');
}

function signature(secret: string, encoded: string) {
  return createHmac('sha256', sessionKey(secret)).update('dao-session-v1.').update(encoded).digest();
}

export function signSessionToken(secret: string, scope: DaoScope, ttlSeconds = 900, now = Date.now()): string {
  if (!isScope(scope) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL) {
    throw new Error('Expected valid scope IDs and a token TTL between 1 and 3600 seconds');
  }
  const issuedAt = Math.floor(now / 1000);
  const encoded = Buffer.from(JSON.stringify({
    scope, issuedAt, expiresAt: issuedAt + ttlSeconds,
  })).toString('base64url');
  return `v1.${encoded}.${signature(secret, encoded).toString('base64url')}`;
}

export function verifySessionToken(secret: string, token: string, ownerId: string, now: number): SessionClaims {
  const [, encoded, digest] = token.split('.');
  const denied = () => new DaoError(401, 'UNAUTHENTICATED', 'A valid scoped bearer token is required');
  if (!/^v1\.[^.]+\.[^.]+$/.test(token) || token.length > 1500
      || !TOKEN_PART.test(encoded) || !TOKEN_PART.test(digest)) throw denied();
  const actual = Buffer.from(digest, 'base64url');
  const expected = signature(secret, encoded);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw denied();
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw denied(); }
  if (!payload || typeof payload !== 'object') throw denied();
  const claims = payload as Record<string, unknown>;
  const { issuedAt, expiresAt, scope } = claims;
  const nowSeconds = Math.floor(now / 1000);
  if (!isScope(scope) || scope.ownerId !== ownerId
    || typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt > nowSeconds
    || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)
    || expiresAt <= nowSeconds || expiresAt - issuedAt > MAX_TTL) throw denied();
  return { scope, expiresAt: expiresAt * 1000 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [env, characterId, sessionId, ttl = '900', ...extra] = process.argv.slice(2);
  const { DAO_OWNER_ID: ownerId, DAO_SESSION_SECRET: secret } = process.env;
  const scope: unknown = { env, characterId, sessionId, ownerId };
  if (extra.length || !secret || !isScope(scope)) {
    process.stderr.write('Usage: node src/dao-v31/sessionAuth.ts <prod|exp> <characterId> <sessionId> [ttlSeconds] (requires DAO_SESSION_SECRET and DAO_OWNER_ID)\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(signSessionToken(secret, scope, Number(ttl)) + '\n');
    } catch (error) {
      process.stderr.write((error instanceof Error ? error.message : 'Unable to sign session token') + '\n');
      process.exitCode = 1;
    }
  }
}
