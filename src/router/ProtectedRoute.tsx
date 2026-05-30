import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/features/auth/api';
import type { ReactNode } from 'react';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();

  // 仅凭本地 token 存在 + 未过期还不够：账号可能已被禁用 / 会话已失效。
  // 进入受保护区域时向服务端探活一次——me() 命中网关 AuthorizeFilter + AccountStatusFilter，
  // 账号被禁用会返回 401，由 httpClient 拦截器统一 logout 并跳转 /login。
  // 用 react-query 缓存（staleTime 60s），避免每次路由切换都打一次。
  const { isLoading, isError } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: !!token,
    retry: false,
    staleTime: 60_000,
  });

  if (!token) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  // 首次探活（冷缓存）期间不渲染受保护内容，避免被禁用成员短暂看到页面。
  if (isLoading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  // 探活失败：拦截器已在 401 时 logout + window.location 跳转，这里兜底再 Navigate 一次。
  if (isError) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  return <>{children}</>;
}
