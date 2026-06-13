// 全局搜索（⌘K 命令面板）结果类型。后端把 Long/Integer 序列化成字符串，故 id 用 string。

export interface AgentHit {
  id: string;
  name: string;
  status?: string;
}

export interface DocumentHit {
  id: string;
  title: string;
  kbId: string;
  kbName?: string;
  sourceType?: string;
}

export interface TraceHit {
  traceId: string;
  agentName?: string;
  status?: string;
  /** 后端序列化的时间字符串 "YYYY-MM-DD HH:mm:ss"（也兼容 epoch 数字串） */
  createTime?: string;
}

export interface GlobalSearchResult {
  agents: AgentHit[];
  documents: DocumentHit[];
  traces: TraceHit[];
}

/** 命令面板里被拍平、可键盘上下选择的单条结果。 */
export type SearchItem =
  | { kind: 'agent'; hit: AgentHit }
  | { kind: 'document'; hit: DocumentHit }
  | { kind: 'trace'; hit: TraceHit };
