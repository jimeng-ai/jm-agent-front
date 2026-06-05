import { streamSse, type SseHandlers } from '@/api/sse';
import type { ChatMessageHistoryItem } from '@/api/types';
import type { ArtifactRef } from '@/features/chat-admin/types';
import type { ToolCallProgress, ToolResultItem } from '@/features/chat-admin/api';

export interface AgentExecPayload {
  agentId?: string;
  conversationId?: string;
  query: string;
  /** 本轮附带的输入文件 ID（来自 /agent/files 上传） */
  fileIds?: string[];
  history?: ChatMessageHistoryItem[];
  /** true=调试台预览：读 Agent 实时草稿配置；缺省=对话端，只读已发布快照（未发布则后端拒绝）。 */
  preview?: boolean;
}

export interface FileStatusEvent {
  phase: 'pulling' | 'ready' | 'error' | string;
  filename?: string;
  objectName?: string;
}

export interface CodeOutputEvent {
  id: string;
  tool: string;
  output: string;
  isError?: boolean;
}

export interface AgentExecHandlers {
  onDelta?: (text: string) => void;
  onToolCall?: (calls: ToolCallProgress[]) => void;
  onToolResult?: (results: ToolResultItem[]) => void;
  onFileStatus?: (f: FileStatusEvent) => void;
  onCodeOutput?: (c: CodeOutputEvent) => void;
  onArtifact?: (a: ArtifactRef) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

/**
 * 代码执行 / 文件处理 Agent 流式通道（POST /data/agent/exec）。
 * 复用 streamSse；事件是 RAG /rag/answer 的超集，额外有 file_status / code_output / artifact。
 */
export function streamAgentExec(
  payload: AgentExecPayload,
  handlers: AgentExecHandlers,
  signal?: AbortSignal,
) {
  const sse: SseHandlers = {
    onEvent: (event, data) => {
      try {
        switch (event) {
          case 'claude-delta': {
            const p = JSON.parse(data) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (
              p.type === 'content_block_delta' &&
              p.delta?.type === 'text_delta' &&
              p.delta.text
            ) {
              handlers.onDelta?.(p.delta.text);
            }
            break;
          }
          case 'progress': {
            const p = JSON.parse(data) as { calls?: ToolCallProgress[] };
            if (p.calls?.length) handlers.onToolCall?.(p.calls);
            break;
          }
          case 'tool_result': {
            const p = JSON.parse(data) as { results?: ToolResultItem[] };
            if (p.results?.length) handlers.onToolResult?.(p.results);
            break;
          }
          case 'code_output': {
            handlers.onCodeOutput?.(JSON.parse(data) as CodeOutputEvent);
            break;
          }
          case 'file_status': {
            handlers.onFileStatus?.(JSON.parse(data) as FileStatusEvent);
            break;
          }
          case 'artifact': {
            handlers.onArtifact?.(JSON.parse(data) as ArtifactRef);
            break;
          }
          case 'error': {
            const p = JSON.parse(data) as { message?: string };
            handlers.onError?.(new Error(p.message ?? 'SSE 错误'));
            break;
          }
          // 'summary' 仅用于后端记账，前端靠 onDone 收尾
          default:
            break;
        }
      } catch {
        /* 忽略畸形帧（message_start / ping 等） */
      }
    },
    onError: (e) => handlers.onError?.(e),
    onDone: () => handlers.onDone?.(),
  };
  return streamSse('/agent/exec', payload, { ...sse, signal });
}
