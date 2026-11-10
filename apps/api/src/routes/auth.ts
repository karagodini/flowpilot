import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  hashPassword,
  requireUser,
  signToken,
  verifyMissingPassword,
  verifyPassword,
} from '../auth.js';
import { HttpError } from '../errors.js';

const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .regex(/[A-Za-z]/, 'Include a letter.')
  .regex(/[0-9]/, 'Include a number.');

const registerSchema = z.object({
  email: z.string().email().max(160),
  name: z.string().trim().min(1).max(80),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      if (!app.config.allowSignup)
        throw new HttpError(403, 'Sign up is turned off on this instance.');
      const body = registerSchema.parse(request.body);
      const email = body.email.trim().toLowerCase();
      const existing = await app.prisma.user.findUnique({ where: { email } });
      if (existing) throw new HttpError(409, 'An account with that email already exists.');
      const user = await app.prisma.user.create({
        data: { email, name: body.name, passwordHash: await hashPassword(body.password) },
      });
      const authUser = { id: user.id, email: user.email, name: user.name };
      return { token: signToken(authUser, app.config.jwtSecret), user: authUser };
    },
  );

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const body = loginSchema.parse(request.body);
      const email = body.email.trim().toLowerCase();
      const user = await app.prisma.user.findUnique({ where: { email } });
      const valid = user
        ? await verifyPassword(body.password, user.passwordHash)
        : await verifyMissingPassword(body.password).then(() => false);
      if (!user || !valid) throw new HttpError(401, 'Email or password is incorrect.');
      const authUser = { id: user.id, email: user.email, name: user.name };
      return { token: signToken(authUser, app.config.jwtSecret), user: authUser };
    },
  );

  app.get('/api/auth/me', async (request) => {
    const user = await requireUser(request);
    return { user };
  });
}
