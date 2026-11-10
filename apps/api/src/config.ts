import { encryptionKey } from '@flowpilot/db';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(64),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  EXECUTION_MODE: z.enum(['queue', 'inline']).default('queue'),
  ALLOW_SIGNUP: z.enum(['true', 'false']).default('true'),
  LOG_LEVEL: z.string().default('info'),
});

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  encryptionKey: string;
  webOrigin: string;
  executionMode: 'queue' | 'inline';
  allowSignup: boolean;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.') || issue.message)
      .join(', ');
    throw new Error(`Missing or invalid environment: ${fields}`);
  }
  encryptionKey(parsed.data.ENCRYPTION_KEY);
  return {
    env: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    jwtSecret: parsed.data.JWT_SECRET,
    encryptionKey: parsed.data.ENCRYPTION_KEY,
    webOrigin: parsed.data.WEB_ORIGIN,
    executionMode: parsed.data.EXECUTION_MODE,
    allowSignup: parsed.data.ALLOW_SIGNUP !== 'false',
    logLevel: parsed.data.LOG_LEVEL,
  };
}
