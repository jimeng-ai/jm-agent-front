import { lazy } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
} from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import ModuleRoute from './ModuleRoute';
import SuperAdminRoute from './SuperAdminRoute';
import RouteBoundary from './RouteBoundary';
import RouteErrorPage from './RouteErrorPage';
import ConsoleLayout from '@/layouts/ConsoleLayout';
import ChatLayout from '@/layouts/ChatLayout';

const LoginPage = lazy(() => import('@/pages/login/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/console/DashboardPage'));
const AgentListPage = lazy(() => import('@/pages/console/agent/AgentListPage'));
const AgentEditorPage = lazy(() => import('@/pages/console/agent/AgentEditorPage'));
const AgentBuilderWizardPage = lazy(() => import('@/pages/console/agent/AgentBuilderWizardPage'));
const KnowledgeListPage = lazy(() => import('@/pages/console/knowledge/KnowledgeListPage'));
const KnowledgeDetailPage = lazy(() => import('@/pages/console/knowledge/KnowledgeDetailPage'));
const PlaygroundPage = lazy(() => import('@/pages/console/playground/PlaygroundPage'));
const TraceListPage = lazy(() => import('@/pages/console/trace/TraceListPage'));
const FeedbackPage = lazy(() => import('@/pages/console/feedback/FeedbackPage'));
const SkillListPage = lazy(() => import('@/pages/console/skill/SkillListPage'));
const SkillBuilderPage = lazy(() => import('@/pages/console/skill/SkillBuilderPage'));
const ConnectorListPage = lazy(() => import('@/pages/console/connector/ConnectorListPage'));
const DataGraphPage = lazy(() => import('@/pages/console/data-graph/DataGraphPage'));
const SemanticWorkbenchPage = lazy(
  () => import('@/pages/console/connector/SemanticWorkbenchPage'),
);
const PendingWritePage = lazy(() => import('@/pages/console/connector/PendingWritePage'));
const ChatHomePage = lazy(() => import('@/pages/chat/ChatHomePage'));
const ChatConversationPage = lazy(() => import('@/pages/chat/ConversationPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export const appRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RouteBoundary />} errorElement={<RouteErrorPage />}>
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
        <Route
          path="agents"
          element={
            <ModuleRoute module="AGENT_MODULE">
              <AgentListPage />
            </ModuleRoute>
          }
        />
        <Route
          path="agents/new"
          element={
            <ModuleRoute module="AGENT_MODULE">
              <AgentBuilderWizardPage />
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
        <Route path="traces" element={<TraceListPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="skills" element={<SkillListPage />} />
        <Route path="skill/builder" element={<SkillBuilderPage />} />
        <Route
          path="connectors"
          element={
            <SuperAdminRoute>
              <ConnectorListPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path="connectors/:id/semantic"
          element={
            <SuperAdminRoute>
              <SemanticWorkbenchPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path="connectors/:id/graph"
          element={
            <SuperAdminRoute>
              <DataGraphPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path="pending-writes"
          element={
            <SuperAdminRoute>
              <PendingWritePage />
            </SuperAdminRoute>
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
    </Route>,
  ),
);
