import { encryptJson } from '@flowpilot/db';
import { CREDENTIAL_TYPES, type CredentialType, type JsonObject } from '@flowpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, isUniqueViolation } from '../errors.js';

const dataSchemas: Record<CredentialType, z.ZodType<JsonObject>> = {
  telegram: z.object({ botToken: z.string().min(8) }),
  smtp: z.object({
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    secure: z.boolean().optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    from: z.string().min(3),
  }),
  postgres: z.object({ connectionString: z.string().min(8) }),
  openai: z.object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
  }),
  google_sheets: z.object({ apiKey: z.string().min(1) }),
  http: z.object({
    headerName: z.string().min(1).max(80),
    headerValue: z.string().min(1),
  }),
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(CREDENTIAL_TYPES),
  data: z.record(z.unknown()),
});

function previewFor(type: CredentialType, data: JsonObject): string {
  if (type === 'smtp') return `${String(data.from)} via ${String(data.host)}`;
  if (type === 'openai') return String(data.baseUrl || 'https://api.openai.com/v1');
  if (type === 'http') return String(data.headerName);
  if (type === 'telegram') return 'Bot token stored';
  if (type === 'postgres') return 'Connection string stored';
  return 'API key stored';
}

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/credentials', async (request) => {
    const user = await requireUser(request);
    const credentials = await app.prisma.credential.findMany({
      where: { ownerId: user.id },
      orderBy: { name: 'asc' },
    });
    return {
      credentials: credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        type: credential.type,
        preview: credential.preview,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      })),
    };
  });

  app.post('/api/credentials', async (request, reply) => {
    const user = await requireUser(request);
    const body = createSchema.parse(request.body);
    const parsed = dataSchemas[body.type].safeParse(body.data);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Check the credential fields.');
    }
    const sealed = encryptJson(parsed.data, app.config.encryptionKey);
    try {
      const credential = await app.prisma.credential.create({
        data: {
          ownerId: user.id,
          name: body.name,
          type: body.type,
          ...sealed,
          preview: previewFor(body.type, parsed.data),
        },
      });
      return reply.code(201).send({
        credential: {
          id: credential.id,
          name: credential.name,
          type: credential.type,
          preview: credential.preview,
          createdAt: credential.createdAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'A credential with that name already exists.');
      throw error;
    }
  });

  app.delete('/api/credentials/:id', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const result = await app.prisma.credential.deleteMany({ where: { id, ownerId: user.id } });
    if (result.count === 0) throw new HttpError(404, 'Credential not found.');
    return reply.code(204).send();
  });
}
