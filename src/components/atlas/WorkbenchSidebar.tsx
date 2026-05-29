import { Dropdown } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ChevDownIcon, CogIcon, LogoutIcon } from '@/components/icons/AtlasIcons';
import { WORKBENCH_NAV, DEBUG_NAV, type NavItem } from '@/components/atlas/workbenchNav';

export default function WorkbenchSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, tenantId, logout } = useAuthStore();

  // /chat 与 /chat/:agentId 都应高亮「对话」；其余按前缀匹配。
  const isActive = (path: string) => {
    if (path === '/chat') return location.pathname === '/chat' || location.pathname.startsWith('/chat/');
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
      {items.map((item) => {
        const { Icon } = item;
        return (
          <button
            key={item.key}
            type="button"
            className={'atlas-nav-item' + (isActive(item.path) ? ' active' : '')}
            onClick={() => navigate(item.path)}
          >
            <Icon className="icon" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <aside className="atlas-sidebar">
      <div className="atlas-sidebar-brand">
        <div className="glyph">A</div>
        <span>Atlas</span>
        <span className="ver">v0.1</span>
      </div>

      <button className="atlas-sidebar-workspace" type="button">
        <div className="ws-glyph">智</div>
        <div className="ws-meta">
          <div className="ws-name">{workspaceName}</div>
          <div className="ws-plan">Enterprise</div>
        </div>
        <ChevDownIcon size={14} style={{ color: 'var(--sidebar-icon)' }} />
      </button>

      <div className="atlas-sidebar-section">工作台</div>
      {renderNav(WORKBENCH_NAV)}

      <div className="atlas-sidebar-section">调试与观测</div>
      {renderNav(DEBUG_NAV)}

      <div style={{ marginTop: 'auto' }}>
        <nav className="atlas-nav" style={{ padding: '4px 8px 8px' }}>
          <button type="button" className="atlas-nav-item">
            <CogIcon className="icon" />
            <span>设置 / API Keys</span>
          </button>
        </nav>
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
