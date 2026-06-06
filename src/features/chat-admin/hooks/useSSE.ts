import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAnswer, type AnswerStreamPayload } from '@/features/chat-admin/api';
import { streamAgentExec, type FileStatusEvent } from '@/features/chat-admin/agentExecApi';
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
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

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
      abortRef.current?.abort();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const start = useCallback(
    async (
      payload: StartPayload,
      onDoneFinalText?: (result: SseDoneResult) => void,
      opts?: SseStartOptions,
    ) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      textBufferRef.current = '';
      segmentsRef.current = [];
      artifactsRef.current = [];
      startedAtRef.current = performance.now();
      setState({
        status: 'streaming',
        text: '',
        citations: [],
        segments: [],
        artifacts: [],
        files: [],
      });

      let citations: ChatCitation[] = [];

      // ── 共用累积回调 ──
      const onDelta = (delta: string) => {
        textBufferRef.current += delta;
        appendText(delta);
        scheduleFlush();
      };
      const onToolCall = (
        calls: { id: string; name: string; desc?: string; input?: unknown }[],
      ) => {
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
      };
      const onToolResult = (
        results: { id: string; name: string; status: 'success' | 'error' }[],
      ) => {
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
      };
      const onError = (e: Error) => {
        setState((s) => ({ ...s, status: 'error', error: e.message }));
      };
      const finalize = () => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        const finalText = textBufferRef.current;
        // 流已结束：仍处于 running 的工具段规整为 error，否则刷新后会看到永远转圈的工具。
        const finalSegments: MessageSegment[] = segmentsRef.current.map((s) =>
          s.type === 'tool' && s.call.status === 'running'
            ? { type: 'tool', call: { ...s.call, status: 'error' as const } }
            : s,
        );
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
      };

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
          {
            onDelta,
            onToolCall,
            onToolResult,
            onError,
            onCodeOutput: (c) => {
              const idx = segmentsRef.current.findIndex(
                (s) => s.type === 'tool' && s.call.id === c.id,
              );
              if (idx >= 0) {
                const seg = segmentsRef.current[idx];
                if (seg.type === 'tool') {
                  segmentsRef.current[idx] = {
                    type: 'tool',
                    call: { ...seg.call, output: c.output },
                  };
                }
              } else {
                segmentsRef.current.push({
                  type: 'tool',
                  call: { id: c.id, name: c.tool, status: 'running', output: c.output },
                });
              }
              commit();
            },
            onArtifact: (a) => {
              artifactsRef.current.push(a);
              segmentsRef.current.push({ type: 'artifact', artifact: a });
              setState((s) => ({ ...s, artifacts: [...artifactsRef.current] }));
              commit();
            },
            onFileStatus: (f) => {
              setState((s) => {
                const files = [...s.files];
                const i = files.findIndex((x) => x.filename === f.filename);
                if (i >= 0) files[i] = f;
                else files.push(f);
                return { ...s, files };
              });
            },
            onDone: finalize,
          },
          ctrl.signal,
        );
      } else {
        await streamAnswer(
          payload,
          {
            onCitations: (cs) => {
              // 多跳：一次回答里模型可能多次调用 rag.search，每次来一批 citations。
              // 累积合并而非覆盖，并按 chunkId 去重（CitationReferences 假定来源已按 chunkId 去重），
              // 否则后到的检索来源会把先到的冲掉，「参考来源」只剩最后一次检索的文档。
              // Map 保留首次插入顺序：已有来源位置不变，新去重后的来源追加在后。
              const merged = new Map<string, ChatCitation>();
              for (const c of [...citations, ...cs]) {
                merged.set(c.chunkId ?? `${c.docId}#${c.content ?? ''}`, c);
              }
              citations = [...merged.values()];
              setState((s) => ({ ...s, citations }));
            },
            onDelta,
            onToolCall,
            onToolResult,
            onError,
            onDone: finalize,
          },
          ctrl.signal,
        );
      }
    },
    [appendText, commit, scheduleFlush],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    textBufferRef.current = '';
    segmentsRef.current = [];
    artifactsRef.current = [];
    setState({ status: 'idle', text: '', citations: [], segments: [], artifacts: [], files: [] });
  }, []);

  return { ...state, start, abort, reset };
}
