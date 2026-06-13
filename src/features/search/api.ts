import { get } from '@/api/client';
import type { GlobalSearchResult } from './types';

export const searchApi = {
  /** 全局搜索：每类返回少量命中用于快速跳转。q 为空时后端直接返回空结果。 */
  global: (q: string, limit = 5) => get<GlobalSearchResult>('/admin/search', { q, limit }),
};
