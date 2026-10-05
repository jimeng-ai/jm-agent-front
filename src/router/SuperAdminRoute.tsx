import type { ReactNode } from 'react';
import { Button, Result, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/features/auth/api';
import { useAuthStore } from '@/stores/authStore';

/**
 * 超管治理面的直链门控。
 *
 * 权限接口失败时放行（fail-open），让后续数据请求由后端做真正的 403 校验；
 * 只有已经明确拿到「非超管」结论时才在前端拦住。
 */
export default function SuperAdminRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const { data: permission, isLoading } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    enabled: !!token,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="app-loading">
        <Spin />
      </div>
    );
  }

  if (permission && !permission.superAdmin) {
    return (
      <Result
        status="403"
        title="仅企业超管可访问"
        subTitle="数据连接与写操作审批属于企业级治理能力。"
        extra={
          <Button type="primary" onClick={() => navigate('/console/dashboard')}>
            返回工作台
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
}
