import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAnswer, type AnswerStreamPayload } from '@/features/chat-admin/api';
import type { ChatCitation } from '@/api/types';

interface State {
  status: 'idle' | 'streaming' | 'done' | 'error';
  text: string;
  citations: ChatCitation[];
  error?: string;
}

export function useSSE() {
  const [state, setState] = useState<State>({ status: 'idle', text: '', citations: [] });
  const abortRef = useRef<AbortController | null>(null);
  const textBufferRef = useRef('');
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    setState((s) => ({ ...s, text: textBufferRef.current }));
  }, []);

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
      setState({ status: 'streaming', text: '', citations: [] });

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
            scheduleFlush();
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
            setState({ status: 'done', text: finalText, citations });
            onDoneFinalText?.(finalText, citations);
          },
        },
        ctrl.signal,
      );
    },
    [scheduleFlush],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    textBufferRef.current = '';
    setState({ status: 'idle', text: '', citations: [] });
  }, []);

  return { ...state, start, abort, reset };
}
