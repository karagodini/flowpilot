import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { HttpError } from './errors.js';
import type { JobQueue } from './queue.js';
import { authRoutes } from './routes/auth.js';
import { credentialRoutes } from './routes/credentials.js';
import { executionRoutes } from './routes/executions.js';
import { hookRoutes } from './routes/hooks.js';
import { workflowRoutes } from './routes/workflows.js';
import type { AppDeps } from './types.js';

export async function buildApp(deps: AppDeps & { logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger === false ? false : { level: deps.config.logLevel },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  app.decorate('prisma', deps.prisma);
  app.decorate('config', deps.config);
  app.decorate('queue', deps.queue);
  app.decorateRequest('user', null);

  await app.register(cors, { origin: deps.config.webOrigin, credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message || 'Check the request and try again.';
      return reply.code(400).send({ error: message });
    }
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    const statusCode =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const message = error instanceof Error ? error.message : 'Request could not be processed.';
      return reply.code(statusCode).send({ error: message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Something went wrong while handling that request.' });
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'flowpilot-api' };
    } catch {
      return reply.code(503).send({ status: 'degraded', service: 'flowpilot-api' });
    }
  });

  await app.register(authRoutes);
  await app.register(credentialRoutes);
  await app.register(workflowRoutes);
  await app.register(executionRoutes);
  await app.register(hookRoutes);
  return app;
}

export function assertConfig(config: AppConfig, queue: JobQueue): void {
  if (!config.jwtSecret || !queue) throw new Error('Runtime is incomplete.');
}
