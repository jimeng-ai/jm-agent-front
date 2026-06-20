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
};
