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
  /** 本次调用用户发送的消息 */
  userMessage?: string;
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

/** 回放顶部「步骤耗时条」用的轻量步骤项。 */
export interface TraceReplayStep {
  stepIndex?: Num;
  stepType: StepType;
  title?: string;
  subTitle?: string;
  model?: string;
  durationMs?: Num;
  totalTokens?: Num;
  status?: TraceStatus;
  errorMsg?: string;
  stepTime?: string;
  /** 非 LLM 步骤的扩展信息（已解析的 metadata） */
  metadata?: unknown;
}

/** 回放「执行叙事」单元：用户提问 / 模型输出 / 工具调用(input→output) / 最终回答。 */
export interface TraceReplayTurn {
  kind: 'user' | 'assistant' | 'tool' | 'answer';
  text?: string;
  /** kind=tool：kb(知识库) / skill(技能激活) / plugin(插件工具) */
  toolType?: 'kb' | 'skill' | 'plugin' | 'tool';
  toolName?: string;
  input?: unknown;
  output?: unknown;
  /** 该执行单元耗时(ms) / token，可空 */
  durationMs?: Num;
  tokens?: Num;
  /** 知识库检索卡：rerank 信息 {model, kept, candidates} */
  rerank?: unknown;
}

export interface TraceReplay {
  traceId: string;
  agentName?: string;
  userMessage?: string;
  status: TraceStatus;
  startTime?: string;
  endTime?: string;
  stepCount?: Num;
  totalLatencyMs?: Num;
  totalTokens?: Num;
  system?: string;
  enterpriseName?: string;
  /** 模型调用参数 model/temperature/top_p/max_tokens（存在才有） */
  params?: Record<string, unknown>;
  steps: TraceReplayStep[];
  /** 当前问题之前的对话历史（文本气泡，供「查看历史」弹框） */
  history: TraceReplayTurn[];
  conversation: TraceReplayTurn[];
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
