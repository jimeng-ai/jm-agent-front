import { useAuthStore } from '@/stores/authStore';
import { redirectToLogin } from '@/api/client';

const baseURL = import.meta.env.VITE_API_BASE || '/data';

export interface SseHandlers {
  onOpen?: () => void;
  onEvent?: (event: string, data: string) => void;
  onMessage?: (text: string) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export interface StreamOptions extends SseHandlers {
  signal?: AbortSignal;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
}

interface SseFrame {
  event: string;
  data: string;
}

function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer;
  let idx = rest.indexOf('\n\n');
  while (idx !== -1) {
    const chunk = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (!line) continue;
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length) {
      frames.push({ event, data: dataLines.join('\n') });
    }
    idx = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

export async function streamSse(url: string, body: unknown, opts: StreamOptions = {}): Promise<void> {
  const { token, tenantId } = useAuthStore.getState();
  const fullUrl = url.startsWith('http') ? url : `${baseURL}${url}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...opts.headers,
  };
  if (token) headers['Authorization'] = token;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      method: opts.method ?? 'POST',
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      opts.onDone?.();
      return;
    }
    opts.onError?.(e as Error);
    return;
  }

  if (!response.ok || !response.body) {
    // 流式接口走原始 fetch，不经 axios 拦截器；这里手动复用同一套登出逻辑，
    // 让被禁用 / 掉线的成员在纯 SSE 场景也会被踢回登录页（与 client.ts 拦截器一致）。
    if (response.status === 401 || response.status === 403) {
      redirectToLogin('登录已过期，请重新登录');
    }
    opts.onError?.(new Error(`SSE 请求失败 HTTP ${response.status}`));
    return;
  }

  opts.onOpen?.();

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;
      for (const f of frames) {
        opts.onEvent?.(f.event, f.data);
        if (f.event === 'message') opts.onMessage?.(f.data);
      }
    }
    opts.onDone?.();
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      opts.onDone?.();
      return;
    }
    opts.onError?.(e as Error);
  } finally {
    reader.releaseLock();
  }
}
