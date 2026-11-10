import type { EngineHooks, HttpRequest, HttpResponse } from '@flowpilot/engine';
import type { JsonObject } from '@flowpilot/shared';
import nodemailer from 'nodemailer';
import pg from 'pg';

type SqlValue = string | number | boolean | null;

function asSqlValues(params: unknown[]): SqlValue[] {
  return params.map((value) => {
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      return value;
    return JSON.stringify(value);
  });
}

export function createIntegrationHooks(): Pick<
  EngineHooks,
  | 'httpRequest'
  | 'sendTelegram'
  | 'sendEmail'
  | 'queryPostgres'
  | 'completeChat'
  | 'fetchSheet'
  | 'sleep'
  | 'now'
> {
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    httpRequest,
    sendTelegram,
    sendEmail,
    queryPostgres,
    completeChat,
    fetchSheet,
  };
}

async function httpRequest(request: HttpRequest): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const body = (await response.text()).slice(0, 500_000);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, headers, body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`The request to ${safeHost(request.url)} timed out.`);
    }
    throw new Error(`The request to ${safeHost(request.url)} failed.`);
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(input: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: string;
}): Promise<JsonObject> {
  const response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.description || 'Telegram rejected the message.');
  }
  return { ok: true, messageId: payload.result?.message_id ?? null };
}

async function sendEmail(input: {
  credential: JsonObject;
  to: string;
  subject: string;
  text: string;
}): Promise<JsonObject> {
  const port = Number(input.credential.port ?? 587);
  const transport = nodemailer.createTransport({
    host: String(input.credential.host),
    port,
    secure: Boolean(input.credential.secure ?? port === 465),
    auth: {
      user: String(input.credential.username),
      pass: String(input.credential.password),
    },
  });
  try {
    const info = await transport.sendMail({
      from: String(input.credential.from || input.credential.username),
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { messageId: info.messageId };
  } finally {
    transport.close();
  }
}

async function queryPostgres(input: {
  connectionString: string;
  sql: string;
  params: unknown[];
}): Promise<{ rowCount: number; rows: unknown[] }> {
  const client = new pg.Client({
    connectionString: input.connectionString,
    statement_timeout: 15_000,
  });
  await client.connect();
  try {
    const result = await client.query(input.sql, asSqlValues(input.params));
    return { rowCount: result.rowCount ?? 0, rows: result.rows.slice(0, 50) };
  } finally {
    await client.end();
  }
}

async function completeChat(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: { role: string; content: string }[];
  json: boolean;
}): Promise<{ content: string }> {
  const base = input.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1';
  const body: Record<string, unknown> = {
    model: input.model,
    temperature: Math.min(Math.max(input.temperature, 0), 2),
    messages: input.messages,
  };
  if (input.json) body.response_format = { type: 'json_object' };
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `The model API returned HTTP ${response.status}.`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('The model API returned an empty response.');
  return { content };
}

async function fetchSheet(input: {
  apiKey: string;
  spreadsheetId: string;
  range: string;
}): Promise<string[][]> {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}`,
  );
  url.searchParams.set('key', input.apiKey);
  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    values?: string[][];
  };
  if (!response.ok)
    throw new Error(payload.error?.message || 'Google Sheets rejected the request.');
  return payload.values ?? [];
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return 'the remote host';
  }
}
