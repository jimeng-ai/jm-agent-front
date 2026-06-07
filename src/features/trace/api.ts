import { get, httpClient } from '@/api/client';
import type { PageResult, TraceLog, TraceOverview, TraceQuery, TraceReplay } from './types';

const BASE = '/admin/trace';

export const traceApi = {
  list: (q: TraceQuery) => get<PageResult<TraceLog>>(BASE, q as Record<string, unknown>),
  detail: (traceId: string) => get<TraceLog>(`${BASE}/${encodeURIComponent(traceId)}`),
  overview: (q: Pick<TraceQuery, 'start' | 'end'>) =>
    get<TraceOverview>(`${BASE}/overview`, q as Record<string, unknown>),
  replay: (traceId: string) => get<TraceReplay>(`${BASE}/${encodeURIComponent(traceId)}/replay`),
};

/**
 * 按当前筛选下载 CSV。走 axios（自动带 Authorization / X-Tenant-Id），
 * 拿到 blob 后触发浏览器下载。blob 响应不会被响应拦截器解包。
 */
export async function downloadTracesCsv(q: TraceQuery): Promise<void> {
  const params: Record<string, unknown> = {};
  if (q.start != null) params.start = q.start;
  if (q.end != null) params.end = q.end;
  if (q.status) params.status = q.status;
  if (q.keyword) params.keyword = q.keyword;
  const resp = await httpClient.get(`${BASE}/export`, { params, responseType: 'blob' });
  triggerBlobDownload(resp.data as Blob, `traces-${Date.now()}.csv`);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
