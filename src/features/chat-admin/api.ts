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
  /** true=调试台预览：读 Agent 实时草稿配置；缺省=对话端，只读已发布快照（未发布则后端拒绝）。 */
  preview?: boolean;
}

export interface ToolCallProgress {
  id: string;
  name: string;
  desc?: string;
  input?: unknown;
  status?: string;
}

export interface ToolResultItem {
  id: string;
  name: string;
  status: 'success' | 'error';
  output?: unknown;
}

export interface AnswerStreamHandlers {
  onCitations?: (cites: ChatCitation[]) => void;
  onDelta?: (text: string) => void;
  /** 模型即将调用工具（SSE progress 事件） */
  onToolCall?: (calls: ToolCallProgress[]) => void;
  /** 工具执行完成（SSE tool_result 事件） */
  onToolResult?: (results: ToolResultItem[]) => void;
  /** 生成汇总帧，携带后端权威耗时（秒） */
  onSummary?: (s: { elapsedSeconds?: number }) => void;
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
      } else if (event === 'progress') {
        // 工具调用前置事件：{round, tools:[...], calls:[{id,name,desc,input,status:"running"}]}
        try {
          const parsed = JSON.parse(data) as { calls?: ToolCallProgress[] };
          if (parsed.calls?.length) handlers.onToolCall?.(parsed.calls);
        } catch {
          /* ignore */
        }
      } else if (event === 'tool_result') {
        // 工具执行结果：{round, results:[{id,name,status,output}]}
        try {
          const parsed = JSON.parse(data) as { results?: ToolResultItem[] };
          if (parsed.results?.length) handlers.onToolResult?.(parsed.results);
        } catch {
          /* ignore */
        }
      } else if (event === 'summary') {
        try {
          const parsed = JSON.parse(data) as { elapsed_seconds?: number };
          handlers.onSummary?.({ elapsedSeconds: parsed.elapsed_seconds });
        } catch {
          /* ignore */
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
