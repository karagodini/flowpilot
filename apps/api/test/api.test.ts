import { createPrismaClient, type PrismaClient } from '@flowpilot/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createInlineQueue } from '../src/queue.js';
import { processExecution } from '../src/runner.js';
import { nextCronDate } from '../src/schedule.js';
import { tickSchedules } from '../src/scheduler.js';
import type { FastifyInstance } from 'fastify';

let prisma: PrismaClient;
let app: FastifyInstance;

async function reset(): Promise<void> {
  await prisma.executionStep.deleteMany();
  await prisma.execution.deleteMany();
  await prisma.workflowState.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.poll.deleteMany();
  await prisma.workflow.updateMany({ data: { currentVersionId: null, errorWorkflowId: null } });
  await prisma.workflowVersion.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.user.deleteMany();
}

beforeAll(async () => {
  const config = loadConfig();
  prisma = createPrismaClient();
  const bridge: { enqueue: (id: string) => Promise<void> } = {
    enqueue: async () => undefined,
  };
  const queue = createInlineQueue((id) =>
    processExecution(id, { prisma, config, enqueue: (next) => bridge.enqueue(next) }),
  );
  bridge.enqueue = (id) => queue.enqueue(id);
  app = await buildApp({ prisma, config, queue, logger: false });
});

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function register(email = 'mira.ellison@harborlane.com') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: 'Mira Ellison', password: 'HarborLane19' },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { token: string; user: { id: string; email: string } };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('auth and health', () => {
  it('answers a database health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'flowpilot-api' });
  });

  it('rejects a short password and a wrong login', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'ops@harborlane.com', name: 'Ops', password: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    const account = await register();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: account.user.email, password: 'HarborLane00' },
    });
    expect(bad.statusCode).toBe(401);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: auth(account.token),
    });
    expect(me.json().user.email).toBe(account.user.email);
  });
});

