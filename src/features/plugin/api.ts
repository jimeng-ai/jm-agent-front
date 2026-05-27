import { del, get, post, put } from '@/api/client';
import type {
  Plugin,
  PluginCredential,
  PluginHttpMapping,
  PluginTool,
  EntityStatus,
} from '@/api/types';

export const pluginApi = {
  list: (status?: EntityStatus) => get<Plugin[]>('/admin/plugin/plugins', { status }),
  detail: (id: string) => get<Plugin>(`/admin/plugin/plugins/${id}`),
  create: (payload: Partial<Plugin>) => post<Plugin>('/admin/plugin/plugins', payload),
  update: (id: string, payload: Partial<Plugin>) =>
    put<Plugin>(`/admin/plugin/plugins/${id}`, payload),
  delete: (id: string) => del<void>(`/admin/plugin/plugins/${id}`),
  publish: (id: string) => post<Plugin>(`/admin/plugin/plugins/${id}/publish`),
  unpublish: (id: string) => post<Plugin>(`/admin/plugin/plugins/${id}/unpublish`),
  refresh: () => post<void>('/admin/plugin/plugins/_refresh'),
};

export const pluginToolApi = {
  list: (pluginId: string) =>
    get<PluginTool[]>(`/admin/plugin/plugins/${pluginId}/tools`),
  create: (pluginId: string, payload: Partial<PluginTool> & { mapping?: PluginHttpMapping }) =>
    post<PluginTool>(`/admin/plugin/plugins/${pluginId}/tools`, payload),
  update: (pluginId: string, toolId: string, payload: Partial<PluginTool> & { mapping?: PluginHttpMapping }) =>
    put<PluginTool>(`/admin/plugin/plugins/${pluginId}/tools/${toolId}`, payload),
  delete: (pluginId: string, toolId: string) =>
    del<void>(`/admin/plugin/plugins/${pluginId}/tools/${toolId}`),
  mapping: (pluginId: string, toolId: string) =>
    get<PluginHttpMapping>(`/admin/plugin/plugins/${pluginId}/tools/${toolId}/mapping`),
};

export const pluginCredApi = {
  list: (pluginId: string) =>
    get<PluginCredential[]>(`/admin/plugin/plugins/${pluginId}/credentials`),
  create: (pluginId: string, payload: Partial<PluginCredential>) =>
    post<PluginCredential>(`/admin/plugin/plugins/${pluginId}/credentials`, payload),
  update: (pluginId: string, credentialId: string, payload: Partial<PluginCredential>) =>
    put<PluginCredential>(
      `/admin/plugin/plugins/${pluginId}/credentials/${credentialId}`,
      payload,
    ),
  delete: (pluginId: string, credentialId: string) =>
    del<void>(`/admin/plugin/plugins/${pluginId}/credentials/${credentialId}`),
};

export interface TestPayload {
  toolId: string;
  input: Record<string, unknown>;
  credentialAlias?: string;
}

export interface TestResult {
  request?: unknown;
  response?: unknown;
  extracted?: unknown;
  error?: string;
}

export const pluginTestApi = {
  test: (pluginId: string, payload: TestPayload) =>
    post<TestResult>(`/admin/plugin/plugins/${pluginId}/test`, payload),
};
