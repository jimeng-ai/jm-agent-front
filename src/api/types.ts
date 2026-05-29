export interface ApiResponse<T = unknown> {
  success: boolean;
  respCode: number | string;
  respMsg: string;
  data: T;
}

export const RESP_CODE = {
  SUCCESS: '200',
  UNAUTHORIZED: '4001',
  NOT_FOUND: '4004',
  SERVER_ERROR: '5000',
  INVALID_REQUEST: '5007',
} as const;

export function isCode(actual: number | string | undefined, expected: string): boolean {
  return actual != null && String(actual) === expected;
}

export class BizError extends Error {
  constructor(
    public code: number | string,
    message: string,
  ) {
    super(message);
    this.name = 'BizError';
  }
}

export interface PageQuery {
  page?: number;
  size?: number;
}

export type EntityStatus = 'DRAFT' | 'PUBLISHED';

export interface BaseEntity {
  id: string;
  tenantId?: string;
  createTime?: string;
  updateTime?: string;
}

export interface AdminUser {
  id: string;
  tenantId: string;
  username: string;
  displayName?: string;
  status?: string;
}

export interface LoginResult {
  token: string;
  user: AdminUser;
}

export interface Agent extends BaseEntity {
  code: string;
  name: string;
  description?: string;
  avatar?: string;
  systemPrompt?: string;
  model?: string;
  modelParams?:
    | {
        temperature?: number;
        topP?: number;
        maxTokens?: number;
      }
    | string;
  /** 知识库绑定配置 JSON 字符串：{kbIds, topK, scoreThreshold} */
  kbConfig?: string;
  status: EntityStatus;
}

export type PluginAuthType = 'NONE' | 'BEARER' | 'BASIC' | 'API_KEY' | 'HMAC';

export interface Plugin extends BaseEntity {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  baseUrl?: string;
  authType?: PluginAuthType;
  authConfig?: string;
  status: EntityStatus;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface PluginHttpMapping {
  id?: string;
  pluginToolId?: string;
  method: HttpMethod;
  urlTemplate: string;
  headersTemplate?: Record<string, string>;
  bodyTemplate?: string;
  bodyType?: 'json' | 'form' | 'urlencoded';
  responseExtract?: string;
}

export interface PluginTool {
  id: string;
  pluginId: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  enabled: boolean;
  mapping?: PluginHttpMapping;
}

export interface PluginCredential {
  id: string;
  pluginId: string;
  credentialJson?: Record<string, unknown>;
}

export interface KnowledgeBase extends BaseEntity {
  name: string;
  description?: string;
}

export type DocStatus =
  | 'UPLOADED'
  | 'PARSING'
  | 'CHUNKING'
  | 'CONTEXTUALIZING'
  | 'EMBEDDING'
  | 'DONE'
  | 'FAILED';

export interface KbDocument {
  id: string;
  kbId: string;
  title: string;
  sourceType?: string;
  minioBucket?: string;
  fileHash?: string;
  fileSize?: number;
  status: DocStatus;
  totalChunks?: number;
  errorMessage?: string;
  createTime?: string;
  updateTime?: string;
}

export interface SearchHit {
  docId: string;
  chunkId: string;
  content: string;
  score: number;
  docTitle?: string;
}

export interface ChatCitation {
  index: number;
  docId: string;
  chunkId: string;
  content: string;
  docTitle?: string;
}

export interface ChatMessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}
