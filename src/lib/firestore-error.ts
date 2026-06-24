import { db } from '../firebase';
import { disableNetwork } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined; // Anonymized in production
    isAnonymous: boolean | undefined;
  }
}

interface QuotaState {
  isExceeded: boolean;
  expiresAt: number | null; // timestamp when quota lock should expire
}

let quotaState: QuotaState = {
  isExceeded: false,
  expiresAt: null
};

// Check if quota lock has expired
export function checkQuotaLock(): boolean {
  if (!quotaState.isExceeded) {
    isQuotaExceeded = false;
    return false;
  }
  if (quotaState.expiresAt && Date.now() > quotaState.expiresAt) {
    console.log('[Quota] Lock expired, resuming normal operations');
    quotaState.isExceeded = false;
    quotaState.expiresAt = null;
    isQuotaExceeded = false;
    return false;
  }
  isQuotaExceeded = true;
  return true;
}

export function setQuotaExceeded() {
  if (!quotaState.isExceeded) {
    quotaState.isExceeded = true;
    // Set lock for 1 hour (3600000 ms)
    quotaState.expiresAt = Date.now() + 3600000;
    console.warn(`Firestore quota exceeded. Locking writes for 1 hour (until ${new Date(quotaState.expiresAt).toISOString()})`);
    disableNetwork(db).catch(console.error);
  }
}

export function resetQuotaLock() {
  quotaState.isExceeded = false;
  quotaState.expiresAt = null;
  isQuotaExceeded = false;
  console.log('[Quota] Lock manually reset');
}

let isQuotaExceeded = false; // Internal state, access via getQuotaExceeded()

// Get current quota state with expiration check
export function getQuotaExceeded(): boolean {
  checkQuotaLock();
  return isQuotaExceeded;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  let errorMsg = error instanceof Error ? error.message : String(error);

  // Gracefully handle quota exceeded errors without throwing
  if ((error as any)?.code === 'resource-exhausted' || errorMsg.includes('Quota limit exceeded')) {
    setQuotaExceeded();
    // Update legacy variable for compatibility
    isQuotaExceeded = checkQuotaLock();
    return; // Do not throw
  }

  try {
    // Check if it's already a FirestoreErrorInfo JSON string
    const parsed = JSON.parse(errorMsg);
    if (parsed.operationType && parsed.authInfo) {
      throw error; // Re-throw the original error
    }
  } catch (e) {
    if (e === error) throw error; // It was our error, re-throw
    // Not JSON or not our error format, proceed to wrap
  }

  // Safe error info without sensitive user data
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: 'guest',
      isAnonymous: true
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // 不抛出 — Firestore 错误不应导致页面崩溃，静默降级即可
}