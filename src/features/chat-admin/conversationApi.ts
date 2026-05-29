import { del, get, post, put } from '@/api/client';
import type { ChatCitation } from '@/api/types';

/**
 * 对话会话 / 消息持久化接口（落库到 data-service 的 chat_conversation / chat_message）。
 * 数据按租户隔离，由后端多租户拦截器保证。
 */

export interface ConversationView {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  lastMessageAt: string | null;
  createTime: string | null;
  messageCount: number | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[] | null;
  createTime: string | null;
}

export interface ConversationDetail {
  conversation: ConversationView;
  messages: MessageView[];
}

export interface AppendMessagePayload {
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
}

export const conversationApi = {
  list: () => get<ConversationView[]>('/admin/chat/conversations'),
  create: (payload: { agentId: string; agentName?: string; title?: string }) =>
    post<ConversationView>('/admin/chat/conversations', payload),
  detail: (id: string) => get<ConversationDetail>(`/admin/chat/conversations/${id}`),
  rename: (id: string, title: string) =>
    put<ConversationView>(`/admin/chat/conversations/${id}`, { title }),
  remove: (id: string) => del<void>(`/admin/chat/conversations/${id}`),
  appendMessage: (id: string, payload: AppendMessagePayload) =>
    post<MessageView>(`/admin/chat/conversations/${id}/messages`, payload),
};
