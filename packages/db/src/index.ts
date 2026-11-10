import { PrismaClient } from '@prisma/client';

export { PrismaClient };
export type { Prisma } from '@prisma/client';
export { decryptJson, encryptJson, encryptionKey } from './crypto.js';

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
