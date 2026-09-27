import { del, get, post, upload } from '@/api/client';
import type { SkillView, SkillDetailView } from './types';

export const skillApi = {
  list: (mine?: boolean) =>
    get<SkillView[]>('/tenant/skills', mine !== undefined ? { mine } : undefined),

  get: (id: string) => get<SkillDetailView>(`/tenant/skills/${id}`),

  upload: (file: File) => upload<SkillView>('/tenant/skills/upload', file, 'file'),

  share: (id: string) => post<void>(`/tenant/skills/${id}/share`),
  unshare: (id: string) => post<void>(`/tenant/skills/${id}/unshare`),
  enable: (id: string) => post<void>(`/tenant/skills/${id}/enable`),
  disable: (id: string) => post<void>(`/tenant/skills/${id}/disable`),
  remove: (id: string) => del<void>(`/tenant/skills/${id}`),

  /** 从 GitHub 导入（后端拉 owner/repo@ref 的 tarball，取 path 下的 skill 目录）。 */
  importFromGithub: (req: { owner: string; repo: string; ref?: string; path?: string }) =>
    post<SkillView>('/tenant/skills/import', req),
};
