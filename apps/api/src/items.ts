import type { Item, JsonObject } from '@flowpilot/shared';

export function normalizeItems(payload: unknown): Item[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload.map((entry) => coerceItem(entry));
  return [coerceItem(payload)];
}

function coerceItem(entry: unknown): Item {
  if (entry && typeof entry === 'object' && 'json' in entry) {
    const json = (entry as { json?: unknown }).json;
    if (json && typeof json === 'object' && !Array.isArray(json))
      return { json: json as JsonObject };
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry))
    return { json: entry as JsonObject };
  return { json: { value: entry as never } };
}
