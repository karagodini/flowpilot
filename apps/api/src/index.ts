import { createPrismaClient } from '@flowpilot/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loadRootEnv } from './env.js';
import { createBullQueue, createInlineQueue, type JobQueue } from './queue.js';
import { processExecution } from './runner.js';

loadRootEnv();
const config = loadConfig();
const prisma = createPrismaClient();

const bridge: { enqueue: (executionId: string) => Promise<void> } = {
  enqueue: async () => {
    throw new Error('Queue is not ready.');
  },
};

const queue: JobQueue =
  config.executionMode === 'inline'
    ? createInlineQueue((executionId) =>
        processExecution(executionId, { prisma, config, enqueue: (id) => bridge.enqueue(id) }),
      )
    : createBullQueue(config.redisUrl);
bridge.enqueue = (executionId) => queue.enqueue(executionId);

const app = await buildApp({ prisma, config, queue });

const shutdown = async () => {
  await app.close();
  await queue.close();
  await prisma.$disconnect();
};

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

await app.listen({ port: config.port, host: config.host });
app.log.info({ port: config.port, mode: config.executionMode }, 'FlowPilot API is listening');
