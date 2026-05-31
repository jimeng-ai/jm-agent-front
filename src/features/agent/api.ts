import { del, get, post, put } from '@/api/client';
import type { Agent, EntityStatus } from '@/api/types';

/** GET /agents/{id}/plugins 返回的是「绑定关系行」(AgentPlugin)，不是 Plugin 本身 */
export interface AgentPluginBinding {
  id: string;
  agentId: string;
  pluginId: string;
}

export const agentApi = {
  list: (status?: EntityStatus) => get<Agent[]>('/admin/agent/agents', { status }),
  detail: (id: string) => get<Agent>(`/admin/agent/agents/${id}`),
  create: (payload: Partial<Agent>) => post<Agent>('/admin/agent/agents', payload),
  update: (id: string, payload: Partial<Agent>) =>
    put<Agent>(`/admin/agent/agents/${id}`, payload),
  delete: (id: string) => del<void>(`/admin/agent/agents/${id}`),
  publish: (id: string) => post<Agent>(`/admin/agent/agents/${id}/publish`),
  unpublish: (id: string) => post<Agent>(`/admin/agent/agents/${id}/unpublish`),

  listPlugins: (id: string) => get<AgentPluginBinding[]>(`/admin/agent/agents/${id}/plugins`),
  bindPlugin: (id: string, pluginId: string) =>
    post<void>(`/admin/agent/agents/${id}/plugins`, { pluginId }),
  unbindPlugin: (id: string, pluginId: string) =>
    del<void>(`/admin/agent/agents/${id}/plugins/${pluginId}`),
};
