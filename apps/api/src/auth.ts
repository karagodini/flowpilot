import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';
import type { AppRequest, AuthUser } from './types.js';

const DUMMY_HASH = bcrypt.hashSync('flowpilot-invalid-login', 10);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function verifyMissingPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}

export function signToken(user: AuthUser, secret: string): string {
  return jwt.sign({ sub: user.id, email: user.email }, secret, { expiresIn: '12h' });
}

export async function requireUser(request: AppRequest): Promise<AuthUser> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required.');
  try {
    const payload = jwt.verify(header.slice(7), request.server.config.jwtSecret) as {
      sub?: string;
    };
    if (!payload.sub) throw new Error('missing subject');
    const user = await request.server.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new Error('missing user');
    request.user = { id: user.id, email: user.email, name: user.name };
    return request.user;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Authentication required.');
  }
}
