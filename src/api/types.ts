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

/**
 * MyBatis-Plus 的 Page<T> 序列化形状，后端分页接口一律返回它。
 *
 * 注意 total/size/current/pages 的类型是 `number | string`：data-service 全局开启了
 * write_numbers_as_strings，数值到前端可能是字符串，渲染前统一用 Number() 兜底。
 */
export interface PageResult<T> {
  records: T[];
  total: number | string;
  size: number | string;
  current: number | string;
  pages: number | string;
}

export type EntityStatus = 'DRAFT' | 'PUBLISHED';

export interface BaseEntity {
  id: string;
  tenantId?: string;
  createTime?: string;
  updateTime?: string;
  /** 创建人用户 ID（后端 create_user 列）。用于区分「我创建 / 团队共享」。 */
  createUser?: string;
  /** 创建人显示名（后端读时解析 create_user，非持久化）。 */
  creatorName?: string;
}

export interface AdminUser {
  id: string;
  tenantId: string;
  username: string;
  displayName?: string;
  status?: string;
  userType?: 'SUPER_ADMIN' | 'MEMBER';
}

export interface LoginResult {
  token: string;
  user: AdminUser;
}

/** 当前账号的有效权限（GET /admin/me/permissions）。 */
export interface MePermissions {
  superAdmin: boolean;
  userType?: 'SUPER_ADMIN' | 'MEMBER';
  modules: string[];
  agentIds: string[];
  knowledgeBaseIds: string[];
}

export interface Agent extends BaseEntity {
  code: string;
  name: string;
  description?: string;
  /** 头像 URL（后端字段名为 avatarUrl，对应列 avatar_url）。 */
  avatarUrl?: string;
  systemPrompt?: string;
  model?: string;
  modelParams?:
    | {
        temperature?: number;
        topP?: number;
        maxTokens?: number;
      }
    | string;
  /** 知识库绑定配置 JSON 字符串：{kbIds, topK, scoreThreshold, rerank} */
  kbConfig?: string;
  /**
   * 对话空状态的预设引导问题。后端以 JSON 数组字符串存储，
   * 经 {@link agentApi} 在 API 边界双向转换为字符串数组。
   */
  presetQuestions?: string[];
  status: EntityStatus;
  /** 已发布但实时配置/插件绑定领先于发布快照（即有未发布的草稿改动）。仅 PUBLISHED 时可能为 true。 */
  hasUnpublishedChanges?: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** 知识库索引状态汇总（由后端按文档状态聚合）。 */
export type KbIndexStatus = 'READY' | 'INDEXING' | 'ERROR';

export interface KnowledgeBase extends BaseEntity {
  name: string;
  description?: string;
  // 列表页聚合统计（后端 fillStats 回填；numbers-as-strings → 渲染时用 Number() 兜底）。
  docCount?: number | string;
  chunkCount?: number | string;
  totalSize?: number | string;
  doneCount?: number | string;
  indexStatus?: KbIndexStatus;
}

export type DocStatus =
  | 'STAGED'
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
  /** 文件大小（字节）。后端 Long 因 numbers-as-strings 可能序列化成字符串。 */
  fileSize?: number | string;
  status: DocStatus;
  /** 表格逐行切片：true=xlsx/csv 每数据行独立成 chunk（FAQ 表）。上传时勾选，仅对表格类文件生效。 */
  rowPerChunk?: boolean;
  totalChunks?: number;
  errorMessage?: string;
  createTime?: string;
  updateTime?: string;
}

/** 文档入库后产生的切片。 */
export interface KbChunk {
  id: string;
  chunkId: string;
  docId: string;
  kbId: string;
  chunkIndex: number;
  /** text / table / image / code */
  chunkType?: string;
  /** 例如 "Ch1 > Sec1.2 > Subsection" */
  headingPath?: string;
  pageNum?: number;
  /** 原始切片文本 */
  content: string;
  /** 带 LLM 生成上下文前缀的版本（BM25/embedding 实际使用） */
  contextualizedContent?: string;
  imageUrl?: string;
  tokenCount?: number;
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
  headingPath?: string;
  pageNum?: number;
  /** 统一相关度分（精排分优先，否则 RRF 分）。后端 Hutool 序列化为数字，旧消息可能缺省 */
  score?: number | string;
}

export interface ChatMessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}
