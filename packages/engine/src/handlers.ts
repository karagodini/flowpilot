import type { Item, JsonObject, WorkflowNode } from '@flowpilot/shared';
import { parseCsv, rowsToItems } from './csv.js';
import { interpolateDeep, interpolateString, interpolateValue } from './expressions.js';
import { assertPublicHttpUrl, assertWriteSql } from './guards.js';
import type { ExpressionScope, HandlerOutcome, RunContext } from './runtime.js';
import { EngineError } from './runtime.js';
import { evaluateExpression, runInSandbox } from './sandbox.js';

const AI_SKIP_REASON = 'AI step skipped because no OpenAI-compatible API key is saved for it.';

function scopeFor(items: Item[], index: number, ctx: RunContext): ExpressionScope {
  const $node: ExpressionScope['$node'] = {};
  for (const [name, output] of ctx.nodeOutputs) {
    $node[name] = { json: output[0]?.json ?? {}, items: output };
  }
  return {
    $json: items[index]?.json ?? {},
    $items: items,
    $itemIndex: index,
    $now: ctx.options.hooks.now().toISOString(),
    $node,
    $execution: { id: ctx.options.executionId, trigger: ctx.options.trigger },
  };
}

function timeout(ctx: RunContext): number {
  return ctx.options.sandboxTimeoutMs ?? 1000;
}

async function credential(node: WorkflowNode, ctx: RunContext): Promise<JsonObject | null> {
  if (!node.credentialId) return null;
  try {
    return await ctx.options.hooks.resolveCredential(node.credentialId);
  } catch {
    throw new EngineError(`The credential for "${node.name}" is not in the vault.`, node.id);
  }
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function coerceItems(value: unknown): Item[] {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => {
    if (
      entry &&
      typeof entry === 'object' &&
      'json' in entry &&
      (entry as Item).json &&
      typeof (entry as Item).json === 'object'
    ) {
      return { json: (entry as Item).json };
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry))
      return { json: entry as JsonObject };
    return { json: { value: entry as never } };
  });
}

function parseModelJson(text: string): JsonObject {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The model did not return a JSON object.');
  }
  return parsed as JsonObject;
}

function outputOf(items: Item[]): HandlerOutcome {
  if (items.length > 5_000) throw new Error('A step tried to emit more than 5,000 items.');
  return { branches: { output: items } };
}

async function mapItems(
  items: Item[],
  ctx: RunContext,
  visit: (item: Item, scope: ExpressionScope, index: number) => Promise<Item>,
): Promise<Item[]> {
  const output: Item[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    output.push(await visit(item, scopeFor(items, index, ctx), index));
  }
  return output;
}

function triggerItems(node: WorkflowNode, items: Item[], ctx: RunContext): Item[] {
  if (items.length > 0) return items;
  return [
    {
      json: {
        triggeredAt: ctx.options.hooks.now().toISOString(),
        trigger: ctx.options.trigger,
        node: node.name,
      },
    },
  ];
}

