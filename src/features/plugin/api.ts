import { del, get, post, put } from '@/api/client';
import type {
  Plugin,
  PluginCredential,
  PluginHttpMapping,
  PluginTool,
  EntityStatus,
  HttpMethod,
} from '@/api/types';

// ── 线上格式 (wire) ⇄ 前端模型 (model) 转换 ──────────────────────────────
// 后端 ToolWithMapping DTO 形如 { tool, mapping }；其中 inputSchema / headersTemplate
// 是 JSON 字符串列，bodyContentType 是真实 MIME，而前端用对象 + bodyType 枚举更便于编辑。
// 若直接把对象发给后端，Jackson 会抛 HttpMessageNotReadableException →
// “请求体格式错误，无法解析”。因此在 API 边界统一做双向转换。

interface ToolWire {
  id?: string | number;
  pluginId?: string | number;
  name: string;
  description?: string;
  inputSchema?: string;
  enabled?: boolean;
}

interface MappingWire {
  id?: string | number;
  pluginToolId?: string | number;
  method: string;
  urlTemplate: string;
  headersTemplate?: string;
  queryTemplate?: string;
  bodyTemplate?: string;
  bodyContentType?: string;
  responseExtract?: string;
  responseMaxItems?: number;
}

export interface ToolSavePayload {
  name: string;
  description?: string;
  enabled: boolean;
  inputSchema?: Record<string, unknown>;
  mapping: PluginHttpMapping;
}

function jsonStringIfAny(obj?: Record<string, unknown>): string | undefined {
  return obj && Object.keys(obj).length > 0 ? JSON.stringify(obj) : undefined;
}

function parseJsonObject<T extends Record<string, unknown>>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function toolToWire(p: ToolSavePayload): ToolWire {
  return {
    name: p.name,
    description: p.description,
    enabled: p.enabled,
    inputSchema:
      p.inputSchema && Object.keys(p.inputSchema).length > 0
        ? JSON.stringify(p.inputSchema)
        : undefined,
  };
}

function toolFromWire(w: ToolWire): PluginTool {
  return {
    id: String(w.id ?? ''),
    pluginId: String(w.pluginId ?? ''),
    name: w.name,
    description: w.description,
    enabled: Boolean(w.enabled),
    inputSchema: parseJsonObject(w.inputSchema),
  };
}

function mappingToWire(m: PluginHttpMapping): MappingWire {
  return {
    method: m.method,
    urlTemplate: m.urlTemplate,
    headersTemplate: jsonStringIfAny(m.headersTemplate),
    queryTemplate: jsonStringIfAny(m.queryTemplate),
    bodyTemplate: m.bodyTemplate || undefined,
    bodyContentType: m.bodyContentType || undefined,
    responseExtract: m.responseExtract || undefined,
  };
}

function mappingFromWire(w: MappingWire): PluginHttpMapping {
  return {
    id: w.id != null ? String(w.id) : undefined,
    pluginToolId: w.pluginToolId != null ? String(w.pluginToolId) : undefined,
    method: (w.method as HttpMethod) || 'GET',
    urlTemplate: w.urlTemplate ?? '',
    headersTemplate: parseJsonObject<Record<string, string>>(w.headersTemplate) ?? {},
    queryTemplate: parseJsonObject<Record<string, string>>(w.queryTemplate) ?? {},
    bodyTemplate: w.bodyTemplate,
    bodyContentType: w.bodyContentType,
    responseExtract: w.responseExtract,
    responseMaxItems: w.responseMaxItems,
  };
}

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
    get<ToolWire[]>(`/admin/plugin/plugins/${pluginId}/tools`).then((tools) =>
      (tools ?? []).map(toolFromWire),
    ),
  create: (pluginId: string, payload: ToolSavePayload) =>
    post<ToolWire>(`/admin/plugin/plugins/${pluginId}/tools`, {
      tool: toolToWire(payload),
      mapping: mappingToWire(payload.mapping),
    }).then(toolFromWire),
  update: (pluginId: string, toolId: string, payload: ToolSavePayload) =>
    put<ToolWire>(`/admin/plugin/plugins/${pluginId}/tools/${toolId}`, {
      tool: toolToWire(payload),
      mapping: mappingToWire(payload.mapping),
    }).then(toolFromWire),
  delete: (pluginId: string, toolId: string) =>
    del<void>(`/admin/plugin/plugins/${pluginId}/tools/${toolId}`),
  mapping: (pluginId: string, toolId: string) =>
    get<MappingWire | null>(
      `/admin/plugin/plugins/${pluginId}/tools/${toolId}/mapping`,
    ).then((w) => (w ? mappingFromWire(w) : null)),
};

// 凭证同理：后端 PluginCredential.credentialData 是明文 JSON 字符串列
// （encryption_version=0），前端模型用 credentialJson 对象，边界处转换。
interface CredentialWire {
  id?: string | number;
  pluginId?: string | number;
  ownerId?: string;
  credentialData?: string;
  encryptionVersion?: number;
}

function credentialFromWire(w: CredentialWire | null): PluginCredential | null {
  if (!w) return null;
  return {
    id: String(w.id ?? ''),
    pluginId: String(w.pluginId ?? ''),
    credentialJson: parseJsonObject(w.credentialData) ?? {},
  };
}

export const pluginCredApi = {
  get: (pluginId: string) =>
    get<CredentialWire | null>(`/admin/plugin/plugins/${pluginId}/credential`).then(
      credentialFromWire,
    ),
  save: (pluginId: string, payload: { credentialJson?: Record<string, unknown> }) =>
    put<CredentialWire>(`/admin/plugin/plugins/${pluginId}/credential`, {
      credentialData:
        payload.credentialJson && Object.keys(payload.credentialJson).length > 0
          ? JSON.stringify(payload.credentialJson)
          : undefined,
    }).then((w) => credentialFromWire(w) as PluginCredential),
};

export interface TestPayload {
  toolId: string;
  input: Record<string, unknown>;
}

export interface TestResult {
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  /** 渲染后的等价 curl 命令 */
  curl?: string;
  /** 第三方返回的 HTTP 状态码 */
  status?: number;
  /** 原始响应体 */
  response?: string;
  /** 按「输出参数」抽取后的结果（或错误对象） */
  extracted?: unknown;
  /** 前端网络/接口层错误 */
  error?: string;
}

export const pluginTestApi = {
  test: (pluginId: string, payload: TestPayload) =>
    post<TestResult>(`/admin/plugin/plugins/${pluginId}/test`, payload),
};
