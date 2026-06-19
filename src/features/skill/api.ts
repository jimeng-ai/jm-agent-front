import { del, get, post, upload } from '@/api/client';
import type { SkillView } from './types';

export interface ImportGithubPayload {
  owner: string;
  repo: string;
  ref: string;
  path?: string;
}

export const skillApi = {
  list: (mine?: boolean) =>
    get<SkillView[]>('/tenant/skills', mine !== undefined ? { mine } : undefined),

  get: (id: string) => get<SkillView>(`/tenant/skills/${id}`),

  upload: (file: File) => upload<SkillView>('/tenant/skills/upload', file, 'file'),

  importGithub: (payload: ImportGithubPayload) => post<SkillView>('/tenant/skills/import', payload),

  share: (id: string) => post<void>(`/tenant/skills/${id}/share`),
  unshare: (id: string) => post<void>(`/tenant/skills/${id}/unshare`),
  enable: (id: string) => post<void>(`/tenant/skills/${id}/enable`),
  disable: (id: string) => post<void>(`/tenant/skills/${id}/disable`),
  remove: (id: string) => del<void>(`/tenant/skills/${id}`),
};