async function sheetItems(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Promise<HandlerOutcome> {
  if (items.length > 0) return outputOf(items);
  const mode = String(node.config.mode ?? 'csv');
  const seen = Number(ctx.options.state?.sheetsRowCount ?? 0);
  let all: Item[] = [];

  if (mode === 'api') {
    const secret = await credential(node, ctx);
    const apiKey = String(secret?.apiKey ?? '');
    if (!apiKey) {
      throw new Error('Add a Google Sheets API key, or switch this trigger to CSV.');
    }
    const spreadsheetId = String(node.config.spreadsheetId ?? '').trim();
    const range = String(node.config.range ?? 'A:Z').trim();
    if (!spreadsheetId) throw new Error('Add a spreadsheet id.');
    const rows = await ctx.options.hooks.fetchSheet({ apiKey, spreadsheetId, range });
    all = rowsToItems(rows);
  } else {
    all = parseCsv(String(node.config.csvText ?? ''));
  }

  const fresh = all.slice(Math.max(0, seen));
  ctx.statePatch.sheetsRowCount = all.length;
  const warnings = fresh.length === 0 ? ['No new rows.'] : undefined;
  return { branches: { output: fresh }, warnings, status: 'success' };
}

async function httpItems(node: WorkflowNode, items: Item[], ctx: RunContext): Promise<Item[]> {
  const secret = await credential(node, ctx);
  const method = String(node.config.method ?? 'GET').toUpperCase();
  return mapItems(items, ctx, async (item, scope) => {
    const rawUrl = interpolateString(String(node.config.url ?? ''), scope, timeout(ctx));
    const url = assertPublicHttpUrl(rawUrl);
    const query = interpolateDeep(node.config.query ?? {}, scope, timeout(ctx));
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
        if (value != null && value !== '') url.searchParams.set(key, String(value));
      }
    }
    const headerSource = interpolateDeep(node.config.headers ?? {}, scope, timeout(ctx));
    const headers: Record<string, string> = {};
    if (headerSource && typeof headerSource === 'object') {
      for (const [key, value] of Object.entries(headerSource as Record<string, unknown>)) {
        headers[key] = String(value);
      }
    }
    if (secret?.headerName && secret.headerValue) {
      headers[String(secret.headerName)] = String(secret.headerValue);
    }
    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(method) && node.config.body != null && node.config.body !== '') {
      body =
        typeof node.config.body === 'string'
          ? interpolateString(node.config.body, scope, timeout(ctx))
          : JSON.stringify(interpolateDeep(node.config.body, scope, timeout(ctx)));
      const hasType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
      if (!hasType) headers['Content-Type'] = 'application/json';
    }
    const timeoutMs = Math.min(Math.max(Number(node.config.timeoutMs ?? 15_000), 100), 60_000);
    const response = await ctx.options.hooks.httpRequest({
      method,
      url: url.toString(),
      headers,
      body,
      timeoutMs,
    });
    let parsed: unknown = response.body;
    try {
      parsed = response.body ? JSON.parse(response.body) : null;
    } catch {
      parsed = response.body;
    }
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status} from ${url.origin}${url.pathname}`);
    }
    return {
      json: {
        ...item.json,
        http: { status: response.status, body: parsed, headers: response.headers },
      },
    };
  });
}

function transformItems(node: WorkflowNode, items: Item[], ctx: RunContext): Item[] {
  const scope = scopeFor(items, 0, ctx);
  const value = runInSandbox(
    String(node.config.code ?? 'return items'),
    {
      items,
      $json: scope.$json,
      $node: scope.$node,
      $now: scope.$now,
      $execution: scope.$execution,
    },
    timeout(ctx),
  );
  return coerceItems(value);
}

function conditionBranches(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Record<string, Item[]> {
  const expression = String(node.config.expression ?? 'false');
  const passed: Item[] = [];
  const failed: Item[] = [];
  items.forEach((item, index) => {
    const value = evaluateExpression(expression, scopeFor(items, index, ctx), timeout(ctx));
    (value ? passed : failed).push(item);
  });
  return { true: passed, false: failed };
}

async function telegramItems(node: WorkflowNode, items: Item[], ctx: RunContext): Promise<Item[]> {
  const secret = await credential(node, ctx);
  const botToken = String(secret?.botToken ?? '');
  if (!botToken)
    throw new Error('Save a Telegram bot token in the vault and select it on this step.');
  return mapItems(items, ctx, async (item, scope) => {
    const chatId = interpolateString(String(node.config.chatId ?? ''), scope, timeout(ctx)).trim();
    const text = interpolateString(String(node.config.text ?? ''), scope, timeout(ctx));
    if (!chatId) throw new Error('Add a Telegram chat id.');
    if (!text.trim()) throw new Error('Add the message text.');
    const parseMode = String(node.config.parseMode ?? '').trim();
    const result = await ctx.options.hooks.sendTelegram({
      botToken,
      chatId,
      text,
      parseMode: parseMode || undefined,
    });
    return { json: { ...item.json, telegram: { ok: true, messageId: result.messageId ?? null } } };
  });
}

async function emailItems(node: WorkflowNode, items: Item[], ctx: RunContext): Promise<Item[]> {
  const secret = await credential(node, ctx);
  if (!secret?.host || !secret.username || !secret.password) {
    throw new Error('Save an SMTP credential and select it on this step.');
  }
  return mapItems(items, ctx, async (item, scope) => {
    const to = interpolateString(String(node.config.to ?? ''), scope, timeout(ctx)).trim();
    const subject = interpolateString(String(node.config.subject ?? ''), scope, timeout(ctx));
    const text = interpolateString(String(node.config.text ?? ''), scope, timeout(ctx));
    if (!to) throw new Error('Add a recipient.');
    const result = await ctx.options.hooks.sendEmail({ credential: secret, to, subject, text });
    return { json: { ...item.json, email: { to, messageId: result.messageId ?? null } } };
  });
}

async function postgresItems(node: WorkflowNode, items: Item[], ctx: RunContext): Promise<Item[]> {
  const secret = await credential(node, ctx);
  const connectionString = String(secret?.connectionString ?? '');
  if (!connectionString)
    throw new Error('Save a PostgreSQL connection string and select it on this step.');
  const paramsConfig = Array.isArray(node.config.params) ? node.config.params : [];
  return mapItems(items, ctx, async (item, scope) => {
    const sql = assertWriteSql(
      interpolateString(String(node.config.sql ?? ''), scope, timeout(ctx)),
    );
    const params = paramsConfig.map((entry) =>
      interpolateValue(String(entry), scope, timeout(ctx)),
    );
    const result = await ctx.options.hooks.queryPostgres({ connectionString, sql, params });
    return {
      json: {
        ...item.json,
        postgres: { rowCount: result.rowCount, rows: result.rows.slice(0, 50) },
      },
    };
  });
}

async function aiCredential(node: WorkflowNode, ctx: RunContext): Promise<JsonObject | null> {
  const secret = await credential(node, ctx);
  if (!secret?.apiKey) return null;
  return secret;
}

function skippedAi(items: Item[]): HandlerOutcome {
  return {
    status: 'skipped',
    warnings: [AI_SKIP_REASON],
    branches: {
      output: items.map((item) => ({
        json: { ...item.json, ai: { skipped: true, reason: AI_SKIP_REASON } },
      })),
    },
  };
}

async function promptItems(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Promise<HandlerOutcome> {
  const secret = await aiCredential(node, ctx);
  if (!secret) return skippedAi(items);
  const output = await mapItems(items, ctx, async (item, scope) => {
    const content = await ctx.options.hooks.completeChat({
      apiKey: String(secret.apiKey),
      baseUrl: String(secret.baseUrl ?? 'https://api.openai.com/v1'),
      model: String(node.config.model ?? 'gpt-4o-mini'),
      temperature: Number(node.config.temperature ?? 0.2),
      json: false,
      messages: [
        {
          role: 'system',
          content: interpolateString(String(node.config.system ?? ''), scope, timeout(ctx)),
        },
        {
          role: 'user',
          content: interpolateString(String(node.config.prompt ?? ''), scope, timeout(ctx)),
        },
      ],
    });
    return { json: { ...item.json, ai: { skipped: false, text: content.content } } };
  });
  return outputOf(output);
}

async function classifyItems(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Promise<HandlerOutcome> {
  const secret = await aiCredential(node, ctx);
  if (!secret) return skippedAi(items);
  const categories = stringList(node.config.categories);
  if (categories.length < 2) throw new Error('Add at least two categories.');
  const output = await mapItems(items, ctx, async (item, scope) => {
    const content = await ctx.options.hooks.completeChat({
      apiKey: String(secret.apiKey),
      baseUrl: String(secret.baseUrl ?? 'https://api.openai.com/v1'),
      model: String(node.config.model ?? 'gpt-4o-mini'),
      temperature: 0,
      json: true,
      messages: [
        {
          role: 'system',
          content: `Classify the user text into exactly one of: ${categories.join(', ')}. Reply with JSON {"category": string, "confidence": number} and no other text.`,
        },
        {
          role: 'user',
          content: interpolateString(String(node.config.text ?? ''), scope, timeout(ctx)),
        },
      ],
    });
    const parsed = parseModelJson(content.content);
    const category = String(parsed.category ?? '');
    const match = categories.find((entry) => entry.toLowerCase() === category.toLowerCase());
    if (!match)
      throw new Error(`The model returned "${category}", which is not one of the categories.`);
    return {
      json: {
        ...item.json,
        ai: {
          skipped: false,
          category: match,
          confidence: Number(parsed.confidence ?? 0),
        },
      },
    };
  });
  return outputOf(output);
}

async function extractItems(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Promise<HandlerOutcome> {
  const secret = await aiCredential(node, ctx);
  if (!secret) return skippedAi(items);
  const hint = String(node.config.schemaHint ?? '{}');
  const output = await mapItems(items, ctx, async (item, scope) => {
    const content = await ctx.options.hooks.completeChat({
      apiKey: String(secret.apiKey),
      baseUrl: String(secret.baseUrl ?? 'https://api.openai.com/v1'),
      model: String(node.config.model ?? 'gpt-4o-mini'),
      temperature: 0,
      json: true,
      messages: [
        {
          role: 'system',
          content: `Extract a JSON object with this shape: ${hint}. Reply with JSON only.`,
        },
        {
          role: 'user',
          content: interpolateString(String(node.config.text ?? ''), scope, timeout(ctx)),
        },
      ],
    });
    return {
      json: { ...item.json, ai: { skipped: false, data: parseModelJson(content.content) } },
    };
  });
  return outputOf(output);
}

export async function runHandler(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Promise<HandlerOutcome> {
  switch (node.type) {
    case 'trigger.manual':
    case 'trigger.webhook':
    case 'trigger.cron':
    case 'trigger.telegram':
      return outputOf(triggerItems(node, items, ctx));
    case 'trigger.sheets':
      return sheetItems(node, items, ctx);
    case 'action.http':
      return outputOf(await httpItems(node, items, ctx));
    case 'action.transform':
      return outputOf(transformItems(node, items, ctx));
    case 'action.condition':
      return { branches: conditionBranches(node, items, ctx) };
    case 'action.delay': {
      const ms = Math.min(Math.max(Number(node.config.ms ?? 0), 0), 300_000);
      if (ms > 0) await ctx.options.hooks.sleep(ms);
      return outputOf(items);
    }
    case 'action.telegram':
      return outputOf(await telegramItems(node, items, ctx));
    case 'action.email':
      return outputOf(await emailItems(node, items, ctx));
    case 'action.postgres':
      return outputOf(await postgresItems(node, items, ctx));
    case 'ai.prompt':
      return promptItems(node, items, ctx);
    case 'ai.classify':
      return classifyItems(node, items, ctx);
    case 'ai.extract':
      return extractItems(node, items, ctx);
    case 'action.loop':
      throw new EngineError('Loop steps are executed by the runner.', node.id);
    default:
      throw new EngineError(`Unknown step type "${node.type}".`, node.id);
  }
}
