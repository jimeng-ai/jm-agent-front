import { del, get, post, put } from '@/api/client';
import type { Agent, EntityStatus } from '@/api/types';

/** GET /agents/{id}/skills 返回的是「绑定关系行」(AgentSkill)，不是 Skill 本身。id 均为字符串。 */
export interface AgentSkillBinding {
  id: string;
  agentId: string;
  skillId: string;
}

/**
 * Agent ↔ 连接器授权行。后端返回的是关系行（AgentConnection），要取其中的 connectionId
 * 才能和连接器列表的 id 对上——与 AgentSkillBinding 同构。
 *
 * 注意字段名是 connectionId 不是 connectorId：底层就是同一张 connection 表，
 * 「连接器」只是它类型感知之后的说法。
 */
export interface AgentConnectionBinding {
  id: string;
  agentId: string;
  connectionId: string;
}

/**
 * 后端 presetQuestions 列是 json，实体字段为 String，故 wire 上是 JSON 数组字符串。
 * 在 API 边界双向转换：读时 string → string[]，写时 string[] → string。
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

  // 技能绑定：后端返回绑定关系行(AgentSkill)，绑定/解绑均幂等，skillId 为字符串。
  listSkills: (id: string) => get<AgentSkillBinding[]>(`/admin/agent/agents/${id}/skills`),
  bindSkill: (id: string, skillId: string) =>
    post<void>(`/admin/agent/agents/${id}/skills`, { skillId }),
  unbindSkill: (id: string, skillId: string) =>
    del<void>(`/admin/agent/agents/${id}/skills/${skillId}`),

  // 连接器授权：与技能绑定形状一致，但【授予/撤销限企业超管】（后端 requireSuperAdmin）——
  // 授予连接 = 让这个 Agent 能以某个身份访问客户的生产系统，比绑技能重得多。
  // 列出（listConnections）不限超管，只要有该 Agent 的实例权限。
  listConnections: (id: string) =>
    get<AgentConnectionBinding[]>(`/admin/agent/agents/${id}/connections`),
  grantConnection: (id: string, connectionId: string) =>
    post<void>(`/admin/agent/agents/${id}/connections`, { connectionId }),
  revokeConnection: (id: string, connectionId: string) =>
    del<void>(`/admin/agent/agents/${id}/connections/${connectionId}`),
};

/** GET /data/admin/models 返回项；与调试台模型下拉 option 结构一致（value/label + maxTemp）。 */
export interface ModelOption {
  value: string;
  label: string;
  provider: string;
  maxTemp: number;
  description?: string;
}

/**
 * 拉取可选模型目录（单一真相源）。后端 maxTemp 可能按字符串下发（见 jm-api-numbers-as-strings），
 * 这里 Number() 兜底。
 */
export async function getModelCatalog(): Promise<ModelOption[]> {
  const rows = await get<ModelOption[]>('/admin/models');
  return (rows ?? []).map((m) => ({
    value: m.value,
    label: m.label,
    provider: m.provider,
    maxTemp: Number(m.maxTemp ?? 2),
    description: m.description,
  }));
}
