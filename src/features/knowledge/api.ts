import { del, get, post, upload, httpClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import type { KbChunk, KbDocument, KnowledgeBase, SearchHit } from '@/api/types';

const baseURL = import.meta.env.VITE_API_BASE || '/data';

export const kbApi = {
  list: () => get<KnowledgeBase[]>('/rag/kb'),
  detail: (id: string) => get<KnowledgeBase>(`/rag/kb/${id}`),
  create: (payload: { name: string; description?: string }) =>
    post<KnowledgeBase>('/rag/kb', payload),
  delete: (id: string) => del<void>(`/rag/kb/${id}`),
};

export const docApi = {
  list: (kbId: string) => get<KbDocument[]>(`/rag/kb/${kbId}/documents`),
  detail: (docId: string) => get<KbDocument>(`/rag/documents/${docId}`),
  upload: (kbId: string, file: File, rowPerChunk = false) =>
    upload<KbDocument>(`/rag/kb/${kbId}/documents`, file, 'file', {
      rowPerChunk: String(rowPerChunk),
    }),
  delete: (docId: string) => del<void>(`/rag/documents/${docId}`),
  retry: (docId: string) => post<void>(`/rag/documents/${docId}/retry`),
  chunks: (docId: string) => get<KbChunk[]>(`/rag/documents/${docId}/chunks`),
};

/**
 * 取文档原始文件 → Blob。预览端点经网关需带 Authorization / X-Tenant-Id 头，
 * 不能用裸 <iframe src>，这里用 fetch 取流再生成 object URL（与 agentFiles 同套鉴权）。
 * blob.type 即后端按文件后缀给出的 Content-Type，前端据此决定如何渲染。
 */
export async function fetchDocPreviewBlob(docId: string): Promise<Blob> {
  const { token, tenantId } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = token;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  const resp = await fetch(`${baseURL}/rag/documents/${docId}/preview`, { headers });
  if (!resp.ok) throw new Error(`预览失败 HTTP ${resp.status}`);
  return resp.blob();
}

export const searchApi = {
  search: (payload: { kbId: string; query: string; topK?: number; rerank?: boolean }) =>
    post<SearchHit[]>('/rag/search', payload),
};

export async function uploadMany(kbId: string, files: File[]) {
  const results: KbDocument[] = [];
  for (const f of files) {
    const r = await httpClient.post<KbDocument>(
      `/rag/kb/${kbId}/documents`,
      (() => {
        const fd = new FormData();
        fd.append('file', f);
        return fd;
      })(),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    results.push(r.data);
  }
  return results;
}
