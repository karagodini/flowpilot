import type { Item, JsonObject, WorkflowGraph } from '@flowpilot/shared';

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ExpressionScope {
  $json: JsonObject;
  $items: Item[];
  $itemIndex: number;
  $now: string;
  $node: Record<string, { json: JsonObject; items: Item[] }>;
  $execution: { id: string; trigger: string };
}

export interface EngineHooks {
  resolveCredential(id: string): Promise<JsonObject>;
  httpRequest(request: HttpRequest): Promise<HttpResponse>;
  sendTelegram(input: {
    botToken: string;
    chatId: string;
    text: string;
    parseMode?: string;
  }): Promise<JsonObject>;
  sendEmail(input: {
    credential: JsonObject;
    to: string;
    subject: string;
    text: string;
  }): Promise<JsonObject>;
  queryPostgres(input: {
    connectionString: string;
    sql: string;
    params: unknown[];
  }): Promise<{ rowCount: number; rows: unknown[] }>;
  completeChat(input: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    messages: { role: string; content: string }[];
    json: boolean;
  }): Promise<{ content: string }>;
  fetchSheet(input: { apiKey: string; spreadsheetId: string; range: string }): Promise<string[][]>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  onErrorWorkflow?(payload: {
    nodeId: string;
    nodeName: string;
    error: string;
    input: Item[];
    executionId: string;
  }): Promise<void>;
}

export interface ExecuteOptions {
  graph: WorkflowGraph;
  items: Item[];
  executionId: string;
  trigger: string;
  hooks: EngineHooks;
  triggerNodeId?: string;
  state?: Record<string, unknown>;
  maxLoopIterations?: number;
  sandboxTimeoutMs?: number;
}

export interface StepLog {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'success' | 'error' | 'skipped';
  input: Item[];
  output: Item[];
  error?: string;
  warnings?: string[];
  attempt: number;
  startedAt: string;
  finishedAt: string;
}

export interface ExecutionResult {
  status: 'success' | 'error';
  output: Item[];
  steps: StepLog[];
  error?: string;
  errorNodeId?: string;
  statePatch: Record<string, unknown>;
}

export class EngineError extends Error {
  readonly nodeId?: string;

  constructor(message: string, nodeId?: string) {
    super(message);
    this.name = 'EngineError';
    this.nodeId = nodeId;
  }
}

export interface HandlerOutcome {
  branches: Record<string, Item[]>;
  status?: 'success' | 'skipped';
  warnings?: string[];
}

export interface RunContext {
  options: ExecuteOptions;
  steps: StepLog[];
  nodeOutputs: Map<string, Item[]>;
  statePatch: Record<string, unknown>;
  order: number;
}
