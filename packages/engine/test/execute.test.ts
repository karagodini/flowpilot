import { describe, expect, it } from 'vitest';
import {
  validateGraph,
  WORKFLOW_TEMPLATES,
  type Item,
  type WorkflowGraph,
  type WorkflowNode,
} from '@flowpilot/shared';
import {
  assertPublicHttpUrl,
  assertWriteSql,
  executeWorkflow,
  parseCsv,
  type EngineHooks,
} from '../src/index.js';

const NOW = new Date('2026-04-12T15:04:00.000Z');

function hooks(overrides: Partial<EngineHooks> = {}): EngineHooks {
  return {
    resolveCredential: async () => ({}),
    httpRequest: async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    sendTelegram: async () => ({ ok: true, messageId: 42 }),
    sendEmail: async () => ({ messageId: 'mail-1' }),
    queryPostgres: async () => ({ rowCount: 1, rows: [] }),
    completeChat: async () => ({ content: '{"category":"hot","confidence":0.91}' }),
    fetchSheet: async () => [
      ['email', 'plan'],
      ['amina@fieldnote.io', 'studio'],
    ],
    sleep: async () => {},
    now: () => NOW,
    ...overrides,
  };
}

function node(partial: WorkflowNode): WorkflowNode {
  return partial;
}

function run(
  graph: WorkflowGraph,
  items: Item[] = [],
  extra: Partial<Parameters<typeof executeWorkflow>[0]> = {},
) {
  return executeWorkflow({
    graph,
    items,
    executionId: 'exec_1',
    trigger: extra.trigger ?? 'manual',
    hooks: extra.hooks ?? hooks(),
    ...extra,
  });
}

