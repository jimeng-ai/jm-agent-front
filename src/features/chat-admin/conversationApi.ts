import { del, get, post, put } from '@/api/client';
import type { ChatCitation, ChatMessageHistoryItem } from '@/api/types';
import type { ChatAttachment, MessageSegment } from '@/features/chat-admin/types';

/**
 * 对话会话 / 消息持久化接口（落库到 data-service 的 chat_conversation / chat_message）。
 * 数据按租户隔离，由后端多租户拦截器保证。
 */

/** 助手消息生成状态。 */
export type MessageStatus = 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ConversationView {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  lastMessageAt: string | null;
  createTime: string | null;
  messageCount: number | null;
  /** 该会话当前是否有正在生成的助手回复（驱动列表「正在回复」提示）。 */
  generating?: boolean;
  /** 当前在跑的生成 runId（generating=true 时有值）。 */
  activeRunId?: string | null;
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
  /** 生成状态：GENERATING 时可据 runId 重连续播 */
  status?: MessageStatus | null;
  runId?: string | null;
  error?: string | null;
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

/** 发起一轮服务端生成的请求体（服务端落库 + 可重连）。 */
export interface TurnStartPayload {
  agentId: string;
  query: string;
  history?: ChatMessageHistoryItem[];
  /** 本轮上传文件 id（非空或会话历史含文件则走代码执行 Agent 分支） */
  fileIds?: string[];
  /** 用户消息附件元信息（fileId/filename/contentType） */
  attachments?: ChatAttachment[];
  kbId?: number;
  topK?: number;
  rerank?: boolean;
  /** true=调试台读实时草稿；缺省=对话端只读已发布快照 */
  preview?: boolean;
}

export interface TurnStartResponse {
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
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
  /** 发起一轮服务端生成，立即返回 runId（生成在服务端进行，不绑定本连接）。 */
  startTurn: (id: string, payload: TurnStartPayload) =>
    post<TurnStartResponse>(`/admin/chat/conversations/${id}/turns`, payload),
  /** 取消一轮生成（真中断上游 LLM / 沙箱）。 */
  cancelRun: (runId: string) => post<void>(`/admin/chat/runs/${runId}/cancel`, {}),
};
