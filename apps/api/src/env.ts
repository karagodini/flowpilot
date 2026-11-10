import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: resolve(here, '../../../.env') });
  loadEnv({ path: resolve(here, '../../.env') });
}
