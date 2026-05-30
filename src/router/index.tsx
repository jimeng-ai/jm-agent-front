import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import ProtectedRoute from './ProtectedRoute';
import ModuleRoute from './ModuleRoute';
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
const ChatHomePage = lazy(() => import('@/pages/chat/ChatHomePage'));
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
          {/* 仪表盘不受模块限制 */}
          <Route path="dashboard" element={<DashboardPage />} />
          <Route
            path="agents"
            element={
              <ModuleRoute module="AGENT_MODULE">
                <AgentListPage />
              </ModuleRoute>
            }
          />
          <Route
            path="agents/:id"
            element={
              <ModuleRoute module="AGENT_MODULE">
                <AgentEditorPage />
              </ModuleRoute>
            }
          />
          <Route
            path="plugins"
            element={
              <ModuleRoute module="PLUGIN_MODULE">
                <PluginListPage />
              </ModuleRoute>
            }
          />
          <Route
            path="plugins/:id"
            element={
              <ModuleRoute module="PLUGIN_MODULE">
                <PluginEditorPage />
              </ModuleRoute>
            }
          />
          <Route
            path="knowledge"
            element={
              <ModuleRoute module="KB_MODULE">
                <KnowledgeListPage />
              </ModuleRoute>
            }
          />
          <Route
            path="knowledge/:kbId"
            element={
              <ModuleRoute module="KB_MODULE">
                <KnowledgeDetailPage />
              </ModuleRoute>
            }
          />
          <Route
            path="playground/:agentId?"
            element={
              <ModuleRoute module="AGENT_MODULE">
                <PlaygroundPage />
              </ModuleRoute>
            }
          />
        </Route>

        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ModuleRoute module="CHAT_MODULE">
                <ChatLayout />
              </ModuleRoute>
            </ProtectedRoute>
          }
        >
          <Route index element={<ChatHomePage />} />
          <Route path="agent/:agentId" element={<ChatConversationPage />} />
          <Route path="c/:conversationId" element={<ChatConversationPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/console" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
