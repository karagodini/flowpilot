const TOKEN_KEY = 'flowpilot.token';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    setToken(null);
    if (
      !window.location.pathname.startsWith('/login') &&
      !window.location.pathname.startsWith('/register')
    ) {
      window.location.assign('/login');
    }
  }
  if (!response.ok)
    throw new ApiError(data.error || 'The request did not succeed.', response.status);
  return data as T;
}
