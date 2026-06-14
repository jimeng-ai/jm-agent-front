import { get, post } from '@/api/client';
import { streamSse } from '@/api/sse';

/** 与后端 BuilderDraft 对齐（数字 id 用 number；后端可能按字符串下发，读时不做算术，原样存）。 */
export interface BuilderDraft {
  name?: string;
  description?: string;
  avatarHint?: string;
  presetQuestions?: string[];
  systemPrompt?: string;
  model?: string;
  modelParams?: Record<string, unknown>;
  recommendedPluginIds?: Array<number | string>;
  recommendedKbIds?: Array<number | string>;
}

export interface StartSessionResponse {
  conversationId: number | string;
  draft: BuilderDraft;
}

export interface TurnStartResponse {
  runId: string;
  userMessageId: number | string;
  assistantMessageId: number | string;
}

export interface FinalizeResponse {
  agentId: number | string;
}

export const builderApi = {
  startSession: () => post<StartSessionResponse>('/admin/agent-builder/sessions', {}),
  turn: (
    conversationId: string,
    payload: { query: string; fileIds?: number[]; attachments?: unknown },
  ) => post<TurnStartResponse>(`/admin/agent-builder/sessions/${conversationId}/turns`, payload),
  getDraft: (conversationId: string) =>
    get<BuilderDraft>(`/admin/agent-builder/sessions/${conversationId}/draft`),
  finalize: (
    conversationId: string,
    payload: {
      draft: BuilderDraft;
      pluginIds?: number[];
      kbIds?: number[];
      topK?: number;
      scoreThreshold?: number;
      rerank?: boolean;
    },
  ) => post<FinalizeResponse>(`/admin/agent-builder/sessions/${conversationId}/finalize`, payload),
  cancelRun: (runId: string) => post<void>(`/admin/agent-builder/runs/${runId}/cancel`, {}),
};

export interface BuilderRunHandlers {
  onDelta?: (text: string) => void;
  onDraftUpdate?: (draft: BuilderDraft) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function dispatch(event: string, data: string, h: BuilderRunHandlers) {
  try {
    switch (event) {
      case 'draft-update':
        h.onDraftUpdate?.(JSON.parse(data) as BuilderDraft);
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

/** 消费/重连构建器生成流（同 chat runApi 的重连语义，端点换成 agent-builder）。 */
export async function consumeBuilderRun(
  runId: string,
  handlers: BuilderRunHandlers,
  signal?: AbortSignal,
  fromId = '0',
): Promise<void> {
  let lastId = fromId || '0';
  let attempts = 0;
  for (;;) {
    if (signal?.aborted) return;
    let errored = false;
    let ended = false;
    await streamSse(
      `/admin/agent-builder/runs/${runId}/stream?from=${encodeURIComponent(lastId)}`,
      null,
      {
        method: 'GET',
        signal,
        onEvent: (event, data, id) => {
          if (id) lastId = id;
          attempts = 0;
          dispatch(event, data, handlers);
        },
        onError: () => {
          errored = true;
        },
        onDone: () => {
          ended = true;
        },
      },
    );
    if (signal?.aborted) return;
    if (errored && !ended) {
      if (++attempts > MAX_RECONNECTS) {
        handlers.onError?.(new Error('生成流重连失败，请刷新'));
        return;
      }
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }
    break;
  }
  handlers.onDone?.();
}
