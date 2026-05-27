import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import type { ReactNode } from 'react';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <>{children}</>;
}
