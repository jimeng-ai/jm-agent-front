import type { DocStatus } from '@/api/types';

export const DOC_STATUS_TEXT: Record<DocStatus, string> = {
  UPLOADED: '已上传',
  PARSING: '解析中',
  CHUNKING: '切片中',
  CONTEXTUALIZING: '上下文化',
  EMBEDDING: '向量化',
  DONE: '已完成',
  FAILED: '失败',
};

export const DOC_STATUS_COLOR: Record<DocStatus, string> = {
  UPLOADED: 'default',
  PARSING: 'processing',
  CHUNKING: 'processing',
  CONTEXTUALIZING: 'processing',
  EMBEDDING: 'processing',
  DONE: 'success',
  FAILED: 'error',
};

export const DOC_STATUS_PROGRESS: Record<DocStatus, number> = {
  UPLOADED: 10,
  PARSING: 30,
  CHUNKING: 50,
  CONTEXTUALIZING: 65,
  EMBEDDING: 85,
  DONE: 100,
  FAILED: 100,
};

export function isPending(status: DocStatus) {
  return status !== 'DONE' && status !== 'FAILED';
}

export function formatBytes(bytes?: number) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
