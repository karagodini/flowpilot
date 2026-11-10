import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });
process.env.EXECUTION_MODE = 'inline';
process.env.ALLOW_SIGNUP = 'true';
process.env.LOG_LEVEL = 'silent';

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'] as const) {
  if (!process.env[key]) {
    throw new Error(`Set ${key} before running the API tests.`);
  }
}
