import { del, get, post, put } from '@/api/client';
import type { Agent, EntityStatus } from '@/api/types';

/** GET /agents/{id}/plugins 返回的是「绑定关系行」(AgentPlugin)，不是 Plugin 本身 */
export interface AgentPluginBinding {
  id: string;
  agentId: string;
  pluginId: string;
}

/**
 * 后端 presetQuestions 列是 json，实体字段为 String，故 wire 上是 JSON 数组字符串。
 * 在 API 边界双向转换（同 plugin/api.ts 的做法）：读时 string → string[]，写时 string[] → string。
 */
type AgentWire = Omit<Agent, 'presetQuestions'> & { presetQuestions?: string | string[] };

function fromWire(a: AgentWire): Agent {
  let preset: string[] | undefined;
  const raw = a.presetQuestions;
  if (Array.isArray(raw)) {
    preset = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) preset = parsed.filter((q) => typeof q === 'string');
    } catch {
      preset = undefined;
    }
  }
  return { ...(a as Agent), presetQuestions: preset };
}

/**
 * 解析 Agent 绑定的知识库数量（空状态能力胶囊「N 个知识库」用）。
 * kbConfig 是 {kbIds, topK, scoreThreshold, rerank} 的 JSON 字符串，取 kbIds 长度，解析失败按 0。
 * 对话页与调试台空状态共用，避免两处重复同一段解析。
 */
export function parseKbCount(kbConfig?: string): number {
  if (!kbConfig) return 0;
  try {
    const ids = JSON.parse(kbConfig)?.kbIds;
    return Array.isArray(ids) ? ids.length : 0;
  } catch {
    return 0;
  }
}

function toWire(payload: Partial<Agent>): Record<string, unknown> {
  if (!('presetQuestions' in payload)) return payload as Record<string, unknown>;
  const list = (payload.presetQuestions ?? []).map((q) => q.trim()).filter(Boolean);
  return { ...payload, presetQuestions: JSON.stringify(list) };
}

export const agentApi = {
  list: (status?: EntityStatus) =>
    get<AgentWire[]>('/admin/agent/agents', { status }).then((rows) => rows.map(fromWire)),
  detail: (id: string) => get<AgentWire>(`/admin/agent/agents/${id}`).then(fromWire),
  create: (payload: Partial<Agent>) =>
    post<AgentWire>('/admin/agent/agents', toWire(payload)).then(fromWire),
  update: (id: string, payload: Partial<Agent>) =>
    put<AgentWire>(`/admin/agent/agents/${id}`, toWire(payload)).then(fromWire),
  delete: (id: string) => del<void>(`/admin/agent/agents/${id}`),
  publish: (id: string) => post<AgentWire>(`/admin/agent/agents/${id}/publish`).then(fromWire),
  unpublish: (id: string) => post<AgentWire>(`/admin/agent/agents/${id}/unpublish`).then(fromWire),

  listPlugins: (id: string) => get<AgentPluginBinding[]>(`/admin/agent/agents/${id}/plugins`),
  bindPlugin: (id: string, pluginId: string) =>
    post<void>(`/admin/agent/agents/${id}/plugins`, { pluginId }),
  unbindPlugin: (id: string, pluginId: string) =>
    del<void>(`/admin/agent/agents/${id}/plugins/${pluginId}`),
};
