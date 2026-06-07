import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAnswer, type AnswerStreamPayload } from '@/features/chat-admin/api';
import { streamAgentExec, type FileStatusEvent } from '@/features/chat-admin/agentExecApi';
import { consumeRun, type RunStreamHandlers } from '@/features/chat-admin/runApi';
import { conversationApi, type TurnStartPayload } from '@/features/chat-admin/conversationApi';
import type { ChatCitation } from '@/api/types';
import type { ArtifactRef, MessageSegment } from '@/features/chat-admin/types';

interface State {
  status: 'idle' | 'streaming' | 'done' | 'error';
  text: string;
  citations: ChatCitation[];
  segments: MessageSegment[];
  /** 代码执行 Agent 的产物（可下载） */
  artifacts: ArtifactRef[];
  /** 输入文件准备状态（代码执行 Agent，瞬态） */
  files: FileStatusEvent[];
  /** 本轮回答总耗时（毫秒），done 后有值 */
  elapsedMs?: number;
  error?: string;
}

/** done 回调携带的最终结果（用于落库 / 更新消息） */
export interface SseDoneResult {
  text: string;
  citations: ChatCitation[];
  segments: MessageSegment[];
  artifacts: ArtifactRef[];
  elapsedMs: number;
}

/** start 的可选项：mode='exec' 走代码执行 Agent（/agent/exec），默认 'rag'（/rag/answer）。 */
export interface SseStartOptions {
  mode?: 'rag' | 'exec';
}

type StartPayload = AnswerStreamPayload & { fileIds?: string[]; conversationId?: string };

