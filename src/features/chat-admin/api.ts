import { streamSse, type SseHandlers } from '@/api/sse';
import type { ChatCitation, ChatMessageHistoryItem } from '@/api/types';

export interface AnswerStreamPayload {
  kbId?: string;
  agentId?: string;
  query: string;
  topK?: number;
  rerank?: boolean;
  docIds?: string[];
  history?: ChatMessageHistoryItem[];
}

export interface AnswerStreamHandlers {
  onCitations?: (cites: ChatCitation[]) => void;
  onDelta?: (text: string) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export function streamAnswer(
  payload: AnswerStreamPayload,
  handlers: AnswerStreamHandlers,
  signal?: AbortSignal,
) {
  const sse: SseHandlers = {
    onEvent: (event, data) => {
      if (event === 'citations') {
        try {
          const arr = JSON.parse(data) as ChatCitation[];
          handlers.onCitations?.(arr);
        } catch {
          /* ignore */
        }
      } else if (event === 'claude-delta') {
        // Claude 原生 SSE：只关心文本增量
        // {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
        try {
          const parsed = JSON.parse(data) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const text = parsed.delta.text ?? '';
            if (text) handlers.onDelta?.(text);
          }
        } catch {
          /* ignore — message_start / ping / message_stop 等非文本帧 */
        }
      } else if (event === 'message') {
        // 兼容旧风格 message 事件（OpenAI-like {delta} / {text}）
        try {
          const parsed = JSON.parse(data) as { delta?: string; text?: string };
          const text = parsed.delta ?? parsed.text ?? '';
          if (text) handlers.onDelta?.(text);
        } catch {
          handlers.onDelta?.(data);
        }
      } else if (event === 'error') {
        try {
          const parsed = JSON.parse(data) as { message?: string };
          handlers.onError?.(new Error(parsed.message ?? 'SSE 错误'));
        } catch {
          handlers.onError?.(new Error(data));
        }
      }
    },
    onError: (e) => handlers.onError?.(e),
    onDone: () => handlers.onDone?.(),
  };
  return streamSse('/rag/answer', payload, { ...sse, signal });
}
