import { del, get, post, put } from '@/api/client';
import type { ChatCitation } from '@/api/types';
import type { ChatAttachment, MessageSegment } from '@/features/chat-admin/types';

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
  /** 有序片段（含工具调用过程），可空 */
  segments?: MessageSegment[] | null;
  /** 用户消息附件（fileId/filename/contentType），可空 */
  attachments?: ChatAttachment[] | null;
  /** 助手生成总耗时（毫秒），可空。后端 Long 经全局 JacksonConfig 序列化为字符串，故含 string */
  elapsedMs?: number | string | null;
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
  /** 有序片段（含工具调用过程）；仅含工具调用的助手消息才需要传 */
  segments?: MessageSegment[];
  /** 用户消息附件（fileId/filename/contentType），刷新/历史会话据此还原缩略图与预览 */
  attachments?: ChatAttachment[];
  /** 助手生成总耗时（毫秒） */
  elapsedMs?: number;
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
