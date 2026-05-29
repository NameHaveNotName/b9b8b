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
// 导出：根据模式选择实现
// ============================================================

export const redisConnection = isDemoMode
  ? (() => { console.log('[DASHBOARD-FIX][QUEUE] DEMO模式，Redis队列短路'); return mockConnection; })()
  : createRealConnection();

export function createQueue(name: string) {
  return isDemoMode ? createMockQueue(name) : new Queue(name, { connection: redisConnection });
}

export function createWorker(name: string, processor: any) {
  return isDemoMode ? createMockWorker(name, processor) : new Worker(name, processor, { connection: redisConnection });
}
