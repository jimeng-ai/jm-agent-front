import { streamSse } from '@/api/sse';
import type { ChatCitation } from '@/api/types';
import type { ToolCallProgress, ToolResultItem } from '@/features/chat-admin/api';
import type { CodeOutputEvent, FileStatusEvent } from '@/features/chat-admin/agentExecApi';
import type { ArtifactRef } from '@/features/chat-admin/types';

/**
 * 可重连生成流的消费层。事件是对话 RAG + 代码执行 Agent 的超集，服务端把每帧写进 Redis 续播缓冲，
 * 这里用同一条路径消费「首次发送」与「切走重连/多窗口」，并对网络抖动带 Last-Event-ID 自动重连。
 */

export interface RunStreamHandlers {
  onCitations?: (cites: ChatCitation[]) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (calls: ToolCallProgress[]) => void;
  onToolResult?: (results: ToolResultItem[]) => void;
  onCodeOutput?: (c: CodeOutputEvent) => void;
  onFileStatus?: (f: FileStatusEvent) => void;
  onArtifact?: (a: ArtifactRef) => void;
  /** 生成汇总帧，携带后端权威耗时（秒）；用于显示真实端到端耗时。 */
  onSummary?: (s: { elapsedSeconds?: number }) => void;
  onError?: (err: Error) => void;
  /** 生成终止（服务端写入终止帧、流正常结束）；网络抖动不会触发它（会自动重连）。 */
  onDone?: () => void;
}

/** 把一帧 run 流事件分发到处理器。 */
function dispatch(event: string, data: string, h: RunStreamHandlers) {
  try {
    switch (event) {
      case 'citations':
        h.onCitations?.(JSON.parse(data) as ChatCitation[]);
        break;
      case 'claude-delta': {
        const p = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
        if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta' && p.delta.text) {
          h.onDelta?.(p.delta.text);
        }
        break;
      }
      case 'message': {
        const p = JSON.parse(data) as { delta?: string; text?: string };
        const t = p.delta ?? p.text ?? '';
        if (t) h.onDelta?.(t);
        break;
      }
      case 'progress': {
        const p = JSON.parse(data) as { calls?: ToolCallProgress[] };
        if (p.calls?.length) h.onToolCall?.(p.calls);
        break;
      }
      case 'tool_result': {
        const p = JSON.parse(data) as { results?: ToolResultItem[] };
        if (p.results?.length) h.onToolResult?.(p.results);
        break;
      }
      case 'code_output':
        h.onCodeOutput?.(JSON.parse(data) as CodeOutputEvent);
        break;
      case 'file_status':
        h.onFileStatus?.(JSON.parse(data) as FileStatusEvent);
        break;
      case 'artifact':
        h.onArtifact?.(JSON.parse(data) as ArtifactRef);
        break;
      case 'summary': {
        const p = JSON.parse(data) as { elapsed_seconds?: number };
        h.onSummary?.({ elapsedSeconds: p.elapsed_seconds });
        break;
      }
      case 'error': {
        const p = JSON.parse(data) as { message?: string };
        h.onError?.(new Error(p.message ?? 'SSE 错误'));
        break;
      }
      default:
        break;
    }
  } catch {
    /* 忽略畸形帧（message_start / ping 等） */
  }
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECTS = 6;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 消费/重连一轮服务端生成（发送与重连同路）。
 * - fromId 缺省='0'：从头补播（切走再回来看到全过程）；或传上次的 stream id 续传。
 * - 网络抖动（onError 且未结束）→ 带 Last-Event-ID 自动重连；干净结束（onDone）→ 收尾。
 * - signal abort（用户切走/卸载）→ 仅脱离观众，不触发 onDone（生成在服务端继续）。
 */
export async function consumeRun(
  runId: string,
  handlers: RunStreamHandlers,
  signal?: AbortSignal,
  fromId = '0',
): Promise<void> {
  let lastId = fromId || '0';
  let attempts = 0;
  for (;;) {
    if (signal?.aborted) return;
    let errored = false;
    let ended = false;
    await streamSse(`/admin/chat/runs/${runId}/stream?from=${encodeURIComponent(lastId)}`, null, {
      method: 'GET',
      signal,
      onEvent: (event, data, id) => {
        if (id) lastId = id;
        attempts = 0; // 有帧流动即视为连接健康，重置重连计数
        dispatch(event, data, handlers);
      },
      onError: () => {
        errored = true;
      },
      onDone: () => {
        ended = true;
      },
    });
    if (signal?.aborted) return; // 卸载/切走：脱离观众，不收尾（生成在服务端继续）
    if (errored && !ended) {
      if (++attempts > MAX_RECONNECTS) {
        handlers.onError?.(new Error('生成流重连失败，请刷新会话'));
        return;
      }
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }
    break; // 干净结束：生成已终止
  }
  handlers.onDone?.();
}
