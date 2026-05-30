import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Spin } from 'antd';
import WorkbenchSidebar from '@/components/atlas/WorkbenchSidebar';
import ConversationsPanel from '@/features/chat-admin/components/ConversationsPanel';

export default function ChatLayout() {
  return (
    <div className="chat-app">
      <WorkbenchSidebar />
      <ConversationsPanel />
      <main className="chat-main">
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Spin />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
