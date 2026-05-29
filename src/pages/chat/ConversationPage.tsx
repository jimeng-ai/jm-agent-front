import { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Empty, Spin, Typography, message } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import ChatPanel from '@/features/chat-admin/components/ChatPanel';
import { conversationApi, type MessageView } from '@/features/chat-admin/conversationApi';
import type { ChatMessage } from '@/features/chat-admin/types';
import type { ChatCitation } from '@/api/types';

function toChatMessage(m: MessageView): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations ?? undefined,
    status: 'done',
    createdAt: m.createTime ? new Date(m.createTime).getTime() : Date.now(),
  };
}

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.conversationId ?? null;
  const routeAgentId = params.agentId ?? null;
  const queryClient = useQueryClient();

  // 已有会话：拉取详情（含消息）。新会话：仅有 agentId。
  const detailQ = useQuery({
    queryKey: ['chat', 'conversation', conversationId],
    queryFn: () => conversationApi.detail(conversationId as string),
    enabled: !!conversationId,
  });

  const agentId = conversationId ? detailQ.data?.conversation.agentId : routeAgentId;

  const agentQ = useQuery({
    queryKey: ['agent', 'detail', agentId],
    queryFn: () => agentApi.detail(agentId as string),
    enabled: !!agentId,
  });

  // 持久化所需的会话 id：已有会话直接用 URL；新会话首条消息时懒创建。
  const convIdRef = useRef<string | null>(conversationId);
  const createPromiseRef = useRef<Promise<string> | null>(null);

  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });

  const ensureConversation = (firstText: string): Promise<string> => {
    if (convIdRef.current) return Promise.resolve(convIdRef.current);
    if (!createPromiseRef.current) {
      createPromiseRef.current = conversationApi
        .create({
          agentId: agentId as string,
          agentName: agentQ.data?.name,
          title: firstText,
        })
        .then((c) => {
          convIdRef.current = c.id;
          refreshList();
          return c.id;
        });
    }
    return createPromiseRef.current;
  };

  const handleUserMessage = async (text: string) => {
    if (!agentId) return;
    try {
      const id = await ensureConversation(text);
      await conversationApi.appendMessage(id, { role: 'user', content: text });
      refreshList();
    } catch (e) {
      message.error('消息未能保存：' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const handleAssistantMessage = async (text: string, citations?: ChatCitation[]) => {
    try {
      const id = convIdRef.current ?? (await ensureConversation(text));
      await conversationApi.appendMessage(id, { role: 'assistant', content: text, citations });
      refreshList();
    } catch {
      /* 助手消息保存失败不打断对话；用户消息已落库 */
    }
  };

  const loading = (!!conversationId && detailQ.isLoading) || (!!agentId && agentQ.isLoading);
  if (loading) {
    return (
      <div className="chat-home-loading">
        <Spin />
      </div>
    );
  }

  if (conversationId && detailQ.isError) {
    return <Empty description="未找到该会话" style={{ marginTop: 120 }} />;
  }
  if (!agentId || !agentQ.data) {
    return <Empty description="未找到该 Agent" style={{ marginTop: 120 }} />;
  }

  const agent = agentQ.data;
  const initialMessages = (detailQ.data?.messages ?? []).map(toChatMessage);
  // 切换会话时重建 ChatPanel，确保初始消息正确加载；新会话用 agentId 作为稳定 key。
  const panelKey = conversationId ? `c-${conversationId}` : `agent-${agentId}`;

  return (
    <div className="chat-conversation">
      <div className="chat-conversation-head">
        <Avatar
          src={agent.avatar}
          icon={!agent.avatar && <RobotOutlined />}
          style={{ marginRight: 12 }}
        />
        <div>
          <Typography.Text strong>{agent.name}</Typography.Text>
          {agent.description && (
            <div style={{ fontSize: 12, color: '#999' }}>{agent.description}</div>
          )}
        </div>
      </div>
      <div className="chat-conversation-body">
        <ChatPanel
          key={panelKey}
          agentId={agentId}
          simple
          initialMessages={initialMessages}
          onSubmit={handleUserMessage}
          onAssistantMessage={handleAssistantMessage}
          placeholder={`你好，我是 ${agent.name}。有什么可以帮你？`}
        />
      </div>
    </div>
  );
}
