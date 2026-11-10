import type { Prisma, PrismaClient } from '@flowpilot/db';
import type { WorkflowGraph } from '@flowpilot/shared';
import { HttpError, isUniqueViolation } from './errors.js';
import { nextCronDate } from './schedule.js';

type Db = PrismaClient | Prisma.TransactionClient;

const PATH_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export async function syncTriggers(
  prisma: PrismaClient,
  workflowId: string,
  graph: WorkflowGraph,
): Promise<void> {
  const listeners = graph.nodes.filter(
    (node) => node.type === 'trigger.webhook' || node.type === 'trigger.telegram',
  );
  const desired = listeners.map((node) => {
    const path = String(node.config.path ?? '')
      .trim()
      .toLowerCase();
    if (!PATH_PATTERN.test(path)) {
      throw new HttpError(
        400,
        `Set a public path on "${node.name}" using letters, numbers, and hyphens.`,
      );
    }
    return {
      workflowId,
      nodeId: node.id,
      path,
      method:
        node.type === 'trigger.telegram'
          ? 'POST'
          : String(node.config.method ?? 'POST').toUpperCase(),
      kind: node.type === 'trigger.telegram' ? 'telegram' : 'http',
    };
  });
  if (new Set(desired.map((entry) => entry.path)).size !== desired.length) {
    throw new HttpError(400, 'Each listener in a workflow needs its own path.');
  }

  const cronNode = graph.nodes.find((node) => node.type === 'trigger.cron');
  let cronNext: Date | null = null;
  let cron = '';
  let timezone = 'UTC';
  if (cronNode) {
    cron = String(cronNode.config.cron ?? '').trim();
    timezone = String(cronNode.config.timezone ?? 'UTC').trim() || 'UTC';
    try {
      cronNext = nextCronDate(cron, timezone);
    } catch {
      throw new HttpError(
        400,
        `The schedule on "${cronNode.name}" is not a valid cron expression.`,
      );
    }
  }

  const sheet = graph.nodes.find((node) => node.type === 'trigger.sheets');
  const intervalMinutes = sheet
    ? Math.min(Math.max(Number(sheet.config.intervalMinutes ?? 15) || 15, 1), 24 * 60)
    : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhook.deleteMany({ where: { workflowId } });
      if (desired.length > 0) await tx.webhook.createMany({ data: desired });
      await writeSchedule(
        tx,
        workflowId,
        cronNode ? { cron, timezone, nextRunAt: cronNext! } : null,
      );
      await writePoll(tx, workflowId, intervalMinutes);
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'That webhook path is already used by another workflow.');
    }
    throw error;
  }
}

async function writeSchedule(
  tx: Db,
  workflowId: string,
  value: { cron: string; timezone: string; nextRunAt: Date } | null,
): Promise<void> {
  if (!value) {
    await tx.schedule.deleteMany({ where: { workflowId } });
    return;
  }
  await tx.schedule.upsert({
    where: { workflowId },
    create: {
      workflowId,
      cron: value.cron,
      timezone: value.timezone,
      nextRunAt: value.nextRunAt,
      enabled: true,
    },
    update: {
      cron: value.cron,
      timezone: value.timezone,
      nextRunAt: value.nextRunAt,
      enabled: true,
    },
  });
}

async function writePoll(
  tx: Db,
  workflowId: string,
  intervalMinutes: number | null,
): Promise<void> {
  if (intervalMinutes == null) {
    await tx.poll.deleteMany({ where: { workflowId } });
    return;
  }
  const nextRunAt = new Date(Date.now() + intervalMinutes * 60_000);
  await tx.poll.upsert({
    where: { workflowId },
    create: { workflowId, intervalMinutes, nextRunAt, enabled: true },
    update: { intervalMinutes, nextRunAt, enabled: true },
  });
}
