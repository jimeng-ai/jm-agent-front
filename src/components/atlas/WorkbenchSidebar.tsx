import { Dropdown, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/features/auth/api';
import { ChevDownIcon, LogoutIcon } from '@/components/icons/AtlasIcons';
import { WORKBENCH_NAV, DEBUG_NAV, type NavItem } from '@/components/atlas/workbenchNav';

export default function WorkbenchSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, tenantId, token, logout } = useAuthStore();

  // 拉取当前账号权限，用于按模块过滤左侧导航。超管 / 数据未到达时默认全显示。
  const { data: perm } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    enabled: !!token,
    staleTime: 60_000,
  });
  const canSee = (item: NavItem) => {
    if (!perm || perm.superAdmin) return true;
    if (!item.module) return true;
    return perm.modules.includes(item.module);
  };

  // /chat 与 /chat/:agentId 都应高亮「对话」；其余按前缀匹配。
  const isActive = (path: string) => {
    if (path === '/chat')
      return location.pathname === '/chat' || location.pathname.startsWith('/chat/');
    return location.pathname.startsWith(path);
  };

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const userName = user?.displayName || user?.username || '管理员';
  const initials = userName.slice(0, 1);
  const workspaceName = tenantId ? `租户 · ${tenantId}` : 'JM Agent';

  const renderNav = (items: NavItem[]) => (
    <nav className="atlas-nav">
      {items.filter(canSee).map((item) => {
        const { Icon } = item;
        return (
          <Tooltip key={item.key} title={collapsed ? item.label : ''} placement="right">
            <button
              type="button"
              className={'atlas-nav-item' + (isActive(item.path) ? ' active' : '')}
              onClick={() => navigate(item.path)}
            >
              <Icon className="icon" />
              <span>{item.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );

  return (
    <aside className={'atlas-sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="atlas-sidebar-brand">
        <div className="glyph">A</div>
        <span>Atlas</span>
      </div>

      <Tooltip title={collapsed ? workspaceName : ''} placement="right">
        <button className="atlas-sidebar-workspace" type="button">
          <div className="ws-glyph">智</div>
          <div className="ws-meta">
            <div className="ws-name">{workspaceName}</div>
            <div className="ws-plan">Enterprise</div>
          </div>
        </button>
      </Tooltip>

      <div className="atlas-sidebar-section">工作台</div>
      {renderNav(WORKBENCH_NAV)}

      {DEBUG_NAV.some(canSee) && (
        <>
          <div className="atlas-sidebar-section">调试与观测</div>
          {renderNav(DEBUG_NAV)}
        </>
      )}

      <div style={{ marginTop: 'auto' }}>
        <Dropdown
          menu={{
            items: [
              {
                key: 'logout',
                icon: <LogoutIcon size={14} />,
                label: '退出登录',
                onClick: onLogout,
              },
            ],
          }}
          placement="topRight"
          trigger={['click']}
        >
          <div className="atlas-sidebar-foot">
            <div className="atlas-avatar">{initials}</div>
            <div className="who">
              <div className="name">{userName}</div>
              <div className="role">{user?.status ?? 'Member'}</div>
            </div>
            <ChevDownIcon size={12} style={{ color: 'var(--sidebar-icon)' }} />
          </div>
        </Dropdown>
      </div>
    </aside>
  );
}