describe('executeWorkflow', () => {
  it('runs connected steps in order and records input and output', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'shape',
            type: 'action.transform',
            name: 'Shape',
            position: { x: 0, y: 0 },
            config: {
              code: 'return [{ json: { email: String(items[0].json.email).toLowerCase(), ready: true } }]',
            },
          }),
        ],
        edges: [{ id: 'e', source: 'in', target: 'shape' }],
      },
      [{ json: { email: 'Mira@HarborLane.com' } }],
    );

    expect(result.status).toBe('success');
    expect(result.steps.map((step) => step.nodeName)).toEqual(['Start', 'Shape']);
    expect(result.output).toEqual([{ json: { email: 'mira@harborlane.com', ready: true } }]);
    expect(result.steps[1]?.input).toEqual([{ json: { email: 'Mira@HarborLane.com' } }]);
  });

  it('routes condition branches independently', async () => {
    const seen: string[] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'gate',
            type: 'action.condition',
            name: 'Hot',
            position: { x: 0, y: 0 },
            config: { expression: 'Number($json.score) >= 55' },
          }),
          node({
            id: 'yes',
            type: 'action.transform',
            name: 'Call',
            position: { x: 0, y: 0 },
            config: {
              code: 'return items.map((item) => ({ json: { ...item.json, lane: "call" } }))',
            },
          }),
          node({
            id: 'no',
            type: 'action.transform',
            name: 'Nurture',
            position: { x: 0, y: 0 },
            config: {
              code: 'return items.map((item) => ({ json: { ...item.json, lane: "nurture" } }))',
            },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'gate' },
          { id: 'b', source: 'gate', target: 'yes', sourceHandle: 'true' },
          { id: 'c', source: 'gate', target: 'no', sourceHandle: 'false' },
        ],
      },
      [{ json: { score: 80, name: 'Amina' } }, { json: { score: 20, name: 'Jonas' } }],
      {
        hooks: hooks({
          sleep: async () => {
            seen.push('sleep');
          },
        }),
      },
    );

    expect(result.status).toBe('success');
    expect(result.output).toEqual([
      { json: { score: 80, name: 'Amina', lane: 'call' } },
      { json: { score: 20, name: 'Jonas', lane: 'nurture' } },
    ]);
    expect(seen).toEqual([]);
  });

  it('loops each item and passes the combined body result to done', async () => {
    const queries: unknown[][] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Rows',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'loop',
            type: 'action.loop',
            name: 'Each row',
            position: { x: 0, y: 0 },
            config: { batchSize: 1 },
          }),
          node({
            id: 'clean',
            type: 'action.transform',
            name: 'Clean',
            position: { x: 0, y: 0 },
            config: {
              code: 'return items.map((item) => ({ json: { email: String(item.json.email).toLowerCase(), seats: Number(item.json.seats) } }))',
            },
          }),
          node({
            id: 'write',
            type: 'action.postgres',
            name: 'Insert',
            position: { x: 0, y: 0 },
            credentialId: 'cred_pg',
            config: {
              sql: 'INSERT INTO accounts (email, seats) VALUES ($1, $2)',
              params: ['{{ $json.email }}', '{{ $json.seats }}'],
            },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'loop' },
          { id: 'b', source: 'loop', target: 'clean', sourceHandle: 'each' },
          { id: 'c', source: 'loop', target: 'write', sourceHandle: 'done' },
        ],
      },
      [
        { json: { email: 'Amina@Fieldnote.io', seats: 12 } },
        { json: { email: 'Jonas@Northpier.com', seats: 40 } },
      ],
      {
        hooks: hooks({
          resolveCredential: async () => ({ connectionString: 'postgresql://app@db/accounts' }),
          queryPostgres: async ({ params }) => {
            queries.push(params);
            return { rowCount: 1, rows: [] };
          },
        }),
      },
    );

    expect(result.status).toBe('success');
    expect(queries).toEqual([
      ['amina@fieldnote.io', 12],
      ['jonas@northpier.com', 40],
    ]);
    expect(result.output).toHaveLength(2);
    expect(result.output[0]?.json.postgres).toMatchObject({ rowCount: 1 });
  });

  it('fills templates from an upstream step', async () => {
    const urls: string[] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'norm',
            type: 'action.transform',
            name: 'Normalize',
            position: { x: 0, y: 0 },
            config: { code: 'return [{ json: { email: "mira@harborlane.com", score: 70 } }]' },
          }),
          node({
            id: 'call',
            type: 'action.http',
            name: 'Lookup',
            position: { x: 0, y: 0 },
            config: {
              method: 'GET',
              url: 'https://ops.harborlane.com/people/{{ $node["Normalize"].json.email }}',
            },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'norm' },
          { id: 'b', source: 'norm', target: 'call' },
        ],
      },
      [{ json: { raw: true } }],
      {
        hooks: hooks({
          httpRequest: async (request) => {
            urls.push(request.url);
            return { status: 200, headers: {}, body: '{"found":true}' };
          },
        }),
      },
    );

    expect(result.status).toBe('success');
    expect(urls).toEqual(['https://ops.harborlane.com/people/mira@harborlane.com']);
    expect(result.output[0]?.json.http).toMatchObject({ status: 200, body: { found: true } });
  });

  it('retries a flaky request and then continues', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'http',
            type: 'action.http',
            name: 'Load',
            position: { x: 0, y: 0 },
            retry: { maxAttempts: 3, backoffMs: 25 },
            config: { method: 'GET', url: 'https://ops.harborlane.com/v1/pipeline/summary' },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'http' }],
      },
      [{ json: { firedAt: NOW.toISOString() } }],
      {
        hooks: hooks({
          sleep: async (ms) => {
            delays.push(ms);
          },
          httpRequest: async () => {
            calls += 1;
            if (calls < 3) throw new Error('socket hang up');
            return { status: 200, headers: {}, body: '{"open":4}' };
          },
        }),
      },
    );

    expect(result.status).toBe('success');
    expect(calls).toBe(3);
    expect(delays).toEqual([25, 50]);
    expect(
      result.steps.filter((step) => step.nodeId === 'http').map((step) => step.status),
    ).toEqual(['error', 'error', 'success']);
  });

  it('stops after the last failed attempt', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'http',
            type: 'action.http',
            name: 'Load',
            position: { x: 0, y: 0 },
            retry: { maxAttempts: 2, backoffMs: 0 },
            config: { method: 'GET', url: 'https://ops.harborlane.com/missing' },
          }),
          node({
            id: 'next',
            type: 'action.transform',
            name: 'After',
            position: { x: 0, y: 0 },
            config: { code: 'return items' },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'http' },
          { id: 'b', source: 'http', target: 'next' },
        ],
      },
      [{ json: {} }],
      {
        hooks: hooks({
          httpRequest: async () => ({ status: 503, headers: {}, body: 'unavailable' }),
        }),
      },
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('HTTP 503');
    expect(result.errorNodeId).toBe('http');
    expect(result.steps.some((step) => step.nodeName === 'After')).toBe(false);
  });

  it('continues with the incoming items when a step is allowed to fail', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'http',
            type: 'action.http',
            name: 'Load',
            position: { x: 0, y: 0 },
            onError: 'continue',
            config: { method: 'GET', url: 'https://ops.harborlane.com/missing' },
          }),
          node({
            id: 'next',
            type: 'action.transform',
            name: 'After',
            position: { x: 0, y: 0 },
            config: { code: 'return [{ json: { kept: items[0].json.name } }]' },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'http' },
          { id: 'b', source: 'http', target: 'next' },
        ],
      },
      [{ json: { name: 'Mira' } }],
      { hooks: hooks({ httpRequest: async () => ({ status: 500, headers: {}, body: '' }) }) },
    );

    expect(result.status).toBe('success');
    expect(result.output).toEqual([{ json: { kept: 'Mira' } }]);
  });

  it('invokes the error workflow hook once and still fails the run', async () => {
    const calls: string[] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'bad',
            type: 'action.transform',
            name: 'Break',
            position: { x: 0, y: 0 },
            onError: 'errorWorkflow',
            config: { code: 'throw new Error("score missing")' },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'bad' }],
      },
      [{ json: {} }],
      {
        hooks: hooks({
          onErrorWorkflow: async (payload) => {
            calls.push(`${payload.nodeName}:${payload.error}`);
          },
        }),
      },
    );

    expect(result.status).toBe('error');
    expect(calls).toEqual(['Break:score missing']);
  });

  it('rejects a cycle', async () => {
    const result = await run({
      nodes: [
        node({
          id: 'a',
          type: 'trigger.manual',
          name: 'Start',
          position: { x: 0, y: 0 },
          config: {},
        }),
        node({
          id: 'b',
          type: 'action.delay',
          name: 'Wait',
          position: { x: 0, y: 0 },
          config: { ms: 0 },
        }),
      ],
      edges: [
        { id: '1', source: 'a', target: 'b' },
        { id: '2', source: 'b', target: 'a' },
      ],
    });
    expect(result.status).toBe('error');
    expect(result.error).toContain('cycle');
  });

  it('passes items through a disabled step', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'off',
            type: 'action.delay',
            name: 'Paused',
            position: { x: 0, y: 0 },
            disabled: true,
            config: { ms: 99999 },
          }),
          node({
            id: 'next',
            type: 'action.transform',
            name: 'After',
            position: { x: 0, y: 0 },
            config: { code: 'return [{ json: { seen: true } }]' },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'off' },
          { id: 'b', source: 'off', target: 'next' },
        ],
      },
      [{ json: { ok: 1 } }],
    );
    expect(result.status).toBe('success');
    expect(result.steps.find((step) => step.nodeId === 'off')?.status).toBe('skipped');
    expect(result.output).toEqual([{ json: { seen: true } }]);
  });

  it('waits when a delay step asks it to', async () => {
    const waits: number[] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'wait',
            type: 'action.delay',
            name: 'Hold',
            position: { x: 0, y: 0 },
            config: { ms: 250 },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'wait' }],
      },
      [{ json: { ok: true } }],
      {
        hooks: hooks({
          sleep: async (ms) => {
            waits.push(ms);
          },
        }),
      },
    );
    expect(result.status).toBe('success');
    expect(waits).toEqual([250]);
    expect(result.output[0]?.json.ok).toBe(true);
  });

  it('skips AI steps when no key is configured and still lets the run finish', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'ai',
            type: 'ai.classify',
            name: 'Intent',
            position: { x: 0, y: 0 },
            config: { text: '{{ $json.note }}', categories: ['hot', 'warm', 'cold'] },
          }),
          node({
            id: 'gate',
            type: 'action.condition',
            name: 'Hot',
            position: { x: 0, y: 0 },
            config: { expression: '$json.ai && $json.ai.category === "hot"' },
          }),
          node({
            id: 'else',
            type: 'action.transform',
            name: 'Fallback',
            position: { x: 0, y: 0 },
            config: {
              code: 'return [{ json: { path: "fallback", skipped: items[0].json.ai.skipped } }]',
            },
          }),
        ],
        edges: [
          { id: 'a', source: 'in', target: 'ai' },
          { id: 'b', source: 'ai', target: 'gate' },
          { id: 'c', source: 'gate', target: 'else', sourceHandle: 'false' },
        ],
      },
      [{ json: { note: 'Need a walkthrough next week' } }],
    );

    expect(result.status).toBe('success');
    expect(result.steps.find((step) => step.nodeId === 'ai')?.status).toBe('skipped');
    expect(result.output).toEqual([{ json: { path: 'fallback', skipped: true } }]);
  });

  it('merges a classification when a key is present', async () => {
    let model = '';
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'ai',
            type: 'ai.classify',
            name: 'Intent',
            position: { x: 0, y: 0 },
            credentialId: 'cred_ai',
            config: {
              text: '{{ $json.note }}',
              categories: ['hot', 'warm', 'cold'],
              model: 'gpt-4o-mini',
            },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'ai' }],
      },
      [{ json: { note: 'Ready to buy this quarter', email: 'a@fieldnote.io' } }],
      {
        hooks: hooks({
          resolveCredential: async () => ({
            apiKey: 'sk-test',
            baseUrl: 'https://api.openai.com/v1',
          }),
          completeChat: async (input) => {
            model = input.model;
            expect(input.messages[1]?.content).toContain('Ready to buy');
            return { content: '```json\n{"category":"hot","confidence":0.8}\n```' };
          },
        }),
      },
    );

    expect(result.status).toBe('success');
    expect(model).toBe('gpt-4o-mini');
    expect(result.output[0]?.json).toMatchObject({
      email: 'a@fieldnote.io',
      ai: { skipped: false, category: 'hot', confidence: 0.8 },
    });
  });

  it('does not copy a bot token into the step output', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'send',
            type: 'action.telegram',
            name: 'Alert',
            position: { x: 0, y: 0 },
            credentialId: 'cred_tg',
            config: { chatId: '100', text: 'Hello {{ $json.name }}' },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'send' }],
      },
      [{ json: { name: 'Mira' } }],
      { hooks: hooks({ resolveCredential: async () => ({ botToken: '123456:secret-token' }) }) },
    );
    expect(result.status).toBe('success');
    expect(JSON.stringify(result.steps)).not.toContain('secret-token');
    expect(result.output[0]?.json.telegram).toEqual({ ok: true, messageId: 42 });
  });

  it('blocks SQL that is not a single insert or update', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'db',
            type: 'action.postgres',
            name: 'Wipe',
            position: { x: 0, y: 0 },
            credentialId: 'cred_pg',
            config: { sql: 'DELETE FROM accounts', params: [] },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'db' }],
      },
      [{ json: {} }],
      {
        hooks: hooks({
          resolveCredential: async () => ({ connectionString: 'postgresql://localhost/app' }),
        }),
      },
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('INSERT');
  });

  it('blocks metadata addresses', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'http',
            type: 'action.http',
            name: 'Meta',
            position: { x: 0, y: 0 },
            config: { method: 'GET', url: 'http://169.254.169.254/latest/meta-data' },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'http' }],
      },
      [{ json: {} }],
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('metadata');
  });

  it('emits only unseen CSV rows and records the cursor', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.sheets',
            name: 'Rows',
            position: { x: 0, y: 0 },
            config: {
              mode: 'csv',
              csvText: 'email,plan\namina@fieldnote.io,studio\njonas@northpier.com,atlas\n',
            },
          }),
        ],
        edges: [],
      },
      [],
      { trigger: 'sheets', state: { sheetsRowCount: 1 } },
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual([{ json: { email: 'jonas@northpier.com', plan: 'atlas' } }]);
    expect(result.statePatch).toEqual({ sheetsRowCount: 2 });
  });

  it('uses an expression when the whole field is an expression', async () => {
    const subjects: string[] = [];
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'mail',
            type: 'action.email',
            name: 'Mail',
            position: { x: 0, y: 0 },
            credentialId: 'cred_smtp',
            config: {
              to: 'partners@harborlane.com',
              subject: '={{ $json.score >= 50 ? "high" : "low" }}',
              text: 'Score {{ $json.score }}',
            },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'mail' }],
      },
      [{ json: { score: 70 } }],
      {
        hooks: hooks({
          resolveCredential: async () => ({
            host: 'smtp.harborlane.com',
            username: 'ops',
            password: 'secret',
          }),
          sendEmail: async (input) => {
            subjects.push(input.subject);
            expect(input.text).toBe('Score 70');
            return { messageId: 'm' };
          },
        }),
      },
    );
    expect(result.status).toBe('success');
    expect(subjects).toEqual(['high']);
    expect(JSON.stringify(result.steps)).not.toContain('secret');
  });

  it('selects the webhook trigger when the run was started by a webhook', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'manual',
            type: 'trigger.manual',
            name: 'Manual',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'hook',
            type: 'trigger.webhook',
            name: 'Hook',
            position: { x: 0, y: 0 },
            config: { path: 'lead' },
          }),
        ],
        edges: [],
      },
      [{ json: { body: { email: 'a@fieldnote.io' } } }],
      { trigger: 'webhook' },
    );
    expect(result.status).toBe('success');
    expect(result.steps[0]?.nodeName).toBe('Hook');
    expect(result.output[0]?.json.body).toEqual({ email: 'a@fieldnote.io' });
  });
});

