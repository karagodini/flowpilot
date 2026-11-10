import type { Item, WorkflowEdge, WorkflowNode } from '@flowpilot/shared';
import { clampLoggedItems } from './guards.js';
import { runHandler } from './handlers.js';
import {
  EngineError,
  type ExecuteOptions,
  type ExecutionResult,
  type RunContext,
  type StepLog,
} from './runtime.js';

function preferredTrigger(trigger: string): string | undefined {
  const map: Record<string, string> = {
    manual: 'trigger.manual',
    webhook: 'trigger.webhook',
    cron: 'trigger.cron',
    telegram: 'trigger.telegram',
    sheets: 'trigger.sheets',
    retry: 'trigger.manual',
    error: 'trigger.manual',
  };
  return map[trigger];
}

function selectTrigger(options: ExecuteOptions): WorkflowNode {
  const nodes = options.graph.nodes;
  if (options.triggerNodeId) {
    const chosen = nodes.find((node) => node.id === options.triggerNodeId);
    if (!chosen) throw new EngineError('The requested trigger is not on this workflow.');
    return chosen;
  }
  const preferred = preferredTrigger(options.trigger);
  const match = preferred ? nodes.find((node) => node.type === preferred) : undefined;
  const fallback = nodes.find((node) => node.type.startsWith('trigger.'));
  const trigger = match ?? fallback;
  if (!trigger) throw new EngineError('This workflow has no trigger.');
  return trigger;
}

function edgesFrom(edges: WorkflowEdge[], nodeId: string, handle: string): WorkflowEdge[] {
  return edges.filter(
    (edge) => edge.source === nodeId && (edge.sourceHandle || 'output') === handle,
  );
}

function flatten(branches: Record<string, Item[]>): Item[] {
  return Object.values(branches).flat();
}

function logStep(ctx: RunContext, step: StepLog): void {
  ctx.steps.push({
    ...step,
    input: clampLoggedItems(step.input),
    output: clampLoggedItems(step.output),
  });
}

async function executeWithPolicy(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
): Promise<Record<string, Item[]>> {
  if (node.disabled) {
    const now = ctx.options.hooks.now().toISOString();
    logStep(ctx, {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'skipped',
      input: items,
      output: items,
      attempt: 1,
      startedAt: now,
      finishedAt: now,
      warnings: ['This step is turned off and was passed through.'],
    });
    ctx.nodeOutputs.set(node.name, items);
    return { output: items };
  }

  const maxAttempts = Math.min(Math.max(node.retry?.maxAttempts ?? 1, 1), 8);
  const backoff = Math.min(Math.max(node.retry?.backoffMs ?? 0, 0), 60_000);
  let lastMessage = 'Step failed.';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = ctx.options.hooks.now().toISOString();
    try {
      const outcome = await runHandler(node, items, ctx);
      const output = flatten(outcome.branches);
      logStep(ctx, {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        status: outcome.status ?? 'success',
        input: items,
        output,
        attempt,
        startedAt,
        finishedAt: ctx.options.hooks.now().toISOString(),
        warnings: outcome.warnings,
      });
      ctx.nodeOutputs.set(node.name, output);
      return outcome.branches;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : 'Step failed.';
      logStep(ctx, {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        status: 'error',
        input: items,
        output: [],
        error: lastMessage,
        attempt,
        startedAt,
        finishedAt: ctx.options.hooks.now().toISOString(),
      });
      if (attempt < maxAttempts) await ctx.options.hooks.sleep(backoff * attempt);
    }
  }

  if (node.onError === 'continue') {
    ctx.nodeOutputs.set(node.name, items);
    return { output: items };
  }
  if (node.onError === 'errorWorkflow') {
    await ctx.options.hooks.onErrorWorkflow?.({
      nodeId: node.id,
      nodeName: node.name,
      error: lastMessage,
      input: items,
      executionId: ctx.options.executionId,
    });
  }
  throw new EngineError(lastMessage, node.id);
}

