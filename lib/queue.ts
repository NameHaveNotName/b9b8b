import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';
const isPlaceholder = redisUrl.includes('[host]') || redisUrl.includes('[token]');

// [DASHBOARD-FIX] DEMO 模式检测：无真实 Redis 时短路 BullMQ，避免 ECONNREFUSED
export const isDemoMode = isPlaceholder || !process.env.UPSTASH_REDIS_URL;

// ============================================================
// DEMO 模式：Mock 对象（不连接 Redis）
// ============================================================

function createMockQueue(name: string) {
  return {
    name,
    add: async (_name: string, _data: any) => ({ id: 'mock-job', getState: async () => 'completed' as const }),
    getJob: async (_id: string) => null,
    getJobs: async () => [] as any[],
    getJobCounts: async () => ({ completed: 0, failed: 0, active: 0, waiting: 0, delayed: 0 }),
    pause: async () => {},
    resume: async () => {},
    drain: async () => {},
    close: async () => {},
  } as unknown as Queue;
}

function createMockWorker(_name: string, _processor: any) {
  return {
    name: _name,
    on: () => {},
    close: async () => {},
    pause: async () => {},
    resume: async () => {},
  } as unknown as Worker;
}

const mockConnection = {
  status: 'demo',
  on: () => {},
  disconnect: () => {},
} as unknown as IORedis;

// ============================================================
// 真实 Redis 连接
// ============================================================

function createRealConnection() {
  return new IORedis(redisUrl, {
    tls: redisUrl.startsWith('rediss') ? {} : undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 500, 2000),
    enableOfflineQueue: false,
  });
}

// ============================================================
// 导出：根据模式选择实现（懒加载，避免构建时建立长连接导致进程无法退出）
// ============================================================

let _redisConnection: IORedis | undefined;

function getRedisConnection(): IORedis {
  if (!_redisConnection) {
    _redisConnection = isDemoMode
      ? (() => { console.log('[DASHBOARD-FIX][QUEUE] DEMO模式，Redis队列短路'); return mockConnection; })()
      : createRealConnection();
  }
  return _redisConnection;
}

// 保持旧导出签名：首次访问属性时才真正创建连接
export const redisConnection = new Proxy({} as IORedis, {
  get(_, prop) {
    const conn = getRedisConnection();
    const value = (conn as any)[prop];
    if (typeof value === 'function') {
      return value.bind(conn);
    }
    return value;
  },
});

// 队列实例缓存：createQueue 若每次调用都 new，会在每个请求里新建一个 Queue
// 及其内部 Redis 连接副本，且从不 close()，长驻实例下会累积到耗尽连接数。
const _queueCache = new Map<string, Queue>();

export function createQueue(name: string) {
  const cached = _queueCache.get(name);
  if (cached) return cached;
  const queue = isDemoMode ? createMockQueue(name) : new Queue(name, { connection: getRedisConnection() });
  _queueCache.set(name, queue);
  return queue;
}

export function createWorker(name: string, processor: any) {
  return isDemoMode ? createMockWorker(name, processor) : new Worker(name, processor, { connection: getRedisConnection() });
}

/**
 * 入队并带去重键。
 *
 * BullMQ 的 `jobId` 会让同一 id 的任务在队列中唯一：重试/重复请求不会产生第二个任务。
 * 生成任务普遍带 `attempts` 重试，被 Vercel 杀掉后重试时如果能与仍在写的首次任务并存，
 * 会重复上传资产并污染账本，因此所有生成类入队都必须传 jobId。
 */
export async function addJob(
  queue: Queue,
  name: string,
  data: any,
  opts: {
    jobId?: string
    attempts?: number
    backoff?: any
    removeOnComplete?: boolean | number | { count?: number; age?: number }
    removeOnFail?: boolean | number | { count?: number; age?: number }
  } = {}
) {
  return queue.add(name, data, opts as any)
}
