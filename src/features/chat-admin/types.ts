import type { ChatCitation } from '@/api/types';
import { nanoid } from 'nanoid';

export type ChatStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';

export type ToolCallStatus = 'running' | 'success' | 'error';

/** 一次工具调用在对话里的可视化状态（来自 SSE progress / tool_result 事件） */
export interface ToolCallView {
  id: string;
  name: string;
  /** 工具描述（如「根据城市查询天气」） */
  desc?: string;
  /** 入参 */
  input?: unknown;
  status: ToolCallStatus;
  /** 工具输出（如 Bash stdout/stderr），来自代码执行 Agent 的 code_output 事件；
   *  generate_image 输出为 { urls, model, size, count }；activate_skills 输出为 { activated:[名称] }。 */
  output?:
    | string
    | { urls?: string[]; model?: string; size?: string; count?: number; activated?: string[] };
}

/** 代码执行 Agent 产出的可下载产物（来自 SSE artifact 事件，已由后端改写 downloadUrl） */
export interface ArtifactRef {
  artifactId: string | number;
  filename: string;
  contentType?: string;
  sizeBytes?: string | number;
  downloadUrl?: string;
}

/** 助手消息的有序片段：文本 / 工具调用 / 产物，按真实发生顺序交错（叙述 → 工具 → 产物 → 答案） */
export type MessageSegment =
  | { type: 'text'; text: string }
  | { type: 'tool'; call: ToolCallView }
  | { type: 'artifact'; artifact: ArtifactRef };

/** 用户消息携带的上传附件（缩略图/预览用）。url 为本地 object URL：会话内有效，
 *  刷新后失效（要持久化预览需后端提供按 fileId 取输入文件的接口）。 */
export interface ChatAttachment {
  fileId: string | number;
  filename: string;
  contentType?: string;
  url?: string;
  /** 上传进行中：缩略图先用本地 url 占位并显示 loading；上传完成后置 false 并换成真实 fileId */
  uploading?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  /** 有序片段（叙述 → 工具 → 答案）；含工具调用时落库，刷新后据此还原过程。无 segments 时回退渲染 content */
  segments?: MessageSegment[];
  /** 用户消息的上传附件（图片显示缩略图、文档显示文件块），会话内预览用 */
  attachments?: ChatAttachment[];
  /** 本轮助手回答总耗时（毫秒）；仅 assistant 消息有值 */
  elapsedMs?: number;
  status?: ChatStatus;
  errorMessage?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  agentId?: string;
  kbId?: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export function createSession(agentId?: string): ChatSession {
  return {
    id: nanoid(),
    title: '新会话',
    agentId,
    messages: [],
    updatedAt: Date.now(),
  };
}

export function newMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: nanoid(),
    role,
    content,
    status: role === 'assistant' ? 'streaming' : 'idle',
    createdAt: Date.now(),
  };
}