async function fanOut(
  node: WorkflowNode,
  branches: Record<string, Item[]>,
  ctx: RunContext,
  visiting: Set<string>,
): Promise<Item[]> {
  const terminal: Item[] = [];
  for (const [handle, branchItems] of Object.entries(branches)) {
    const next = edgesFrom(ctx.options.graph.edges, node.id, handle);
    if (next.length === 0) {
      terminal.push(...branchItems);
      continue;
    }
    if (branchItems.length === 0) continue;
    for (const edge of next) {
      terminal.push(...(await executeNode(edge.target, branchItems, ctx, visiting)));
    }
  }
  return terminal;
}

async function runLoop(
  node: WorkflowNode,
  items: Item[],
  ctx: RunContext,
  visiting: Set<string>,
): Promise<Item[]> {
  const startedAt = ctx.options.hooks.now().toISOString();
  const batchSize = Math.min(Math.max(Number(node.config.batchSize ?? 1), 1), 500);
  const maxItems = ctx.options.maxLoopIterations ?? 1000;
  const eachEdges = edgesFrom(ctx.options.graph.edges, node.id, 'each');
  const collected: Item[] = [];
  let seen = 0;

  try {
    for (let index = 0; index < items.length; index += batchSize) {
      const batch = items.slice(index, index + batchSize);
      seen += batch.length;
      if (seen > maxItems) {
        throw new EngineError(`Loop "${node.name}" stopped after ${maxItems} items.`, node.id);
      }
      if (eachEdges.length === 0) {
        collected.push(...batch);
        continue;
      }
      for (const edge of eachEdges) {
        collected.push(...(await executeNode(edge.target, batch, ctx, visiting)));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Loop failed.';
    logStep(ctx, {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'error',
      input: items,
      output: [],
      error: message,
      attempt: 1,
      startedAt,
      finishedAt: ctx.options.hooks.now().toISOString(),
    });
    throw error instanceof EngineError ? error : new EngineError(message, node.id);
  }

  logStep(ctx, {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    status: 'success',
    input: items,
    output: collected,
    attempt: 1,
    startedAt,
    finishedAt: ctx.options.hooks.now().toISOString(),
  });
  ctx.nodeOutputs.set(node.name, collected);

  const doneEdges = edgesFrom(ctx.options.graph.edges, node.id, 'done');
  if (doneEdges.length === 0) return collected;
  const terminal: Item[] = [];
  if (collected.length === 0) return terminal;
  for (const edge of doneEdges) {
    terminal.push(...(await executeNode(edge.target, collected, ctx, visiting)));
  }
  return terminal;
}

async function executeNode(
  nodeId: string,
  items: Item[],
  ctx: RunContext,
  visiting: Set<string>,
): Promise<Item[]> {
  if (visiting.has(nodeId)) {
    throw new EngineError(
      'This workflow contains a cycle. Loops should use the Loop step.',
      nodeId,
    );
  }
  const node = ctx.options.graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) throw new EngineError('A connection points at a missing step.', nodeId);
  visiting.add(nodeId);
  try {
    if (node.type === 'action.loop' && !node.disabled) {
      return await runLoop(node, items, ctx, visiting);
    }
    const branches = await executeWithPolicy(node, items, ctx);
    return await fanOut(node, branches, ctx, visiting);
  } finally {
    visiting.delete(nodeId);
  }
}

export async function executeWorkflow(options: ExecuteOptions): Promise<ExecutionResult> {
  const ctx: RunContext = {
    options,
    steps: [],
    nodeOutputs: new Map(),
    statePatch: {},
    order: 0,
  };

  try {
    const trigger = selectTrigger(options);
    const output = await executeNode(trigger.id, options.items, ctx, new Set());
    return { status: 'success', output, steps: ctx.steps, statePatch: ctx.statePatch };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execution failed.';
    const nodeId = error instanceof EngineError ? error.nodeId : undefined;
    return {
      status: 'error',
      output: [],
      steps: ctx.steps,
      error: message,
      errorNodeId: nodeId,
      statePatch: ctx.statePatch,
    };
  }
}
