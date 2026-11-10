import vm from 'node:vm';
import type { ExpressionScope } from './runtime.js';

const TIMEOUT_MESSAGE = 'JavaScript exceeded the time limit for this step.';

function readMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown };
    if (record.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return TIMEOUT_MESSAGE;
    if (typeof record.message === 'string' && record.message.length > 0) {
      if (record.message.toLowerCase().includes('timed out')) return TIMEOUT_MESSAGE;
      return record.message;
    }
  }
  return 'JavaScript failed.';
}

export function runInSandbox(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs: number,
): unknown {
  const sandbox: Record<string, unknown> = {
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Date,
    RegExp,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    ...scope,
    result: undefined,
  };

  const context = vm.createContext(sandbox, {
    name: 'flowpilot-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  let script: vm.Script;
  try {
    script = new vm.Script(`"use strict";\nresult = (function () {\n${code}\n})();\n`, {
      filename: 'flowpilot-step.js',
    });
  } catch (error) {
    throw new Error(
      readMessage(error)
        .replace(/^flowpilot-step\.js:\d+\n/, '')
        .slice(0, 500),
    );
  }

  try {
    script.runInContext(context, { timeout: timeoutMs, displayErrors: true });
  } catch (error) {
    throw new Error(
      readMessage(error)
        .replace(/^flowpilot-step\.js:\d+\n/, '')
        .slice(0, 500),
    );
  }

  if (sandbox.result && typeof (sandbox.result as { then?: unknown }).then === 'function') {
    throw new Error('Step JavaScript must finish synchronously.');
  }

  return sandbox.result;
}

export function evaluateExpression(
  expression: string,
  scope: ExpressionScope,
  timeoutMs: number,
): unknown {
  return runInSandbox(`return (${expression});`, { ...scope }, timeoutMs);
}
