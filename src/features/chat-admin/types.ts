import type { ChatCitation } from '@/api/types';
import { nanoid } from 'nanoid';

export type ChatStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
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
