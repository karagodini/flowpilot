import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mark } from '@/components/shell';
import { Button, Input, Label } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

export function LoginPage() {
  return (
    <AuthScreen
      title="Sign in"
      subtitle="Pick up the workflows already running for your team."
      alternate={{ href: '/register', label: 'Create an account' }}
      submitLabel="Sign in"
      endpoint="/api/auth/login"
    />
  );
}

export function RegisterPage() {
  return (
    <AuthScreen
      title="Create your account"
      subtitle="The account owns the workflows, versions, and vault on this instance."
      alternate={{ href: '/login', label: 'I already have an account' }}
      submitLabel="Create account"
      endpoint="/api/auth/register"
      askName
    />
  );
}

function AuthScreen({
  title,
  subtitle,
  alternate,
  submitLabel,
  endpoint,
  askName = false,
}: {
  title: string;
  subtitle: string;
  alternate: { href: string; label: string };
  submitLabel: string;
  endpoint: string;
  askName?: boolean;
}) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await api<{ token: string; user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          name: form.get('name') || undefined,
        }),
      });
      login(result.token, result.user);
      navigate('/workflows');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden border-r border-line bg-ink-900 lg:block">
        <div className="absolute inset-0 canvas-grid opacity-60" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <Mark className="h-9 w-9" />
            <span className="font-serif text-2xl text-white">FlowPilot</span>
          </div>
          <div className="max-w-xl">
            <p className="text-xs uppercase tracking-[0.22em] text-mint-300">
              Operations, kept in view
            </p>
            <h1 className="mt-4 font-serif text-6xl leading-[1.05] tracking-tight text-white">
              The work between a form and a finished task.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-mist">
              Build the path from a webhook, a schedule, a Telegram message, or a new sheet row.
              Inspect every input and output after it runs.
            </p>
          </div>
          <p className="text-sm text-mist">
            Harbor & Lane runs lead review, the morning digest, and the on-call desk here.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <Mark className="h-8 w-8" />
            <span className="font-serif text-2xl">FlowPilot</span>
          </div>
          <h2 className="font-serif text-4xl text-white">{title}</h2>
          <p className="text-sm leading-6 text-mist">{subtitle}</p>
          {askName ? (
            <div>
              <Label>Name</Label>
              <Input name="name" required autoComplete="name" />
            </div>
          ) : null}
          <div>
            <Label>Email</Label>
            <Input name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              name="password"
              type="password"
              required
              minLength={askName ? 10 : 1}
              autoComplete={askName ? 'new-password' : 'current-password'}
            />
          </div>
          {error ? <p className="text-sm text-rose-200">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Working…' : submitLabel}
          </Button>
          <Link to={alternate.href} className="block text-sm text-mint-300 hover:text-mint-200">
            {alternate.label}
          </Link>
        </form>
      </section>
    </div>
  );
}
