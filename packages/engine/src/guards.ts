import { URL } from 'node:url';

export function assertWriteSql(sql: string): string {
  const withoutTrailing = sql.trim().replace(/;+\s*$/, '');
  const compact = withoutTrailing.replace(/\s+/g, ' ').trim();
  if (!compact) throw new Error('Add an INSERT or UPDATE statement.');
  if (compact.includes(';')) throw new Error('Only a single SQL statement is allowed.');
  if (!/^(insert|update)\b/i.test(compact)) {
    throw new Error('Only INSERT and UPDATE statements are allowed.');
  }
  return compact;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === 'metadata.google.com'
  ) {
    throw new Error('Requests to link-local metadata addresses are blocked.');
  }
  return url;
}

export function clampLoggedItems<T>(items: T[], limit = 400_000): T[] {
  const raw = JSON.stringify(items);
  if (raw.length <= limit) return items;
  return [
    {
      json: {
        truncated: true,
        reason: 'Output exceeded the stored size limit.',
        preview: raw.slice(0, 4_000),
      },
    },
  ] as T[];
}
