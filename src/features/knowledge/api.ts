import { del, get, post, upload, httpClient } from '@/api/client';
import type { KbDocument, KnowledgeBase, SearchHit } from '@/api/types';

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
  upload: (kbId: string, file: File) => upload<KbDocument>(`/rag/kb/${kbId}/documents`, file),
  delete: (docId: string) => del<void>(`/rag/documents/${docId}`),
  retry: (docId: string) => post<void>(`/rag/documents/${docId}/retry`),
};

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