describe('workflows', () => {
  it('saves versions, runs a transform, and keeps another account out', async () => {
    const mira = await register();
    const created = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: auth(mira.token),
      payload: { name: 'Normalize inbox', description: 'Lowercase the address on a manual run.' },
    });
    expect(created.statusCode).toBe(201);
    const workflowId = created.json().workflow.id as string;

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflowId}/graph`,
      headers: auth(mira.token),
      payload: {
        note: 'Lowercase email',
        graph: {
          nodes: [
            {
              id: 'start',
              type: 'trigger.manual',
              name: 'Manual run',
              position: { x: 0, y: 0 },
              config: {},
            },
            {
              id: 'shape',
              type: 'action.transform',
              name: 'Lowercase',
              position: { x: 280, y: 0 },
              config: {
                code: 'return [{ json: { email: String(items[0].json.email).toLowerCase() } }]',
              },
            },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'shape' }],
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().workflow.version.version).toBe(2);

    const versions = await app.inject({
      method: 'GET',
      url: `/api/workflows/${workflowId}/versions`,
      headers: auth(mira.token),
    });
    expect(versions.json().versions).toHaveLength(2);

    const run = await app.inject({
      method: 'POST',
      url: `/api/workflows/${workflowId}/run`,
      headers: auth(mira.token),
      payload: { payload: { email: 'Mira@HarborLane.com' } },
    });
    expect(run.statusCode).toBe(200);
    const execution = run.json().execution;
    expect(execution.status).toBe('success');
    expect(execution.output[0].json.email).toBe('mira@harborlane.com');
    expect(execution.steps.map((step: { nodeName: string }) => step.nodeName)).toEqual([
      'Manual run',
      'Lowercase',
    ]);

    const retried = await app.inject({
      method: 'POST',
      url: `/api/executions/${execution.id}/retry`,
      headers: auth(mira.token),
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().execution.attempt).toBe(2);
    expect(retried.json().execution.status).toBe('success');

    const other = await register('lena.owens@harborlane.com');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/workflows/${workflowId}`,
      headers: auth(other.token),
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('stores a credential without echoing the secret and exports a portable workflow', async () => {
    const mira = await register();
    const credential = await app.inject({
      method: 'POST',
      url: '/api/credentials',
      headers: auth(mira.token),
      payload: {
        name: 'Sales channel bot',
        type: 'telegram',
        data: { botToken: '123456:local-development-token' },
      },
    });
    expect(credential.statusCode).toBe(201);
    expect(JSON.stringify(credential.json())).not.toContain('local-development-token');
    expect(credential.json().credential.preview).toBe('Bot token stored');

    const used = await app.inject({
      method: 'POST',
      url: '/api/templates/lead-qualification/use',
      headers: auth(mira.token),
    });
    expect(used.statusCode).toBe(201);
    const workflow = used.json().workflow;
    const alert = workflow.graph.nodes.find(
      (node: { name: string }) => node.name === 'Alert sales',
    );
    expect(alert.credentialId).toBe(credential.json().credential.id);

    const exported = await app.inject({
      method: 'GET',
      url: `/api/workflows/${workflow.id}/export`,
      headers: auth(mira.token),
    });
    const document = exported.json() as {
      format: string;
      workflow: {
        name: string;
        description: string;
        graph: unknown;
        errorWorkflowName: string | null;
      };
    };
    expect(document.format).toBe('flowpilot.workflow');
    expect(JSON.stringify(document)).not.toContain(credential.json().credential.id);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/workflows/import',
      headers: auth(mira.token),
      payload: { ...document, workflow: { ...document.workflow, name: 'Imported lead path' } },
    });
    expect(imported.statusCode).toBe(201);
    const importedAlert = imported
      .json()
      .workflow.graph.nodes.find((node: { name: string }) => node.name === 'Alert sales');
    expect(importedAlert.credentialId).toBe(credential.json().credential.id);
  });

  it('accepts an active webhook and records the run', async () => {
    const mira = await register();
    const created = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: auth(mira.token),
      payload: {
        name: 'Inbound lead',
        graph: {
          nodes: [
            {
              id: 'hook',
              type: 'trigger.webhook',
              name: 'Website form',
              position: { x: 0, y: 0 },
              config: { path: 'inbound-lead', method: 'POST' },
            },
            {
              id: 'shape',
              type: 'action.transform',
              name: 'Normalize lead',
              position: { x: 240, y: 0 },
              config: {
                code: 'const body = items[0].json.body || {}\nreturn [{ json: { email: String(body.email || "").toLowerCase() } }]',
              },
            },
          ],
          edges: [{ id: 'e', source: 'hook', target: 'shape' }],
        },
      },
    });
    const workflowId = created.json().workflow.id as string;
    const quiet = await app.inject({
      method: 'POST',
      url: '/api/hooks/inbound-lead',
      payload: { email: 'Amina@Fieldnote.io' },
    });
    expect(quiet.statusCode).toBe(404);

    await app.inject({
      method: 'PATCH',
      url: `/api/workflows/${workflowId}`,
      headers: auth(mira.token),
      payload: { active: true },
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/hooks/inbound-lead',
      payload: { email: 'Amina@Fieldnote.io' },
    });
    expect(accepted.statusCode).toBe(202);
    const executionId = accepted.json().executionId as string;
    const detail = await app.inject({
      method: 'GET',
      url: `/api/executions/${executionId}`,
      headers: auth(mira.token),
    });
    expect(detail.json().execution.status).toBe('success');
    expect(detail.json().execution.output[0].json.email).toBe('amina@fieldnote.io');
  });

  it('queues a cron run when the schedule is due', async () => {
    const mira = await register();
    const created = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: auth(mira.token),
      payload: {
        name: 'Weekday pipeline digest',
        graph: {
          nodes: [
            {
              id: 'clock',
              type: 'trigger.cron',
              name: 'Weekday 8:00',
              position: { x: 0, y: 0 },
              config: { cron: '0 8 * * 1-5', timezone: 'UTC' },
            },
          ],
          edges: [],
        },
      },
    });
    const workflowId = created.json().workflow.id as string;
    await app.inject({
      method: 'PATCH',
      url: `/api/workflows/${workflowId}`,
      headers: auth(mira.token),
      payload: { active: true },
    });
    await prisma.schedule.update({
      where: { workflowId },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
    const queued = await tickSchedules(prisma, async () => undefined);
    expect(queued).toBe(1);
    const rows = await prisma.execution.findMany({ where: { workflowId } });
    expect(rows[0]?.trigger).toBe('cron');
  });
});

describe('cron', () => {
  it('moves a weekday expression forward', () => {
    const next = nextCronDate('0 8 * * 1-5', 'UTC', new Date('2026-04-13T08:00:00.000Z'));
    expect(next.toISOString()).toBe('2026-04-14T08:00:00.000Z');
  });
});
