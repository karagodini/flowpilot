import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { User } from './types';

interface AuthValue {
  user: User | null;
  ready: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/api/auth/me'),
    enabled: Boolean(getToken()),
    retry: false,
  });

  const value = useMemo<AuthValue>(
    () => ({
      user: session.data?.user ?? null,
      ready: !getToken() || session.isSuccess || session.isError,
      login: (token, user) => {
        setToken(token);
        queryClient.setQueryData(['me'], { user });
      },
      logout: () => {
        setToken(null);
        queryClient.clear();
      },
    }),
    [queryClient, session.data, session.isError, session.isSuccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing.');
  return value;
}
