import type { Prisma } from '@flowpilot/db';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors.js';

export async function hookRoutes(app: FastifyInstance): Promise<void> {
  app.all('/api/hooks/:path', async (request, reply) => {
    const { path } = request.params as { path: string };
    const hook = await app.prisma.webhook.findUnique({
      where: { path: path.toLowerCase() },
      include: { workflow: { include: { currentVersion: true } } },
    });
    if (!hook || !hook.workflow.active || !hook.workflow.currentVersion) {
      throw new HttpError(404, 'No active workflow is listening on this path.');
    }
    if (hook.method !== 'ANY' && hook.method !== request.method) {
      throw new HttpError(405, `This listener accepts ${hook.method}.`);
    }
    const body = request.body;
    const input =
      hook.kind === 'telegram'
        ? telegramItems(body)
        : httpItems(request.method, hook.path, request.query, request.headers, body);
    const execution = await app.prisma.execution.create({
      data: {
        workflowId: hook.workflowId,
        versionId: hook.workflow.currentVersion.id,
        status: 'queued',
        trigger: hook.kind === 'telegram' ? 'telegram' : 'webhook',
        mode: 'standard',
        input: input as unknown as Prisma.InputJsonValue,
      },
    });
    await app.queue.enqueue(execution.id);
    return reply.code(202).send({ executionId: execution.id });
  });
}

function httpItems(
  method: string,
  path: string,
  query: unknown,
  headers: Record<string, unknown>,
  body: unknown,
) {
  const safeHeaders: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'cookie') continue;
    safeHeaders[key] = value;
  }
  return [
    {
      json: {
        method,
        path,
        query: query ?? {},
        headers: safeHeaders,
        body: body ?? null,
        receivedAt: new Date().toISOString(),
      },
    },
  ];
}

function telegramItems(body: unknown) {
  const update = (body ?? {}) as {
    update_id?: number;
    message?: {
      message_id?: number;
      text?: string;
      chat?: { id?: number };
      from?: { username?: string; first_name?: string };
    };
    edited_message?: {
      message_id?: number;
      text?: string;
      chat?: { id?: number };
      from?: { username?: string; first_name?: string };
    };
  };
  const message = update.message ?? update.edited_message;
  return [
    {
      json: {
        updateId: update.update_id ?? null,
        messageId: message?.message_id ?? null,
        chatId: message?.chat?.id != null ? String(message.chat.id) : '',
        text: message?.text ?? '',
        from: message?.from?.username || message?.from?.first_name || '',
        receivedAt: new Date().toISOString(),
      },
    },
  ];
}
