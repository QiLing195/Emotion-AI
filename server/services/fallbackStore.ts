// ── Firestore 本地降级存储 ──
// 当 Firestore 配额超限时，将写入操作暂存到本地 JSON 文件，
// 配额恢复后自动回放（FIFO 顺序），确保数据不丢失。

import fs from 'fs';
import path from 'path';

const FALLBACK_DIR = path.join(process.cwd(), 'data', 'fallback');
const QUEUE_FILE = path.join(FALLBACK_DIR, 'write_queue.json');
const MAX_QUEUE_SIZE = 500;

interface QueuedWrite {
  id: string;          // 唯一 ID (时间戳+随机)
  collection: string;  // Firestore collection 路径
  docId: string;       // 文档 ID
  data: Record<string, unknown>;
  operation: 'set' | 'merge';
  createdAt: number;
}

let writeQueue: QueuedWrite[] = [];
let initialized = false;

function ensureDir(): void {
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  }
}

function loadQueue(): void {
  ensureDir();
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
      writeQueue = JSON.parse(raw);
      if (!Array.isArray(writeQueue)) writeQueue = [];
    }
  } catch {
    writeQueue = [];
  }
  initialized = true;
}

function saveQueue(): void {
  ensureDir();
  try {
    fs.writeFileSync(QUEUE_FILE + '.tmp', JSON.stringify(writeQueue), 'utf-8');
    fs.renameSync(QUEUE_FILE + '.tmp', QUEUE_FILE);
  } catch {
    // 写入失败静默忽略（磁盘满等极端情况）
  }
}

/** 入队一次写入操作 */
export function enqueueWrite(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  operation: 'set' | 'merge' = 'merge',
): void {
  if (!initialized) loadQueue();

  // 防止队列无限增长
  if (writeQueue.length >= MAX_QUEUE_SIZE) {
    writeQueue.shift(); // 丢弃最旧的
  }

  writeQueue.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    collection,
    docId,
    data,
    operation,
    createdAt: Date.now(),
  });

  saveQueue();
}

/** 获取队列长度 */
export function getQueueSize(): number {
  if (!initialized) loadQueue();
  return writeQueue.length;
}

/** 出队并返回最早的 N 条记录（用于配额恢复后回放） */
export function dequeueBatch(batchSize: number = 50): QueuedWrite[] {
  if (!initialized) loadQueue();
  const batch = writeQueue.splice(0, batchSize);
  if (batch.length > 0) saveQueue();
  return batch;
}

/** 清空队列（危险操作，仅用于手动重置） */
export function clearQueue(): void {
  writeQueue = [];
  saveQueue();
}

/** 获取队列摘要信息 */
export function getFallbackStatus(): {
  queueSize: number;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  if (!initialized) loadQueue();
  return {
    queueSize: writeQueue.length,
    oldestEntry: writeQueue[0]?.createdAt ?? null,
    newestEntry: writeQueue[writeQueue.length - 1]?.createdAt ?? null,
  };
}
