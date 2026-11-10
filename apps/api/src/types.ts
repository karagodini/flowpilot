import type { PrismaClient } from '@flowpilot/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { JobQueue } from './queue.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AppDeps {
  prisma: PrismaClient;
  config: AppConfig;
  queue: JobQueue;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    queue: JobQueue;
  }

  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export type AppRequest = FastifyRequest;
export type AppReply = FastifyReply;
