import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DaoScope, JsonValue } from '../contracts/dao-v31/index.ts';
import { exactJson } from './exactJson.ts';
import { sessionKey } from './sessionAuth.ts';

export class DaoCursors {
  readonly #key: Buffer;

  constructor(secret: string) {
    this.#key = sessionKey(secret);
  }

  #tag(scope: DaoScope, purpose: string, value: string) {
    return createHmac('sha256', this.#key).update('dao-cursor-v1.').update(exactJson([scope, purpose, value]))
      .digest().subarray(0, 16);
  }

  seal(scope: DaoScope, purpose: string, value: JsonValue): string {
    const encoded = Buffer.from(exactJson(value)).toString('base64url');
    return encoded + '.' + this.#tag(scope, purpose, encoded).toString('base64url');
  }

  open(scope: DaoScope, purpose: string, token: string): unknown {
    if (token.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return undefined;
    const [encoded, signature] = token.split('.');
    const actual = Buffer.from(signature, 'base64url');
    const expected = this.#tag(scope, purpose, encoded);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    try { return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown; }
    catch { return undefined; }
  }
}
