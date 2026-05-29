import { Outlet } from 'react-router-dom';
import WorkbenchSidebar from '@/components/atlas/WorkbenchSidebar';
import ConversationsPanel from '@/features/chat-admin/components/ConversationsPanel';

export default function ChatLayout() {
  return (
    <div className="chat-app">
      <WorkbenchSidebar />
      <ConversationsPanel />
      <main className="chat-main">
        <Outlet />
      </main>
    </div>
  );
}
