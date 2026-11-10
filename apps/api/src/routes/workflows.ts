import type { Prisma } from '@flowpilot/db';
import { NODE_CATALOG, type WorkflowGraph } from '@flowpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { normalizeItems } from '../items.js';
import { syncTriggers } from '../triggers.js';
import {
  attachCredentialNames,
  defaultGraph,
  exportDocument,
  graphFromVersion,
  ownedWorkflow,
  relinkCredentials,
  requireTemplate,
  saveVersion,
  templateSummaries,
  withAvailablePaths,
} from '../workflows.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(140),
  description: z.string().max(2000).optional(),
  graph: z.unknown().optional(),
});

const metaSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  description: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  errorWorkflowId: z.string().nullable().optional(),
});

const graphSchema = z.object({
  graph: z.unknown(),
  note: z.string().max(280).optional(),
});

const runSchema = z.object({
  payload: z.unknown().optional(),
  wait: z.boolean().optional(),
});

async function present(app: FastifyInstance, workflowId: string, ownerId: string) {
  const workflow = await ownedWorkflow(app.prisma, workflowId, ownerId);
  const graph = workflow.currentVersion
    ? graphFromVersion(workflow.currentVersion)
    : { nodes: [], edges: [] };
  graph.nodes = await attachCredentialNames(app.prisma, ownerId, graph.nodes);
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    active: workflow.active,
    errorWorkflowId: workflow.errorWorkflowId,
    errorWorkflowName: workflow.errorWorkflow?.name ?? null,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    version: workflow.currentVersion
      ? {
          id: workflow.currentVersion.id,
          version: workflow.currentVersion.version,
          note: workflow.currentVersion.note,
          createdAt: workflow.currentVersion.createdAt,
        }
      : null,
    graph,
    webhooks: workflow.webhooks.map((hook) => ({
      path: hook.path,
      method: hook.method,
      kind: hook.kind,
      url: `/api/hooks/${hook.path}`,
    })),
    schedule: workflow.schedule
      ? {
          cron: workflow.schedule.cron,
          timezone: workflow.schedule.timezone,
          nextRunAt: workflow.schedule.nextRunAt,
          enabled: workflow.schedule.enabled,
        }
      : null,
  };
}

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/catalog', async () => ({ nodes: NODE_CATALOG }));
  app.get('/api/templates', async () => ({ templates: templateSummaries() }));

  app.get('/api/workflows', async (request) => {
    const user = await requireUser(request);
    const workflows = await app.prisma.workflow.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        currentVersion: { select: { version: true } },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, trigger: true, createdAt: true },
        },
      },
    });
    return {
      workflows: workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        active: workflow.active,
        updatedAt: workflow.updatedAt,
        createdAt: workflow.createdAt,
        version: workflow.currentVersion?.version ?? null,
        lastExecution: workflow.executions[0] ?? null,
      })),
    };
  });

  app.post('/api/workflows', async (request, reply) => {
    const user = await requireUser(request);
    const body = createSchema.parse(request.body);
    const workflow = await app.prisma.workflow.create({
      data: { ownerId: user.id, name: body.name, description: body.description ?? '' },
    });
    const graph = (body.graph as WorkflowGraph | undefined) ?? defaultGraph();
    await saveVersion(app.prisma, workflow.id, graph, 'Initial version');
    return reply.code(201).send({ workflow: await present(app, workflow.id, user.id) });
  });

  app.get('/api/workflows/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    return { workflow: await present(app, id, user.id) };
  });

  app.patch('/api/workflows/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const body = metaSchema.parse(request.body);
    const workflow = await ownedWorkflow(app.prisma, id, user.id);
    if (body.errorWorkflowId) {
      if (body.errorWorkflowId === workflow.id) {
        throw new HttpError(400, 'A workflow cannot handle its own failures.');
      }
      const target = await app.prisma.workflow.findFirst({
        where: { id: body.errorWorkflowId, ownerId: user.id },
      });
      if (!target) throw new HttpError(400, 'Choose an error workflow you own.');
    }
    if (body.active === true && !workflow.currentVersion) {
      throw new HttpError(400, 'Save the workflow before turning it on.');
    }
    await app.prisma.workflow.update({
      where: { id: workflow.id },
      data: {
        name: body.name ?? workflow.name,
        description: body.description ?? workflow.description,
        active: body.active ?? workflow.active,
        errorWorkflowId:
          body.errorWorkflowId === undefined ? workflow.errorWorkflowId : body.errorWorkflowId,
      },
    });
    return { workflow: await present(app, workflow.id, user.id) };
  });

  app.delete('/api/workflows/:id', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    await ownedWorkflow(app.prisma, id, user.id);
    await app.prisma.workflow.update({
      where: { id },
      data: { currentVersionId: null, errorWorkflowId: null },
    });
    await app.prisma.workflow.updateMany({
      where: { errorWorkflowId: id },
      data: { errorWorkflowId: null },
    });
    await app.prisma.workflow.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.put('/api/workflows/:id/graph', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const body = graphSchema.parse(request.body);
    await ownedWorkflow(app.prisma, id, user.id);
    const linked = await relinkCredentials(
      app.prisma,
      user.id,
      ((body.graph as WorkflowGraph | undefined)?.nodes ?? []) as WorkflowGraph['nodes'],
    );
    const graph = { ...(body.graph as WorkflowGraph), nodes: linked };
    await saveVersion(app.prisma, id, graph, body.note?.trim() || 'Saved from the canvas');
    return { workflow: await present(app, id, user.id) };
  });

  app.get('/api/workflows/:id/versions', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const workflow = await ownedWorkflow(app.prisma, id, user.id);
    const versions = await app.prisma.workflowVersion.findMany({
      where: { workflowId: workflow.id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, note: true, createdAt: true },
    });
    return { versions, currentVersionId: workflow.currentVersionId };
  });

  app.post('/api/workflows/:id/versions/:versionId/restore', async (request) => {
    const user = await requireUser(request);
    const { id, versionId } = request.params as { id: string; versionId: string };
    const workflow = await ownedWorkflow(app.prisma, id, user.id);
    const version = await app.prisma.workflowVersion.findFirst({
      where: { id: versionId, workflowId: workflow.id },
    });
    if (!version) throw new HttpError(404, 'Version not found.');
    await app.prisma.workflow.update({
      where: { id: workflow.id },
      data: { currentVersionId: version.id },
    });
    await syncTriggers(app.prisma, workflow.id, graphFromVersion(version));
    return { workflow: await present(app, workflow.id, user.id) };
  });

  app.get('/api/workflows/:id/export', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const workflow = await ownedWorkflow(app.prisma, id, user.id);
    if (!workflow.currentVersion)
      throw new HttpError(400, 'This workflow has nothing to export yet.');
    const graph = graphFromVersion(workflow.currentVersion);
    graph.nodes = await attachCredentialNames(app.prisma, user.id, graph.nodes);
    return exportDocument(workflow, graph);
  });

  app.post('/api/workflows/import', async (request, reply) => {
    const user = await requireUser(request);
    const body = request.body as {
      workflow?: {
        name?: string;
        description?: string;
        errorWorkflowName?: string | null;
        graph?: WorkflowGraph;
      };
    };
    if (!body?.workflow?.graph) throw new HttpError(400, 'That file is not a FlowPilot workflow.');
    const name = String(body.workflow.name || 'Imported workflow').slice(0, 140);
    const nodes = await relinkCredentials(app.prisma, user.id, body.workflow.graph.nodes ?? []);
    const workflow = await app.prisma.workflow.create({
      data: {
        ownerId: user.id,
        name,
        description: String(body.workflow.description ?? '').slice(0, 2000),
      },
    });
    const graph = await withAvailablePaths(app.prisma, {
      nodes,
      edges: body.workflow.graph.edges ?? [],
    });
    await saveVersion(app.prisma, workflow.id, graph, 'Imported');
    if (body.workflow.errorWorkflowName) {
      const target = await app.prisma.workflow.findFirst({
        where: { ownerId: user.id, name: body.workflow.errorWorkflowName },
      });
      if (target && target.id !== workflow.id) {
        await app.prisma.workflow.update({
          where: { id: workflow.id },
          data: { errorWorkflowId: target.id },
        });
      }
    }
    return reply.code(201).send({ workflow: await present(app, workflow.id, user.id) });
  });

  app.post('/api/templates/:id/use', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const template = requireTemplate(id);
    const body = z
      .object({ name: z.string().trim().min(1).max(140).optional() })
      .parse(request.body ?? {});
    const workflow = await app.prisma.workflow.create({
      data: {
        ownerId: user.id,
        name: body.name ?? template.name,
        description: template.description,
      },
    });
    const nodes = await relinkCredentials(app.prisma, user.id, template.graph.nodes);
    const graph = await withAvailablePaths(app.prisma, { nodes, edges: template.graph.edges });
    await saveVersion(app.prisma, workflow.id, graph, `Started from ${template.name}`);
    return reply.code(201).send({ workflow: await present(app, workflow.id, user.id) });
  });

  app.post('/api/workflows/:id/run', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const body = runSchema.parse(request.body ?? {});
    const workflow = await ownedWorkflow(app.prisma, id, user.id);
    if (!workflow.currentVersion) throw new HttpError(400, 'Save the workflow before running it.');
    const execution = await app.prisma.execution.create({
      data: {
        workflowId: workflow.id,
        versionId: workflow.currentVersion.id,
        status: 'queued',
        trigger: 'manual',
        mode: 'standard',
        input: normalizeItems(body.payload) as unknown as Prisma.InputJsonValue,
      },
    });
    await app.queue.enqueue(execution.id);
    if (body.wait === false) {
      return { execution: await loadExecution(app, execution.id, user.id) };
    }
    const finished = await waitForExecution(app, execution.id, user.id, 20_000);
    return { execution: finished };
  });
}

export async function loadExecution(app: FastifyInstance, id: string, ownerId: string) {
  const execution = await app.prisma.execution.findFirst({
    where: { id, workflow: { ownerId } },
    include: {
      workflow: { select: { id: true, name: true } },
      version: { select: { version: true } },
      steps: { orderBy: { order: 'asc' } },
    },
  });
  if (!execution) throw new HttpError(404, 'Execution not found.');
  return {
    id: execution.id,
    workflowId: execution.workflowId,
    workflowName: execution.workflow.name,
    versionId: execution.versionId,
    version: execution.version.version,
    status: execution.status,
    trigger: execution.trigger,
    mode: execution.mode,
    attempt: execution.attempt,
    parentId: execution.parentId,
    input: execution.input,
    output: execution.output,
    error: execution.error,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    createdAt: execution.createdAt,
    steps: execution.steps,
  };
}

async function waitForExecution(
  app: FastifyInstance,
  id: string,
  ownerId: string,
  timeoutMs: number,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
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
