import type { Prisma, PrismaClient } from '@flowpilot/db';
import { nextCronDate } from './schedule.js';

export async function tickSchedules(
  prisma: PrismaClient,
  enqueue: (executionId: string) => Promise<void>,
  now = new Date(),
): Promise<number> {
  let queued = 0;
  const dueSchedules = await prisma.schedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now }, workflow: { active: true } },
    include: { workflow: { include: { currentVersion: true } } },
  });

  for (const schedule of dueSchedules) {
    let next: Date;
    try {
      next = nextCronDate(schedule.cron, schedule.timezone, now);
    } catch {
      next = new Date(now.getTime() + 60 * 60_000);
    }
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: now, nextRunAt: next },
    });
    if (!schedule.workflow.currentVersion) continue;
    const execution = await prisma.execution.create({
      data: {
        workflowId: schedule.workflowId,
        versionId: schedule.workflow.currentVersion.id,
        status: 'queued',
        trigger: 'cron',
        mode: 'schedule',
        input: [] as unknown as Prisma.InputJsonValue,
      },
    });
    await enqueue(execution.id);
    queued += 1;
  }

  const duePolls = await prisma.poll.findMany({
    where: { enabled: true, nextRunAt: { lte: now }, workflow: { active: true } },
    include: { workflow: { include: { currentVersion: true } } },
  });
  for (const poll of duePolls) {
    const next = new Date(now.getTime() + poll.intervalMinutes * 60_000);
    await prisma.poll.update({
      where: { id: poll.id },
      data: { lastRunAt: now, nextRunAt: next },
    });
    if (!poll.workflow.currentVersion) continue;
    const execution = await prisma.execution.create({
      data: {
        workflowId: poll.workflowId,
        versionId: poll.workflow.currentVersion.id,
        status: 'queued',
        trigger: 'sheets',
        mode: 'poll',
        input: [] as unknown as Prisma.InputJsonValue,
      },
    });
    await enqueue(execution.id);
    queued += 1;
  }

  return queued;
}
