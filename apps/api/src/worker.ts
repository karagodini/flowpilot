import { Queue, Worker } from 'bullmq';
import { createPrismaClient } from '@flowpilot/db';
import { loadConfig } from './config.js';
import { loadRootEnv } from './env.js';
import { createRedisConnection } from './queue.js';
import { processExecution, sweepStaleExecutions } from './runner.js';
import { tickSchedules } from './scheduler.js';

loadRootEnv();
const config = loadConfig();
const prisma = createPrismaClient();
const connection = createRedisConnection(config.redisUrl);
const queue = new Queue('flowpilot-executions', { connection: connection.duplicate() });

async function enqueue(executionId: string): Promise<void> {
  await queue.add(
    'run',
    { executionId },
    { jobId: executionId, removeOnComplete: 1000, removeOnFail: 1000 },
  );
}

const worker = new Worker(
  'flowpilot-executions',
  async (job) => {
    await processExecution(String(job.data.executionId), { prisma, config, enqueue });
  },
  { connection, concurrency: 4 },
);

worker.on('failed', (job, error) => {
  console.error(`Execution ${job?.id ?? 'unknown'} failed: ${error.message}`);
});

const swept = await sweepStaleExecutions(prisma);
if (swept > 0) console.log(`Marked ${swept} interrupted run(s) as failed.`);

const timer = setInterval(() => {
  tickSchedules(prisma, enqueue).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'schedule tick failed';
    console.error(message);
  });
}, 15_000);
timer.unref();

const shutdown = async () => {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
console.log('FlowPilot worker is waiting for runs.');
