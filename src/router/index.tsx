import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import ProtectedRoute from './ProtectedRoute';
import ConsoleLayout from '@/layouts/ConsoleLayout';
import ChatLayout from '@/layouts/ChatLayout';

const LoginPage = lazy(() => import('@/pages/login/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/console/DashboardPage'));
const AgentListPage = lazy(() => import('@/pages/console/agent/AgentListPage'));
const AgentEditorPage = lazy(() => import('@/pages/console/agent/AgentEditorPage'));
const PluginListPage = lazy(() => import('@/pages/console/plugin/PluginListPage'));
const PluginEditorPage = lazy(() => import('@/pages/console/plugin/PluginEditorPage'));
const KnowledgeListPage = lazy(() => import('@/pages/console/knowledge/KnowledgeListPage'));
const KnowledgeDetailPage = lazy(() => import('@/pages/console/knowledge/KnowledgeDetailPage'));
const PlaygroundPage = lazy(() => import('@/pages/console/playground/PlaygroundPage'));
const ChatConversationPage = lazy(() => import('@/pages/chat/ConversationPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

function Loading() {
  return (
    <div className="app-loading">
      <Spin />
    </div>
  );
}

export default function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/console"
          element={
            <ProtectedRoute>
              <ConsoleLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="agents" element={<AgentListPage />} />
          <Route path="agents/:id" element={<AgentEditorPage />} />
          <Route path="plugins" element={<PluginListPage />} />
          <Route path="plugins/:id" element={<PluginEditorPage />} />
          <Route path="knowledge" element={<KnowledgeListPage />} />
          <Route path="knowledge/:kbId" element={<KnowledgeDetailPage />} />
          <Route path="playground/:agentId?" element={<PlaygroundPage />} />
        </Route>

        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        >
          <Route path=":agentId" element={<ChatConversationPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/console" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
