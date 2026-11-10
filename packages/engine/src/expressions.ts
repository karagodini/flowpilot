import type { ExpressionScope } from './runtime.js';
import { evaluateExpression } from './sandbox.js';

function readProp(current: unknown, key: string): unknown {
  if (current == null) return undefined;
  if (Array.isArray(current)) {
    const index = Number(key);
    if (Number.isInteger(index)) return current[index];
  }
  if (typeof current === 'object') return (current as Record<string, unknown>)[key];
  return undefined;
}

export function resolvePath(expr: string, scope: ExpressionScope): unknown {
  const rootMatch = expr.match(/^(\$[A-Za-z_][A-Za-z0-9_]*)/);
  if (!rootMatch?.[1]) return undefined;
  let current: unknown = (scope as unknown as Record<string, unknown>)[rootMatch[1]];
  let index = rootMatch[1].length;

  while (index < expr.length) {
    const char = expr[index];
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (char === '.') {
      const match = expr.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match?.[0]) return undefined;
      current = readProp(current, match[0]);
      index += match[0].length + 1;
      continue;
    }
    if (char === '[') {
      const end = expr.indexOf(']', index);
      if (end < 0) return undefined;
      let key = expr.slice(index + 1, end).trim();
      if (
        (key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))
      ) {
        key = key.slice(1, -1);
      }
      current = readProp(current, key);
      index = end + 1;
      continue;
    }
    return undefined;
  }

  return current;
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function interpolateString(input: string, scope: ExpressionScope, timeoutMs = 500): string {
  const expression = input.match(/^\s*=\{\{\s*([\s\S]+?)\s*\}\}\s*$/);
  if (expression?.[1]) {
    return stringifyValue(evaluateExpression(expression[1], scope, timeoutMs));
  }
  return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) =>
    stringifyValue(resolvePath(path.trim(), scope)),
  );
}

export function interpolateValue(input: string, scope: ExpressionScope, timeoutMs = 500): unknown {
  const single = input.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (single?.[1] && !input.includes('={{')) return resolvePath(single[1].trim(), scope);
  return interpolateString(input, scope, timeoutMs);
}

export function interpolateDeep(value: unknown, scope: ExpressionScope, timeoutMs = 500): unknown {
  if (typeof value === 'string') return interpolateString(value, scope, timeoutMs);
  if (Array.isArray(value)) return value.map((entry) => interpolateDeep(entry, scope, timeoutMs));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = interpolateDeep(entry, scope, timeoutMs);
    }
    return output;
  }
  return value;
}
