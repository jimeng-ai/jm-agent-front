import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Spin, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import WorkbenchSidebar from '@/components/atlas/WorkbenchSidebar';
import { workbenchCrumbs, TOPBAR_NAV } from '@/components/atlas/workbenchNav';
import { SearchIcon, BellIcon } from '@/components/icons/AtlasIcons';
import CommandPalette from '@/features/search/components/CommandPalette';

const COLLAPSE_KEY = 'atlas-sidebar-collapsed';

export default function ConsoleLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const crumbs = workbenchCrumbs(location.pathname);
  // 侧边栏显隐：偏好持久化到 localStorage，刷新后保持。
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [searchOpen, setSearchOpen] = useState(false);
  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  };

  // 全局快捷键 ⌘K / Ctrl+K 打开命令面板。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={'atlas-app' + (collapsed ? ' sidebar-collapsed' : '')}>
      <WorkbenchSidebar collapsed={collapsed} />

      <div className="atlas-main">
        <header className="atlas-topbar">
          <Tooltip title={collapsed ? '显示侧边栏' : '隐藏侧边栏'}>
            <button
              type="button"
              className="atlas-icon-btn"
              onClick={toggleSidebar}
              aria-label={collapsed ? '显示侧边栏' : '隐藏侧边栏'}
              style={{ marginRight: 4 }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </Tooltip>
          <div className="atlas-crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className={i === crumbs.length - 1 ? 'here' : ''}>
                {c}
                {i < crumbs.length - 1 ? (
                  <span className="sep" style={{ marginLeft: 6 }}>
                    /
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div className="spacer" />
          {TOPBAR_NAV.map((item) => {
            const { Icon } = item;
            const active = location.pathname.startsWith(item.path);
            return (
              <button
                key={item.key}
                type="button"
                className="atlas-icon-btn"
                onClick={() => navigate(item.path)}
                style={{
                  width: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  marginRight: 4,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--accent)' : undefined,
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button type="button" className="atlas-search" onClick={() => setSearchOpen(true)}>
            <SearchIcon size={14} />
            <span>搜索 Agent、文档、Trace…</span>
            <span className="kbd">⌘K</span>
          </button>
          <button type="button" className="atlas-icon-btn" title="通知">
            <BellIcon size={16} />
            <span className="dot" />
          </button>
        </header>

        <main className="atlas-content">
          <Suspense
            fallback={
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '60vh',
                }}
              >
                <Spin size="large" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
