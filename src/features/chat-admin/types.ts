import type { ChatCitation } from '@/api/types';
import { nanoid } from 'nanoid';

export type ChatStatus = 'idle' | 'streaming' | 'done' | 'error';

export type ToolCallStatus = 'running' | 'success' | 'error';

/** 一次工具调用在对话里的可视化状态（来自 SSE progress / tool_result 事件） */
export interface ToolCallView {
  id: string;
  name: string;
  /** 工具描述（如「根据城市查询天气」） */
  desc?: string;
  /** 入参 */
  input?: unknown;
  status: ToolCallStatus;
}

/** 助手消息的有序片段：文本与工具调用按真实发生顺序交错（叙述 → 工具 → 答案） */
export type MessageSegment =
  | { type: 'text'; text: string }
  | { type: 'tool'; call: ToolCallView };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  /** 流式期间的有序片段；历史消息只有 content（无 segments）时回退渲染 content */
  segments?: MessageSegment[];
  status?: ChatStatus;
  errorMessage?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  agentId?: string;
  kbId?: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export function createSession(agentId?: string): ChatSession {
  return {
    id: nanoid(),
    title: '新会话',
    agentId,
    messages: [],
    updatedAt: Date.now(),
  };
}

export function newMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: nanoid(),
    role,
    content,
    status: role === 'assistant' ? 'streaming' : 'idle',
    createdAt: Date.now(),
  };
}
