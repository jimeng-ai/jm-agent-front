import { get, post } from '@/api/client';
import { streamSse } from '@/api/sse';

/** SkillDraft: 与后端 SkillDraft DTO 对齐。files 仅 DOER 类型有值。 */
export interface SkillDraft {
  name?: string;
  description?: string;
  body?: string;
  skillType?: 'PROMPT' | 'DOER';
  files?: Record<string, string>;
}

export interface StartSkillSessionResponse {
  conversationId: number | string;
  draft: SkillDraft;
}

export interface SkillTurnStartResponse {
  runId: string;
  userMessageId: number | string;
  assistantMessageId: number | string;
}

export interface SkillFinalizeResponse {
  skillId: number | string;
  name: string;
  status: string;
}

const BASE = '/tenant/skills/builder';

export const skillBuilderApi = {
  startSession: () => post<StartSkillSessionResponse>(`${BASE}/sessions`, {}),

  startTurn: (
    conversationId: string,
    // fileIds 用字符串传：19 位雪花 Long 用 number 会丢精度（见 numbers-as-strings 约定）。
    payload: { query: string; fileIds?: (string | number)[]; attachments?: unknown },
  ) => post<SkillTurnStartResponse>(`${BASE}/sessions/${conversationId}/turns`, payload),

  getDraft: (conversationId: string) => get<SkillDraft>(`${BASE}/sessions/${conversationId}/draft`),

  /** testRun: SSE endpoint for DOER dry-run. Returns the SSE URL so caller can streamSse. */
  testRunUrl: (conversationId: string, sampleFileId: string) =>
    `${BASE}/sessions/${conversationId}/test-run?sampleFileId=${encodeURIComponent(sampleFileId)}`,

  finalize: (conversationId: string) =>
    post<SkillFinalizeResponse>(`${BASE}/sessions/${conversationId}/finalize`, {}),
};

export interface SkillRunHandlers {
  onDelta?: (text: string) => void;
  onDraftUpdate?: (draft: SkillDraft) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function dispatchSkill(event: string, data: string, h: SkillRunHandlers) {
  try {
    switch (event) {
      case 'draft-update':
        h.onDraftUpdate?.(JSON.parse(data) as SkillDraft);
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
    /* 忽略畸形帧 */
  }
}

/** 消费/重连技能构建器生成流（与 agent-builder consumeBuilderRun 同语义）。 */
export async function consumeSkillBuilderRun(
  runId: string,
  handlers: SkillRunHandlers,
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
      `/tenant/skills/builder/runs/${runId}/stream?from=${encodeURIComponent(lastId)}`,
      null,
      {
        method: 'GET',
        signal,
        onEvent: (event, data, id) => {
          if (id) lastId = id;
          attempts = 0;
          dispatchSkill(event, data, handlers);
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

/** testRun SSE consumer for DOER dry-run results. Streams progress/artifact/summary events. */
export interface TestRunHandlers {
  onEvent?: (event: string, data: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export async function consumeTestRun(
  conversationId: string,
  sampleFileId: string,
  handlers: TestRunHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await streamSse(skillBuilderApi.testRunUrl(conversationId, sampleFileId), null, {
    method: 'POST',
    signal,
    onEvent: (event, data) => {
      handlers.onEvent?.(event, data);
    },
    onError: (err) => handlers.onError?.(err),
    onDone: () => handlers.onDone?.(),
  });
}
