import { get, post, put } from '@/api/client';
import { streamSse } from '@/api/sse';
import type { SkillFileView } from './types';

/**
 * Skill 构建器（沙箱里原样跑 Anthropic skill-creator）的接口。
 *
 * 一个会话 = 后端一个挂在隐藏构建器 Agent 上的对话 + MinIO 上的一个工作区；草稿、评审页、
 * 触发优化报告都从工作区读，页面刷新后按会话 id 全部恢复。id 一律是字符串（雪花 id）。
 */

export type SkillType = 'PROMPT' | 'DOER';

export interface BuilderDraftFile {
  path: string;
  size: number | string;
  /** 文本内容；二进制或超过预览上限时为 null */
  text: string | null;
  binary: boolean;
  /** false = 根目录 evals/ 或缓存文件：存进 bundle 但不下发给运行 */
  runtime: boolean;
}

export interface BuilderDraft {
  dirName: string;
  name: string | null;
  description: string | null;
  skillMd: string;
  body: string;
  inferredType: SkillType;
  effectiveType: SkillType;
  files: BuilderDraftFile[];
  /** 按 skill-creator quick_validate 规则校验出的问题；空 = 可以发布 */
  validationErrors: string[];
  iterations: number;
  otherSkillDirs: string[];
}

export interface ReviewMeta {
  iteration: number;
  updatedAt: string | null;
  feedbackSubmitted: boolean;
}

/** 后端 ChatDtos.MessageView（恢复聊天记录用） */
export interface BuilderMessageView {
  id: string | number;
  role: 'user' | 'assistant';
  content: string | null;
  segments?: unknown;
  attachments?: unknown;
  status?: string;
  elapsedMs?: number | string | null;
  createTime?: string;
}

export interface BuilderSession {
  sessionId: string;
  conversationId: string;
  status: 'ACTIVE' | 'PUBLISHED' | 'ABANDONED';
  baseSkillId: string | null;
  baseVersion: number | null;
  baseSkillName: string | null;
  skillTypeOverride: SkillType | null;
  draft: BuilderDraft | null;
  review: ReviewMeta | null;
  hasOptimizationReport: boolean;
  activeRunId: string | null;
  messages: BuilderMessageView[] | null;
}

export interface ReviewView {
  iteration: number;
  html: string | null;
  feedback: unknown;
  tooLarge: boolean;
}

export interface ReportView {
  html: string | null;
  tooLarge: boolean;
}

export interface TurnStartResponse {
  runId: string;
  userMessageId: number | string;
  assistantMessageId: number | string;
}

export interface PublishResult {
  skillId: string;
  name: string;
  version: number;
  status: string;
  skillType: SkillType;
  warnings: string[];
}

export interface DraftUpdateEvent {
  draft: BuilderDraft | null;
  review: ReviewMeta | null;
  hasOptimizationReport: boolean;
  workspacePersisted?: boolean | null;
}

const BASE = '/tenant/skills/builder';

export const skillBuilderApi = {
  /** 新建会话；带 baseSkillId = 改进已有 skill（同一个 skill 有进行中的会话时后端直接返回它）。 */
  createSession: (baseSkillId?: string) =>
    post<BuilderSession>(`${BASE}/sessions`, baseSkillId ? { baseSkillId } : {}),

  getSession: (sessionId: string) => get<BuilderSession>(`${BASE}/sessions/${sessionId}`),

  startTurn: (
    sessionId: string,
    // fileIds 用字符串传：19 位雪花 Long 用 number 会丢精度（见 numbers-as-strings 约定）。
    payload: { query: string; fileIds?: (string | number)[]; attachments?: unknown },
  ) => post<TurnStartResponse>(`${BASE}/sessions/${sessionId}/turns`, payload),

  cancelRun: (runId: string) => post<void>(`${BASE}/runs/${runId}/cancel`, {}),

  getReview: (sessionId: string) => get<ReviewView | null>(`${BASE}/sessions/${sessionId}/review`),

  saveFeedback: (sessionId: string, iteration: number, feedback: unknown) =>
    put<void>(`${BASE}/sessions/${sessionId}/review/feedback`, { iteration, feedback }),

  getOptimizationReport: (sessionId: string) =>
    get<ReportView | null>(`${BASE}/sessions/${sessionId}/optimization`),

  setSkillType: (sessionId: string, skillType: SkillType | null) =>
    put<void>(`${BASE}/sessions/${sessionId}/skill-type`, { skillType }),

  publish: (sessionId: string) => post<PublishResult>(`${BASE}/sessions/${sessionId}/publish`, {}),
};

/** 草稿文件 → 详情抽屉同款的文件查看器形状（wire ⇄ model 在 api 边界转换）。 */
export function toFileViews(files: BuilderDraftFile[]): SkillFileView[] {
  return files.map((f) => ({
    path: f.path,
    content: f.text,
    binary: f.binary,
    truncated: !f.binary && f.text == null,
    size: f.size,
  }));
}

// ------------------------------------------------------------------ 生成流

export interface ToolCallEvent {
  id: string;
  name: string;
  input?: unknown;
  /** 子 agent（skill-creator 并行跑测试用例）发起的调用带上发起它的 Agent 调用 id */
  parent?: string;
}

export interface ToolResultEvent {
  id: string;
  name: string;
  status: 'success' | 'error';
  parent?: string;
}

export interface SkillRunHandlers {
  onDelta?: (text: string) => void;
  onToolCalls?: (calls: ToolCallEvent[]) => void;
  onToolResults?: (results: ToolResultEvent[]) => void;
  onCodeOutput?: (e: { id: string; output: string; parent?: string }) => void;
  onWorkspace?: (e: { phase: string; files?: number; uploaded?: number; failed?: unknown[] }) => void;
  onDraftUpdate?: (e: DraftUpdateEvent) => void;
  onSummary?: (e: { status?: string; error?: string | null; errorMessage?: string | null }) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function dispatch(event: string, data: string, h: SkillRunHandlers) {
  try {
    switch (event) {
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
        const p = JSON.parse(data) as { calls?: ToolCallEvent[] };
        if (p.calls?.length) h.onToolCalls?.(p.calls);
        break;
      }
      case 'tool_result': {
        const p = JSON.parse(data) as { results?: ToolResultEvent[] };
        if (p.results?.length) h.onToolResults?.(p.results);
        break;
      }
      case 'code_output': {
        const p = JSON.parse(data) as { id: string; output: string; parent?: string };
        h.onCodeOutput?.(p);
        break;
      }
      case 'workspace':
        h.onWorkspace?.(JSON.parse(data));
        break;
      case 'draft-update':
        h.onDraftUpdate?.(JSON.parse(data) as DraftUpdateEvent);
        break;
      case 'summary':
        h.onSummary?.(JSON.parse(data));
        break;
      case 'error': {
        const p = JSON.parse(data) as { message?: string };
        h.onError?.(new Error(p.message ?? '构建器出错'));
        break;
      }
      default:
        break;
    }
  } catch {
    /* 忽略畸形帧 */
  }
}

/** 消费 / 重连一轮构建（与 agent-builder 同语义：断线后按最后一个 stream id 续播）。 */
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
    await streamSse(`${BASE}/runs/${runId}/stream?from=${encodeURIComponent(lastId)}`, null, {
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
    });
    if (signal?.aborted) return;
    if (errored && !ended) {
      if (++attempts > MAX_RECONNECTS) {
        handlers.onError?.(new Error('生成流重连失败，请刷新页面'));
        return;
      }
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }
    break;
  }
  handlers.onDone?.();
}
