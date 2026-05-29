import { del, get, post, put } from '@/api/client';
import type { Agent, EntityStatus, Plugin } from '@/api/types';

export const agentApi = {
  list: (status?: EntityStatus) => get<Agent[]>('/admin/agent/agents', { status }),
  detail: (id: string) => get<Agent>(`/admin/agent/agents/${id}`),
  create: (payload: Partial<Agent>) => post<Agent>('/admin/agent/agents', payload),
  update: (id: string, payload: Partial<Agent>) =>
    put<Agent>(`/admin/agent/agents/${id}`, payload),
  delete: (id: string) => del<void>(`/admin/agent/agents/${id}`),
  publish: (id: string) => post<Agent>(`/admin/agent/agents/${id}/publish`),
  unpublish: (id: string) => post<Agent>(`/admin/agent/agents/${id}/unpublish`),

  listPlugins: (id: string) => get<Plugin[]>(`/admin/agent/agents/${id}/plugins`),
  bindPlugin: (id: string, pluginId: string) =>
    post<void>(`/admin/agent/agents/${id}/plugins`, { pluginId }),
  unbindPlugin: (id: string, pluginId: string) =>
    del<void>(`/admin/agent/agents/${id}/plugins/${pluginId}`),
};
