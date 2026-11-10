import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface JobQueue {
  enqueue(executionId: string): Promise<void>;
  close(): Promise<void>;
}

export function createInlineQueue(handler: (executionId: string) => Promise<void>): JobQueue {
  return {
    enqueue: handler,
    async close() {},
  };
}

export function createBullQueue(redisUrl: string): JobQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('flowpilot-executions', { connection });
  return {
    async enqueue(executionId) {
      await queue.add(
        'run',
        { executionId },
        { jobId: executionId, removeOnComplete: 1000, removeOnFail: 1000 },
      );
    },
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