export function useSSE() {
  const [state, setState] = useState<State>({
    status: 'idle',
    text: '',
    citations: [],
    segments: [],
    artifacts: [],
    files: [],
  });
  const abortRef = useRef<AbortController | null>(null);
  const textBufferRef = useRef('');
  const segmentsRef = useRef<MessageSegment[]>([]);
  const artifactsRef = useRef<ArtifactRef[]>([]);
  const citationsRef = useRef<ChatCitation[]>([]);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  /** 当前在跑的 runId（服务端生成路径），停止据此取消。 */
  const runIdRef = useRef<string | null>(null);

  // 把文本增量追加到「当前文本片段」；若上一片段是工具/产物，则开启新文本片段（实现交错顺序）
  const appendText = useCallback((delta: string) => {
    const segs = segmentsRef.current;
    const last = segs[segs.length - 1];
    if (last && last.type === 'text') {
      segs[segs.length - 1] = { type: 'text', text: last.text + delta };
    } else {
      segs.push({ type: 'text', text: delta });
    }
  }, []);

  const commit = useCallback(() => {
    setState((s) => ({ ...s, text: textBufferRef.current, segments: [...segmentsRef.current] }));
  }, []);

  const flush = useCallback(() => {
    rafRef.current = null;
    commit();
  }, [commit]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(
    () => () => {
      // 卸载：仅脱离观众（abort 本地 fetch）；服务端生成路径下生成会继续，回来可重连。
      abortRef.current?.abort();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ── 共用累积回调（start / startTurn / consume 共用同一套，读写同一组 ref）──
  const onCitations = useCallback((cs: ChatCitation[]) => {
    // 多跳：一次回答里模型可能多次调用 rag.search，每次来一批 citations。
    // 累积合并而非覆盖，并按 chunkId 去重；Map 保留首次插入顺序。
    const merged = new Map<string, ChatCitation>();
    for (const c of [...citationsRef.current, ...cs]) {
      merged.set(c.chunkId ?? `${c.docId}#${c.content ?? ''}`, c);
    }
    citationsRef.current = [...merged.values()];
    setState((s) => ({ ...s, citations: citationsRef.current }));
  }, []);

  const onDelta = useCallback(
    (delta: string) => {
      textBufferRef.current += delta;
      appendText(delta);
      scheduleFlush();
    },
    [appendText, scheduleFlush],
  );

  const onToolCall = useCallback(
    (calls: { id: string; name: string; desc?: string; input?: unknown }[]) => {
      for (const c of calls) {
        const idx = segmentsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === c.id);
        const seg: MessageSegment = {
          type: 'tool',
          call: { id: c.id, name: c.name, desc: c.desc, input: c.input, status: 'running' },
        };
        if (idx >= 0) segmentsRef.current[idx] = seg;
        else segmentsRef.current.push(seg);
      }
      commit();
    },
    [commit],
  );

  const onToolResult = useCallback(
    (results: { id: string; name: string; status: 'success' | 'error' }[]) => {
      for (const r of results) {
        const idx = segmentsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === r.id);
        if (idx >= 0) {
          const seg = segmentsRef.current[idx];
          if (seg.type === 'tool') {
            segmentsRef.current[idx] = { type: 'tool', call: { ...seg.call, status: r.status } };
          }
        } else {
          segmentsRef.current.push({
            type: 'tool',
            call: { id: r.id, name: r.name, status: r.status },
          });
        }
      }
      commit();
    },
    [commit],
  );

  const onCodeOutput = useCallback(
    (c: { id: string; tool: string; output: string }) => {
      const idx = segmentsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === c.id);
      if (idx >= 0) {
        const seg = segmentsRef.current[idx];
        if (seg.type === 'tool') {
          segmentsRef.current[idx] = { type: 'tool', call: { ...seg.call, output: c.output } };
        }
      } else {
        segmentsRef.current.push({
          type: 'tool',
          call: { id: c.id, name: c.tool, status: 'running', output: c.output },
        });
      }
      commit();
    },
    [commit],
  );

  const onArtifact = useCallback(
    (a: ArtifactRef) => {
      artifactsRef.current.push(a);
      segmentsRef.current.push({ type: 'artifact', artifact: a });
      setState((s) => ({ ...s, artifacts: [...artifactsRef.current] }));
      commit();
    },
    [commit],
  );

  const onFileStatus = useCallback((f: FileStatusEvent) => {
    setState((s) => {
      const files = [...s.files];
      const i = files.findIndex((x) => x.filename === f.filename);
      if (i >= 0) files[i] = f;
      else files.push(f);
      return { ...s, files };
    });
  }, []);

  const onStreamError = useCallback((e: Error) => {
    setState((s) => ({ ...s, status: 'error', error: e.message }));
  }, []);

  /** 重置累积态并进入 streaming（每次发起 / 重连前调用）。 */
  const begin = useCallback((signal: AbortController) => {
    abortRef.current?.abort();
    abortRef.current = signal;
    textBufferRef.current = '';
    segmentsRef.current = [];
    artifactsRef.current = [];
    citationsRef.current = [];
    startedAtRef.current = performance.now();
    setState({
      status: 'streaming',
      text: '',
      citations: [],
      segments: [],
      artifacts: [],
      files: [],
    });
  }, []);

  /** 生成正常终止时的收尾（与服务端 finalize 对齐：running 工具规整为 error）。 */
  const makeFinalize = useCallback(
    (onDoneFinalText?: (r: SseDoneResult) => void) => () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const finalText = textBufferRef.current;
      const finalSegments: MessageSegment[] = segmentsRef.current.map((s) =>
        s.type === 'tool' && s.call.status === 'running'
          ? { type: 'tool', call: { ...s.call, status: 'error' as const } }
          : s,
      );
      const citations = citationsRef.current;
      const artifacts = [...artifactsRef.current];
      const elapsedMs = Math.round(performance.now() - startedAtRef.current);
      setState({
        status: 'done',
        text: finalText,
        citations,
        segments: finalSegments,
        artifacts,
        files: [],
        elapsedMs,
      });
      onDoneFinalText?.({
        text: finalText,
        citations,
        segments: finalSegments,
        artifacts,
        elapsedMs,
      });
    },
    [],
  );

  const handlers = useCallback(
    (finalize: () => void): RunStreamHandlers => ({
      onCitations,
      onDelta,
      onToolCall,
      onToolResult,
      onCodeOutput,
      onArtifact,
      onFileStatus,
      onError: onStreamError,
      onDone: finalize,
    }),
    [
      onCitations,
      onDelta,
      onToolCall,
      onToolResult,
      onCodeOutput,
      onArtifact,
      onFileStatus,
      onStreamError,
    ],
  );

  // ── 旧的直连流式（调试台 Playground 用，未落库、可测草稿）──
  const start = useCallback(
    async (
      payload: StartPayload,
      onDoneFinalText?: (result: SseDoneResult) => void,
      opts?: SseStartOptions,
    ) => {
      const ctrl = new AbortController();
      begin(ctrl);
      runIdRef.current = null;
      const h = handlers(makeFinalize(onDoneFinalText));
      if (opts?.mode === 'exec') {
        await streamAgentExec(
          {
            agentId: payload.agentId,
            conversationId: payload.conversationId,
            query: payload.query,
            fileIds: payload.fileIds,
            history: payload.history,
            preview: payload.preview,
          },
          h,
          ctrl.signal,
        );
      } else {
        await streamAnswer(payload, h, ctrl.signal);
      }
    },
    [begin, handlers, makeFinalize],
  );

  // ── 服务端自持久化 + 可重连：发起一轮（落库 user+assistant，立即拿 runId 续播）──
  const startTurn = useCallback(
    async (
      conversationId: string,
      payload: TurnStartPayload,
      onDoneFinalText?: (result: SseDoneResult) => void,
      onCreated?: (res: { runId: string }) => void,
    ) => {
      const ctrl = new AbortController();
      begin(ctrl);
      const res = await conversationApi.startTurn(conversationId, payload);
      runIdRef.current = res.runId;
      // POST 返回即说明 GENERATING 占位已落库提交：此刻刷新列表，generating 标志才会亮（驱动「正在回复」转圈）。
      onCreated?.(res);
      await consumeRun(res.runId, handlers(makeFinalize(onDoneFinalText)), ctrl.signal, '0');
      return res;
    },
    [begin, handlers, makeFinalize],
  );

  // ── 服务端自持久化 + 可重连：重连一个在跑的 run（切走再回来 / 多窗口 / 刷新）──
  const consume = useCallback(
    (runId: string, onDoneFinalText?: (result: SseDoneResult) => void, fromId = '0') => {
      const ctrl = new AbortController();
      begin(ctrl);
      runIdRef.current = runId;
      void consumeRun(runId, handlers(makeFinalize(onDoneFinalText)), ctrl.signal, fromId);
    },
    [begin, handlers, makeFinalize],
  );

  /** 真停止：取消服务端生成（中断上游 LLM / 沙箱），让 cancelled 终止帧正常流回收尾。 */
  const stop = useCallback(() => {
    const rid = runIdRef.current;
    if (rid) {
      conversationApi.cancelRun(rid).catch(() => {
        /* 取消失败不阻断 UI */
      });
    }
  }, []);

  /** 仅脱离本地观众（不取消服务端生成）。 */
  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current = null;
    textBufferRef.current = '';
    segmentsRef.current = [];
    artifactsRef.current = [];
    citationsRef.current = [];
    setState({ status: 'idle', text: '', citations: [], segments: [], artifacts: [], files: [] });
  }, []);

  return { ...state, start, startTurn, consume, stop, abort, reset };
}
