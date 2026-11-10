import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { KeyRound, LayoutTemplate, LogOut, PlayCircle, Workflow } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const links = [
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/executions', label: 'Executions', icon: PlayCircle },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
];

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#102033" />
      <path
        d="M7 18.5c2.4-5 5.4-7.4 8.6-7.4 2.6 0 4.4 1.4 6 3.4"
        fill="none"
        stroke="#5eead4"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M8.5 22.8c2.6-1.3 4.8-1.7 7-.9 2.2.7 3.8.1 6.5-1.6"
        fill="none"
        stroke="#93c5fd"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="23" cy="11" r="1.7" fill="#5eead4" />
    </svg>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-ink-950 md:flex-row">
      <aside className="flex items-center justify-between border-b border-line bg-ink-900 px-4 py-3 md:h-screen md:w-60 md:flex-col md:items-stretch md:justify-between md:border-b-0 md:border-r md:px-3 md:py-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/workflows')}
            className="flex items-center gap-2.5 px-2"
          >
            <Mark className="h-8 w-8" />
            <span className="font-serif text-xl tracking-tight text-white">FlowPilot</span>
          </button>
          <nav className="mt-4 flex gap-1 overflow-auto md:mt-8 md:flex-col">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-mist',
                    isActive && 'bg-white/10 text-white',
                  )
                }
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="hidden items-center justify-between gap-2 rounded-2xl border border-line px-3 py-2 md:flex">
          <div className="min-w-0">
            <div className="truncate text-sm text-white">{user?.name}</div>
            <div className="truncate text-[11px] text-mist">{user?.email}</div>
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 text-mist hover:bg-white/5 hover:text-white"
            aria-label="Sign out"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({
  title,
  lede,
  action,
  children,
}: {
  title: string;
  lede?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight text-white">{title}</h1>
          {lede ? <p className="mt-2 max-w-2xl text-sm leading-6 text-mist">{lede}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
