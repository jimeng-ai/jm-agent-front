// 调用日志 · Trace 相关类型。
// 注意：data-service 全局开启 write_numbers_as_strings，数值字段到前端可能是 string，
// 渲染时统一用 utils.num() 兜底。

export type TraceStatus = 'SUCCESS' | 'WARN' | 'ERROR';

export type StepType = 'LLM' | 'KB_SEARCH' | 'RERANK' | 'TOOL_CALL' | 'PLUGIN_TRIGGER';

export type Num = number | string;

export interface TraceStep {
  id: Num;
  traceId: string;
  stepIndex: Num;
  stepType: StepType;
  title?: string;
  subTitle?: string;
  model?: string;
  durationMs?: Num;
  inputTokens?: Num;
  outputTokens?: Num;
  totalTokens?: Num;
  status?: TraceStatus;
  errorMsg?: string;
  refLogId?: Num;
  metadata?: string;
  stepTime?: string;
}

export interface TraceLog {
  id: Num;
  traceId: string;
  tenantId?: string;
  userId?: string;
  agentId?: Num;
  agentName?: string;
  status: TraceStatus;
  stepCount?: Num;
  totalLatencyMs?: Num;
  totalInputTokens?: Num;
  totalOutputTokens?: Num;
  totalTokens?: Num;
  startTime?: string;
  endTime?: string;
  errorMsg?: string;
  createTime?: string;
  /** 详情接口才有 */
  steps?: TraceStep[];
  /** 运营侧才有 */
  enterpriseName?: string;
}

export interface TraceOverview {
  totalCalls: Num;
  avgLatencyMs: Num;
  errorRate: Num;
}

export interface PageResult<T> {
  records: T[];
  total: Num;
  size: Num;
  current: Num;
  pages: Num;
}

export interface TraceQuery {
  page?: number;
  size?: number;
  /** epoch 毫秒 */
  start?: number;
  end?: number;
  status?: TraceStatus;
  keyword?: string;
}
