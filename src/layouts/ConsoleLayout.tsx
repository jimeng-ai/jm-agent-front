import { Outlet, useLocation } from 'react-router-dom';
import WorkbenchSidebar from '@/components/atlas/WorkbenchSidebar';
import { workbenchCrumbs } from '@/components/atlas/workbenchNav';
import { SearchIcon, BellIcon } from '@/components/icons/AtlasIcons';

export default function ConsoleLayout() {
  const location = useLocation();
  const crumbs = workbenchCrumbs(location.pathname);

  return (
    <div className="atlas-app">
      <WorkbenchSidebar />

      <div className="atlas-main">
        <header className="atlas-topbar">
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
          <div className="atlas-search">
            <SearchIcon size={14} />
            <span>搜索 Agent、文档、Trace…</span>
            <span className="kbd">⌘K</span>
          </div>
          <button type="button" className="atlas-icon-btn" title="通知">
            <BellIcon size={16} />
            <span className="dot" />
          </button>
        </header>

        <main className="atlas-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
