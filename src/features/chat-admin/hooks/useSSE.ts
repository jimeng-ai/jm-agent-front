import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAnswer, type AnswerStreamPayload } from '@/features/chat-admin/api';
import type { ChatCitation } from '@/api/types';
import type { MessageSegment } from '@/features/chat-admin/types';

interface State {
  status: 'idle' | 'streaming' | 'done' | 'error';
  text: string;
  citations: ChatCitation[];
  segments: MessageSegment[];
  error?: string;
}

export function useSSE() {
  const [state, setState] = useState<State>({
    status: 'idle',
    text: '',
    citations: [],
    segments: [],
  });
  const abortRef = useRef<AbortController | null>(null);
  const textBufferRef = useRef('');
  const segmentsRef = useRef<MessageSegment[]>([]);
  const rafRef = useRef<number | null>(null);

  // 把文本增量追加到「当前文本片段」；若上一片段是工具调用，则开启新文本片段（实现交错顺序）
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
      payload: AnswerStreamPayload,
      onDoneFinalText?: (text: string, citations: ChatCitation[]) => void,
    ) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      textBufferRef.current = '';
      segmentsRef.current = [];
      setState({ status: 'streaming', text: '', citations: [], segments: [] });

      let citations: ChatCitation[] = [];
      await streamAnswer(
        payload,
        {
          onCitations: (cs) => {
            citations = cs;
            setState((s) => ({ ...s, citations: cs }));
          },
          onDelta: (delta) => {
            textBufferRef.current += delta;
            appendText(delta);
            scheduleFlush();
          },
          onToolCall: (calls) => {
            for (const c of calls) {
              const idx = segmentsRef.current.findIndex(
                (s) => s.type === 'tool' && s.call.id === c.id,
              );
              const seg: MessageSegment = {
                type: 'tool',
                call: { id: c.id, name: c.name, desc: c.desc, input: c.input, status: 'running' },
              };
              if (idx >= 0) segmentsRef.current[idx] = seg;
              else segmentsRef.current.push(seg);
            }
            commit();
          },
          onToolResult: (results) => {
            for (const r of results) {
              const idx = segmentsRef.current.findIndex(
                (s) => s.type === 'tool' && s.call.id === r.id,
              );
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
          onError: (e) => {
            setState((s) => ({ ...s, status: 'error', error: e.message }));
          },
          onDone: () => {
            if (rafRef.current != null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            const finalText = textBufferRef.current;
            setState({
              status: 'done',
              text: finalText,
              citations,
              segments: [...segmentsRef.current],
            });
            onDoneFinalText?.(finalText, citations);
          },
        },
        ctrl.signal,
      );
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
    setState({ status: 'idle', text: '', citations: [], segments: [] });
  }, []);

  return { ...state, start, abort, reset };
}