describe('sandbox', () => {
  it('cannot read process or build a function from a string', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'code',
            type: 'action.transform',
            name: 'Code',
            position: { x: 0, y: 0 },
            config: {
              code: `if (typeof process !== "undefined") return [{ json: { leaked: true } }]
try {
  const fn = (function () {}).constructor("return 1")
  return [{ json: { constructed: typeof fn } }]
} catch (error) {
  return [{ json: { blocked: true } }]
}`,
            },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'code' }],
      },
      [{ json: {} }],
    );

    expect(result.status).toBe('success');
    expect(result.output[0]?.json).toEqual({ blocked: true });
  });

  it('stops a runaway loop', async () => {
    const result = await run(
      {
        nodes: [
          node({
            id: 'in',
            type: 'trigger.manual',
            name: 'Start',
            position: { x: 0, y: 0 },
            config: {},
          }),
          node({
            id: 'code',
            type: 'action.transform',
            name: 'Code',
            position: { x: 0, y: 0 },
            config: { code: 'while (true) {}' },
          }),
        ],
        edges: [{ id: 'a', source: 'in', target: 'code' }],
      },
      [{ json: {} }],
      { sandboxTimeoutMs: 200 },
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('time limit');
  });
});

describe('templates', () => {
  it('ships graphs that can be saved', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const { errors } = validateGraph(template.graph);
      expect(errors, template.id).toEqual([]);
    }
  });
});

describe('guards and csv', () => {
  it('parses quoted commas', () => {
    expect(parseCsv('name,note\n"Ellison, Mira","said ""hello"", then left"\n')).toEqual([
      { json: { name: 'Ellison, Mira', note: 'said "hello", then left' } },
    ]);
  });

  it('accepts a single insert and rejects stacked statements', () => {
    expect(assertWriteSql('INSERT INTO accounts (email) VALUES ($1);')).toMatch(/^INSERT/i);
    expect(() =>
      assertWriteSql('INSERT INTO accounts (email) VALUES ($1); DELETE FROM accounts'),
    ).toThrow(/single SQL/);
  });

  it('rejects non-http URLs', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/http/);
  });
});
