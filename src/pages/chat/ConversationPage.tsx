import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Empty, Spin, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import ChatPanel from '@/features/chat-admin/components/ChatPanel';
import { conversationApi, type MessageView } from '@/features/chat-admin/conversationApi';
import { useActiveConversationStore } from '@/features/chat-admin/unreadStore';
import type { ChatMessage, ChatStatus } from '@/features/chat-admin/types';
import { glyphColor } from '@/utils/glyph';

/** 助手消息生成状态 → 前端渲染态。COMPLETED/CANCELLED 都按已完成渲染（取消会展示已生成的部分）。 */
function statusOf(m: MessageView): ChatStatus {
  if (m.role !== 'assistant') return 'done';
  if (m.status === 'GENERATING') return 'streaming';
  if (m.status === 'FAILED') return 'error';
  return 'done';
}

function toChatMessage(m: MessageView): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations ?? undefined,
    // 含工具调用的历史消息：还原「叙述 → 工具 → 答案」交错过程
    segments: m.segments ?? undefined,
    // 用户消息附件：刷新/历史会话据 fileId 还原缩略图与预览（url 为空时按 fileId 取流）
    attachments: m.attachments ?? undefined,
    // 后端 Long 经全局 JacksonConfig 序列化为字符串，这里转回 number 以符合 ChatMessage 契约
    elapsedMs: m.elapsedMs == null ? undefined : Number(m.elapsedMs),
    status: statusOf(m),
    errorMessage: m.error ?? undefined,
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

  // 把「当前正在看的会话 id」同步给全局 store，侧栏据此判定已读、不弹红点。
  // 已有会话用 URL 的 conversationId；新会话懒创建后由 ensureConversation 补写真实 id。
  const setActiveConversationId = useActiveConversationStore((s) => s.setActiveId);
  useEffect(() => {
    setActiveConversationId(conversationId);
    return () => setActiveConversationId(null);
  }, [conversationId, setActiveConversationId]);

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });

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
          // 新会话 URL 不会变成 /chat/c/:id，这里把真实 id 写进 store，否则侧栏仍把它当未读。
          setActiveConversationId(c.id);
          refreshList();
          return c.id;
        });
    }
    return createPromiseRef.current;
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
  const rawMessages = detailQ.data?.messages ?? [];
  const initialMessages = rawMessages.map(toChatMessage);
  // 进入会话时若最后一条助手消息仍在生成 → 把它的 runId 交给 ChatPanel 重连续播。
  const lastAssistant = [...rawMessages].reverse().find((m) => m.role === 'assistant');
  const resumeRunId = lastAssistant?.status === 'GENERATING' ? (lastAssistant.runId ?? null) : null;
  // 切换会话时重建 ChatPanel，确保初始消息正确加载；新会话用 agentId 作为稳定 key。
  const panelKey = conversationId ? `c-${conversationId}` : `agent-${agentId}`;

  return (
    <div className="chat-conversation">
      <div className="chat-conversation-head">
        <Avatar
          src={agent.avatarUrl || undefined}
          style={{
            marginRight: 12,
            ...(agent.avatarUrl
              ? {}
              : { background: glyphColor(agent.name).bg, color: glyphColor(agent.name).fg }),
          }}
        >
          {!agent.avatarUrl && agent.name?.slice(0, 1)}
        </Avatar>
        <div>
          <Typography.Text strong>{agent.name}</Typography.Text>
          {agent.model && <div className="chat-conversation-model">{agent.model}</div>}
        </div>
      </div>
      <div className="chat-conversation-body">
        <ChatPanel
          key={panelKey}
          agentId={agentId}
          simple
          agentName={agent.name}
          agentDescription={agent.description}
          agentAvatar={agent.avatarUrl}
          presetQuestions={agent.presetQuestions}
          initialMessages={initialMessages}
          onEnsureConversation={ensureConversation}
          resumeRunId={resumeRunId}
          onTurnChange={refreshList}
          placeholder={`你好，我是 ${agent.name}。有什么可以帮你？`}
        />
      </div>
    </div>
  );
}
