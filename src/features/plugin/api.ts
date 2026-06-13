import { del, get, post, put, upload } from '@/api/client';
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
  title?: string;
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
  title?: string;
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
    title: p.title,
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
    title: w.title,
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
    get<MappingWire | null>(`/admin/plugin/plugins/${pluginId}/tools/${toolId}/mapping`).then(
      (w) => (w ? mappingFromWire(w) : null),
    ),
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

/** 「测试获取」结果：成功回 httpStatus + rawBody + parsedJson + durationMs；失败只回 error */
export interface AuthTestFetchResult {
  httpStatus?: number;
  rawBody?: string;
  /** 已解析的响应对象树（供点选字段）；非 JSON 时为空 */
  parsedJson?: unknown;
  durationMs?: number;
  /** 业务/配置错误（凭证缺失、URL 非法、第三方报错等） */
  error?: string;
}

export const pluginAuthApi = {
  /**
   * 用已存凭证真实调一次换 token 接口，原样回传响应供点选字段（仅 OAUTH2 / TOKEN_FETCH）。
   * 传草稿 authType/authConfig，使「改了认证方式但还没保存」也能直接测。
   */
  testFetch: (pluginId: string, authConfig?: string, authType?: string) =>
    post<AuthTestFetchResult>(`/admin/plugin/plugins/${pluginId}/auth/test-fetch`, {
      authConfig,
      authType,
    }),
};

// ── AI 生成 / 微调：后端 /admin/plugin/ai/* 返回的「插件草稿」传输模型 ──────────
// 这是与编辑器无关的中间结构；转成 FieldDef[]+HttpForm 在 utils/toolSpec.ts 做。

export interface AiParamSpec {
  name: string;
  /** string | number | boolean | object | array */
  type: string;
  description?: string;
  required?: boolean;
  /** query | body | path */
  location?: string;
  enumValues?: string[];
  fields?: AiParamSpec[];
  itemType?: string;
  itemFields?: AiParamSpec[];
}

export interface AiOutputSpec {
  name: string;
  type?: string;
  description?: string;
}

export interface AiToolSpec {
  name: string;
  /** 中文展示名（给人看）；name 仍是英文函数名（供 LLM 调用/路由）。 */
  title?: string;
  description?: string;
  method: string;
  path: string;
  params?: AiParamSpec[];
  headers?: { key: string; value: string }[];
  bodyContentType?: string;
  outputs?: AiOutputSpec[];
  warnings?: string[];
}

export interface PluginDraftMeta {
  name?: string;
  description?: string;
  baseUrl?: string;
  auth?: { type?: string; in?: string; name?: string; notes?: string };
}

export interface PluginDraft {
  plugin: PluginDraftMeta;
  tools: AiToolSpec[];
  warnings?: string[];
}

export interface GenerateInput {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
  docUrl?: string;
  /** 「自动跑完整份文档」分批时：一批具体接口文档链接 */
  docUrls?: string[];
}

// AI 调用是长耗时 LLM 操作（贴整份 OpenAPI 文档可能跑几十秒），单独放宽到 3 分钟，
// 否则会被 axios 默认 30s 超时掐断（timeout of 30000ms exceeded）。
const AI_TIMEOUT = 180_000;

export const pluginAiApi = {
  generate: (body: GenerateInput) =>
    post<PluginDraft>('/admin/plugin/ai/generate', body, { timeout: AI_TIMEOUT }),
  /** 列出文档索引(llms.txt)里的全部接口链接，供「自动跑完整份文档」分批 */
  listEndpoints: (docUrl: string) =>
    post<{ links: string[] }>(
      '/admin/plugin/ai/list-endpoints',
      { docUrl },
      { timeout: AI_TIMEOUT },
    ),
  generateUpload: (file: File) =>
    upload<PluginDraft>('/admin/plugin/ai/generate/upload', file, 'file', undefined, {
      timeout: AI_TIMEOUT,
    }),
  refine: (body: {
    draft: PluginDraft;
    instruction: string;
    history?: { role: string; text: string }[];
  }) =>
    post<{ draft: PluginDraft; reply: string }>('/admin/plugin/ai/refine', body, {
      timeout: AI_TIMEOUT,
    }),
};
