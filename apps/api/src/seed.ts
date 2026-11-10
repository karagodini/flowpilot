import { randomBytes } from 'node:crypto';
import { createPrismaClient, encryptJson, type Prisma } from '@flowpilot/db';
import { WORKFLOW_TEMPLATES, type WorkflowGraph } from '@flowpilot/shared';
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { loadRootEnv } from './env.js';
import { saveVersion } from './workflows.js';

loadRootEnv();

const password = process.env.SEED_USER_PASSWORD;
if (!password) {
  console.error('Set SEED_USER_PASSWORD before seeding local development data.');
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrismaClient();
const email = (process.env.SEED_USER_EMAIL || 'mira.ellison@harborlane.com').toLowerCase();
const name = process.env.SEED_USER_NAME || 'Mira Ellison';

function template(id: string) {
  const found = WORKFLOW_TEMPLATES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing template ${id}`);
  return found;
}

function leadFirstPass(graph: WorkflowGraph): WorkflowGraph {
  return {
    nodes: graph.nodes.filter((node) => node.id !== 'intent'),
    edges: [
      ...graph.edges.filter((edge) => edge.source !== 'intent' && edge.target !== 'intent'),
      { id: 'e-direct', source: 'norm', target: 'gate' },
    ],
  };
}

async function ensureWorkflow(
  ownerId: string,
  graph: WorkflowGraph,
  fields: { name: string; description: string; note: string; active: boolean },
) {
  const existing = await prisma.workflow.findFirst({ where: { ownerId, name: fields.name } });
  if (existing) return existing;
  const workflow = await prisma.workflow.create({
    data: { ownerId, name: fields.name, description: fields.description, active: false },
  });
  await saveVersion(prisma, workflow.id, graph, fields.note);
  return prisma.workflow.update({ where: { id: workflow.id }, data: { active: fields.active } });
}

async function ensureCredential(
  ownerId: string,
  entry: { name: string; type: string; data: Record<string, unknown>; preview: string },
) {
  const existing = await prisma.credential.findFirst({ where: { ownerId, name: entry.name } });
  if (existing) return;
  const sealed = encryptJson(entry.data, config.encryptionKey);
  await prisma.credential.create({
    data: { ownerId, name: entry.name, type: entry.type, preview: entry.preview, ...sealed },
  });
}

const user = await prisma.user.upsert({
  where: { email },
  update: { name },
  create: { email, name, passwordHash: await hashPassword(password) },
});

const failureTemplate = template('failure-notice');
const leadTemplate = template('lead-qualification');
const digestTemplate = template('weekday-digest');
const deskTemplate = template('telegram-desk');

const failure = await ensureWorkflow(user.id, failureTemplate.graph, {
  name: failureTemplate.name,
  description: failureTemplate.description,
  note: 'Operations channel for failed runs',
  active: true,
});

const leadExisting = await prisma.workflow.findFirst({
  where: { ownerId: user.id, name: leadTemplate.name },
});
let lead = leadExisting;
if (!lead) {
  lead = await prisma.workflow.create({
    data: {
      ownerId: user.id,
      name: leadTemplate.name,
      description: leadTemplate.description,
      active: false,
    },
  });
  await saveVersion(
    prisma,
    lead.id,
    leadFirstPass(leadTemplate.graph),
    'Scored leads from company size and the note.',
  );
  await saveVersion(
    prisma,
    lead.id,
    leadTemplate.graph,
    'Added buying-intent classification when a model key is available.',
  );
  lead = await prisma.workflow.update({
    where: { id: lead.id },
    data: { active: true, errorWorkflowId: failure.id },
  });
}

await ensureWorkflow(user.id, digestTemplate.graph, {
  name: digestTemplate.name,
  description: digestTemplate.description,
  note: 'Weekday pipeline mail',
  active: true,
});
await ensureWorkflow(user.id, deskTemplate.graph, {
  name: deskTemplate.name,
  description: deskTemplate.description,
  note: 'On-call intake',
  active: false,
});

const localToken = `000000000:${randomBytes(12).toString('hex')}`;
await ensureCredential(user.id, {
  name: 'Sales channel bot',
  type: 'telegram',
  preview: 'Bot token stored',
  data: { botToken: localToken },
});
await ensureCredential(user.id, {
  name: 'Harbor Lane mail',
  type: 'smtp',
  preview: 'mira@harborlane.com via smtp.harborlane.com',
  data: {
    host: 'smtp.harborlane.com',
    port: 587,
    secure: false,
    username: 'mira@harborlane.com',
    password: randomBytes(18).toString('base64url'),
    from: 'Harbor & Lane <mira@harborlane.com>',
  },
});

const history = await prisma.execution.count({ where: { workflowId: lead.id } });
if (history === 0) {
  const current = await prisma.workflowVersion.findFirst({
    where: { workflowId: lead.id },
    orderBy: { version: 'desc' },
  });
  const digest = await prisma.workflow.findFirst({
    where: { ownerId: user.id, name: digestTemplate.name },
    include: { currentVersion: true },
  });
  const desk = await prisma.workflow.findFirst({
    where: { ownerId: user.id, name: deskTemplate.name },
    include: { currentVersion: true },
  });
  if (current) {
    await recordRun(lead.id, current.id, {
      hoursAgo: 5,
      status: 'success',
      trigger: 'webhook',
      input: [
        {
          json: {
            method: 'POST',
            path: 'inbound-lead',
            body: {
              name: 'Amina Rahman',
              email: 'amina.rahman@fieldnote.io',
              company: 'Fieldnote',
              employees: 80,
              note: 'We are replacing a spreadsheet the sales team outgrew.',
            },
          },
        },
      ],
      output: [
        {
          json: {
            email: 'amina.rahman@fieldnote.io',
            name: 'Amina Rahman',
            company: 'Fieldnote',
            score: 75,
            telegram: { ok: true, messageId: 1842 },
          },
        },
      ],
      steps: [
        step('form', 'Website form', 'trigger.webhook', 'success', 0),
        step('norm', 'Normalize lead', 'action.transform', 'success', 1),
        step(
          'intent',
          'Read buying intent',
          'ai.classify',
          'skipped',
          2,
          'AI step skipped because no OpenAI-compatible API key is saved for it.',
        ),
        step('gate', 'Worth a call', 'action.condition', 'success', 3),
        step('alert', 'Alert sales', 'action.telegram', 'success', 4),
      ],
    });
    await recordRun(lead.id, current.id, {
      hoursAgo: 30,
      status: 'success',
      trigger: 'webhook',
      input: [
        {
          json: {
            body: {
              name: 'Jonas Berg',
              email: 'jonas.berg@northpier.com',
              company: 'North Pier',
              employees: 12,
              note: 'Curious.',
            },
          },
        },
      ],
      output: [{ json: { email: 'jonas.berg@northpier.com', score: 35, emailSent: true } }],
      steps: [
        step('form', 'Website form', 'trigger.webhook', 'success', 0),
        step('norm', 'Normalize lead', 'action.transform', 'success', 1),
        step('gate', 'Worth a call', 'action.condition', 'success', 2),
        step('nurture', 'Send follow-up', 'action.email', 'success', 3),
      ],
    });
  }
  if (digest?.currentVersion) {
    await recordRun(digest.id, digest.currentVersion.id, {
      hoursAgo: 26,
      status: 'error',
      trigger: 'cron',
      error: 'HTTP 503 from ops.harborlane.com',
      input: [],
      output: [],
      steps: [
        step('clock', 'Weekday 8:00', 'trigger.cron', 'success', 0),
        step(
          'fetch',
          'Load pipeline',
          'action.http',
          'error',
          1,
          undefined,
          'HTTP 503 from ops.harborlane.com',
        ),
        step(
          'fetch',
          'Load pipeline',
          'action.http',
          'error',
          2,
          undefined,
          'HTTP 503 from ops.harborlane.com',
        ),
      ],
    });
  }
  if (desk?.currentVersion) {
    await recordRun(desk.id, desk.currentVersion.id, {
      hoursAgo: 8,
      status: 'success',
      trigger: 'telegram',
      input: [
        {
          json: {
            chatId: '44821',
            text: 'Can someone reset my billing portal login?',
            from: 'lena',
          },
        },
      ],
      output: [
        {
          json: {
            chatId: '44821',
            text: 'Can someone reset my billing portal login?',
            ai: { skipped: true },
            email: { to: 'oncall@harborlane.com', messageId: 'm-204' },
          },
        },
      ],
      steps: [
        step('in', 'On-call bot', 'trigger.telegram', 'success', 0),
        step(
          'cls',
          'Classify intent',
          'ai.classify',
          'skipped',
          1,
          'AI step skipped because no OpenAI-compatible API key is saved for it.',
        ),
        step('branch', 'Billing only', 'action.condition', 'success', 2),
        step('escalate', 'Escalate to on-call', 'action.email', 'success', 3),
      ],
    });
  }
}

console.log(`Seed data for local development is ready for ${email}.`);
await prisma.$disconnect();

function step(
  nodeId: string,
  nodeName: string,
  nodeType: string,
  status: string,
  order: number,
  warning?: string,
  error?: string,
) {
  return { nodeId, nodeName, nodeType, status, order, warning, error };
}

async function recordRun(
  workflowId: string,
  versionId: string,
  run: {
    hoursAgo: number;
    status: string;
    trigger: string;
    input: unknown;
    output: unknown;
    error?: string;
    steps: ReturnType<typeof step>[];
  },
) {
  const finished = new Date(Date.now() - run.hoursAgo * 3600_000);
  const started = new Date(finished.getTime() - 2400);
  const execution = await prisma.execution.create({
    data: {
      workflowId,
      versionId,
      status: run.status,
      trigger: run.trigger,
      mode: 'standard',
      input: run.input as Prisma.InputJsonValue,
      output: run.output as Prisma.InputJsonValue,
      error: run.error ?? null,
      startedAt: started,
      finishedAt: finished,
      createdAt: started,
    },
  });
  await prisma.executionStep.createMany({
    data: run.steps.map((entry) => ({
      executionId: execution.id,
      nodeId: entry.nodeId,
      nodeName: entry.nodeName,
      nodeType: entry.nodeType,
      status: entry.status,
      input: run.input as Prisma.InputJsonValue,
      output: entry.status === 'error' ? [] : (run.output as Prisma.InputJsonValue),
      error: entry.error ?? null,
      warnings: entry.warning ? [entry.warning] : [],
      attempt: entry.order > 1 && entry.status === 'error' ? 2 : 1,
      startedAt: new Date(started.getTime() + entry.order * 120),
      finishedAt: new Date(started.getTime() + entry.order * 120 + 80),
      order: entry.order,
    })),
  });
}
