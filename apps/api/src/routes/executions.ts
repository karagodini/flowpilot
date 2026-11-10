import type { Prisma } from '@flowpilot/db';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { loadExecution } from './workflows.js';

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/executions', async (request) => {
    const user = await requireUser(request);
    const query = request.query as { workflowId?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 40) || 40, 1), 100);
    const executions = await app.prisma.execution.findMany({
      where: {
        workflow: { ownerId: user.id },
        ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { workflow: { select: { name: true } }, version: { select: { version: true } } },
    });
    return {
      executions: executions.map((execution) => ({
        id: execution.id,
        workflowId: execution.workflowId,
        workflowName: execution.workflow.name,
        version: execution.version.version,
        status: execution.status,
        trigger: execution.trigger,
        mode: execution.mode,
        attempt: execution.attempt,
        error: execution.error,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
        createdAt: execution.createdAt,
      })),
    };
  });

  app.get('/api/executions/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    return { execution: await loadExecution(app, id, user.id) };
  });

  app.post('/api/executions/:id/retry', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const execution = await loadExecution(app, id, user.id);
    if (execution.status === 'queued' || execution.status === 'running') {
      throw new HttpError(409, 'This run is still in progress.');
    }
    const created = await app.prisma.execution.create({
      data: {
        workflowId: execution.workflowId,
        versionId: execution.versionId,
        status: 'queued',
        trigger: 'retry',
        mode: execution.mode === 'error' ? 'error' : 'standard',
        attempt: execution.attempt + 1,
        parentId: execution.id,
        input: execution.input as Prisma.InputJsonValue,
      },
    });
    await app.queue.enqueue(created.id);
    const finished = await wait(app, created.id, user.id);
    return reply.code(201).send({ execution: finished });
  });

  app.post('/api/executions/:id/cancel', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const execution = await loadExecution(app, id, user.id);
    if (execution.status !== 'queued')
      throw new HttpError(409, 'Only a queued run can be cancelled.');
    await app.prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        error: 'Cancelled before the worker started.',
      },
    });
    return { execution: await loadExecution(app, execution.id, user.id) };
  });
}

async function wait(app: FastifyInstance, id: string, ownerId: string) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const current = await loadExecution(app, id, ownerId);
    if (
      current.status === 'success' ||
      current.status === 'error' ||
      current.status === 'cancelled'
    )
      return current;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return loadExecution(app, id, ownerId);
}
