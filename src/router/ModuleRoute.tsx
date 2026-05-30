import type { ReactNode } from 'react';
import { Button, Result, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/features/auth/api';

/**
 * 模块级直链拦截：成员直接敲 URL 进入未被授权的模块时挡在前端（后端仍会 403 数据，这里是纵深防御）。
 * 与 WorkbenchSidebar 共用 ['me','permissions'] 查询缓存，不会重复请求。
 * 权限拉取失败时放行（fail-open）——真正的权限由后端把关。
 */
export default function ModuleRoute({ module, children }: { module: string; children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const { data: perm, isLoading } = useQuery({
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

  const allowed = !perm || perm.superAdmin || perm.modules.includes(module);
  if (!allowed) {
    return (
      <Result
        status="403"
        title="无权访问"
        subTitle="你的角色未被授权使用该功能模块，请联系企业管理员。"
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
