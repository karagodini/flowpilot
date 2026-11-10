import { decryptJson, type Prisma, type PrismaClient } from '@flowpilot/db';
import { executeWorkflow, type EngineHooks } from '@flowpilot/engine';
import type { Item, JsonObject } from '@flowpilot/shared';
import type { AppConfig } from './config.js';
import { createIntegrationHooks } from './integrations.js';

export interface RunnerDeps {
  prisma: PrismaClient;
  config: AppConfig;
  enqueue: (executionId: string) => Promise<void>;
}

const integrations = createIntegrationHooks();

export async function processExecution(executionId: string, deps: RunnerDeps): Promise<void> {
  const execution = await deps.prisma.execution.findUnique({
    where: { id: executionId },
    include: { version: true, workflow: true },
  });
  if (!execution) return;
  if (execution.status === 'success' || execution.status === 'cancelled') return;

  await deps.prisma.execution.update({
    where: { id: execution.id },
    data: { status: 'running', startedAt: execution.startedAt ?? new Date() },
  });

  const stateRows = await deps.prisma.workflowState.findMany({
    where: { workflowId: execution.workflowId },
  });
  const state: Record<string, unknown> = {};
  for (const row of stateRows) state[row.key] = row.value;

  const hooks: EngineHooks = {
    ...integrations,
    resolveCredential: async (id) => {
      const credential = await deps.prisma.credential.findFirst({
        where: { id, ownerId: execution.workflow.ownerId },
      });
      if (!credential) throw new Error('The credential for this step is no longer in the vault.');
      return decryptJson<JsonObject>(credential, deps.config.encryptionKey);
    },
    onErrorWorkflow: async (payload) => {
      if (execution.mode === 'error' || !execution.workflow.errorWorkflowId) return;
      const target = await deps.prisma.workflow.findFirst({
        where: {
          id: execution.workflow.errorWorkflowId,
          ownerId: execution.workflow.ownerId,
          active: true,
        },
        include: { currentVersion: true },
      });
      if (!target?.currentVersion) return;
      const created = await deps.prisma.execution.create({
        data: {
          workflowId: target.id,
          versionId: target.currentVersion.id,
          status: 'queued',
          trigger: 'error',
          mode: 'error',
          parentId: execution.id,
          input: [
            {
              json: {
                workflowId: execution.workflowId,
                workflowName: execution.workflow.name,
                executionId: execution.id,
                nodeId: payload.nodeId,
                nodeName: payload.nodeName,
                error: payload.error,
                failedAt: new Date().toISOString(),
              },
            },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      await deps.enqueue(created.id);
    },
  };

  const result = await executeWorkflow({
    graph: {
      nodes: execution.version.nodes as never,
      edges: execution.version.edges as never,
    },
    items: (execution.input as unknown as Item[]) ?? [],
    executionId: execution.id,
    trigger: execution.trigger,
    hooks,
    state,
  });

  if (result.status === 'success') {
    for (const [key, value] of Object.entries(result.statePatch)) {
      await deps.prisma.workflowState.upsert({
        where: { workflowId_key: { workflowId: execution.workflowId, key } },
        create: { workflowId: execution.workflowId, key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      });
    }
  }

  const sheetStep = result.steps.find((step) => step.nodeType === 'trigger.sheets');
  if (
    execution.mode === 'poll' &&
    result.status === 'success' &&
    (sheetStep?.output.length ?? 0) === 0
  ) {
    await deps.prisma.execution.delete({ where: { id: execution.id } });
    return;
  }

  await deps.prisma.$transaction(async (tx) => {
    await tx.executionStep.deleteMany({ where: { executionId: execution.id } });
    if (result.steps.length > 0) {
      await tx.executionStep.createMany({
        data: result.steps.map((step, index) => ({
          executionId: execution.id,
          nodeId: step.nodeId,
          nodeName: step.nodeName,
          nodeType: step.nodeType,
          status: step.status,
          input: step.input as unknown as Prisma.InputJsonValue,
          output: step.output as unknown as Prisma.InputJsonValue,
          error: step.error ?? null,
          warnings: (step.warnings ?? []) as unknown as Prisma.InputJsonValue,
          attempt: step.attempt,
          startedAt: new Date(step.startedAt),
          finishedAt: new Date(step.finishedAt),
          order: index,
        })),
      });
    }
    await tx.execution.update({
      where: { id: execution.id },
      data: {
        status: result.status,
        output: result.output as unknown as Prisma.InputJsonValue,
        error: result.error ?? null,
        finishedAt: new Date(),
      },
    });
  });
}

export async function sweepStaleExecutions(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const result = await prisma.execution.updateMany({
    where: { status: 'running', startedAt: { lt: cutoff } },
    data: {
      status: 'error',
      error: 'The worker stopped before this run finished.',
      finishedAt: new Date(),
    },
  });
  return result.count;
}
