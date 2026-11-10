import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/shell';
import { useAuth } from '@/lib/auth';
import { LoginPage, RegisterPage } from '@/pages/auth-pages';
import { CredentialsPage } from '@/pages/credentials';
import { EditorPage } from '@/pages/editor';
import { ExecutionPage, ExecutionsPage } from '@/pages/executions';
import { TemplatesPage } from '@/pages/templates';
import { WorkflowsPage } from '@/pages/workflows';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-mist">
        Opening FlowPilot…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        }
      >
        <Route path="/workflows/:id" element={<EditorPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/workflows" replace />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/executions" element={<ExecutionsPage />} />
          <Route path="/executions/:id" element={<ExecutionPage />} />
          <Route path="/credentials" element={<CredentialsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/workflows" replace />} />
    </Routes>
  );
}
