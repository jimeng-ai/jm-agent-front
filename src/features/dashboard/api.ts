import { get } from '@/api/client';

/**
 * 仪表盘统计。数据全部来自后端 ai_model_call_log 的真实聚合（无模拟数据）。
 *
 * 后端把 Long 统一序列化为字符串（避免 JS 精度丢失），因此这里把所有数值字段
 * 都按 `number | string` 接收，并在 normalize 阶段统一转成 number。
 */

type Num = number | string;

interface RawTotals {
  calls: Num;
  tokens: Num;
  inputTokens: Num;
  outputTokens: Num;
  costUsd: Num;
  avgLatencyMs: Num;
  successCalls: Num;
  successRate: Num;
}

interface RawTrendPoint {
  date: string;
  calls: Num;
  tokens: Num;
}

interface RawModelUsage {
  model: string;
  calls: Num;
  tokens: Num;
}

interface RawRecentCall {
  id: Num;
  agentId?: Num | null;
  agentName?: string | null;
  model?: string;
  provider?: string;
  totalTokens?: Num | null;
  latencyMs?: number | null;
  callStatus?: number | null;
  hasTool?: boolean | null;
  toolNames?: string | null;
  errorMsg?: string | null;
  createTime?: string | null;
}

interface RawOverview {
  days: number;
  start: string;
  end: string;
  totals: RawTotals;
  previous: RawTotals;
  trend: RawTrendPoint[];
  topModels: RawModelUsage[];
  /** 全量模型用量（不截断），用于「查看全部」饼图；后端未返回时回退到 topModels。 */
  allModels?: RawModelUsage[];
  recentCalls: RawRecentCall[];
}

export interface DashboardTotals {
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  successCalls: number;
  successRate: number;
}

export interface TrendPoint {
  date: string;
  calls: number;
  tokens: number;
}

export interface ModelUsage {
  model: string;
  calls: number;
  tokens: number;
}

export interface RecentCall {
  id: string;
  agentId: string | null;
  agentName: string | null;
  model: string;
  provider: string;
  totalTokens: number;
  latencyMs: number | null;
  callStatus: number | null;
  hasTool: boolean;
  toolNames: string | null;
  errorMsg: string | null;
  createTime: string | null;
}

export interface DashboardOverview {
  days: number;
  start: string;
  end: string;
  totals: DashboardTotals;
  previous: DashboardTotals;
  trend: TrendPoint[];
  topModels: ModelUsage[];
  allModels: ModelUsage[];
  recentCalls: RecentCall[];
}

const n = (v: Num | null | undefined): number => {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function normalizeTotals(t?: RawTotals): DashboardTotals {
  return {
    calls: n(t?.calls),
    tokens: n(t?.tokens),
    inputTokens: n(t?.inputTokens),
    outputTokens: n(t?.outputTokens),
    costUsd: n(t?.costUsd),
    avgLatencyMs: n(t?.avgLatencyMs),
    successCalls: n(t?.successCalls),
    successRate: n(t?.successRate),
  };
}

function normalize(raw: RawOverview): DashboardOverview {
  return {
    days: raw.days,
    start: raw.start,
    end: raw.end,
    totals: normalizeTotals(raw.totals),
    previous: normalizeTotals(raw.previous),
    trend: (raw.trend ?? []).map((p) => ({
      date: p.date,
      calls: n(p.calls),
      tokens: n(p.tokens),
    })),
    topModels: (raw.topModels ?? []).map((m) => ({
      model: m.model,
      calls: n(m.calls),
      tokens: n(m.tokens),
    })),
    // 后端未返回 allModels 时回退到 topModels，保证「查看全部」饼图始终有数据。
    allModels: (raw.allModels ?? raw.topModels ?? []).map((m) => ({
      model: m.model,
      calls: n(m.calls),
      tokens: n(m.tokens),
    })),
    recentCalls: (raw.recentCalls ?? []).map((c) => ({
      id: String(c.id),
      agentId: c.agentId != null ? String(c.agentId) : null,
      agentName: c.agentName ?? null,
      model: c.model ?? '—',
      provider: c.provider ?? '',
      totalTokens: n(c.totalTokens),
      latencyMs: c.latencyMs ?? null,
      callStatus: c.callStatus ?? null,
      hasTool: !!c.hasTool,
      toolNames: c.toolNames ?? null,
      errorMsg: c.errorMsg ?? null,
      createTime: c.createTime ?? null,
    })),
  };
}

/** 时间窗口入参：传 start/end（yyyy-MM-dd，含端点）走自定义区间；否则按 days 取最近 N 天。 */
export interface OverviewParams {
  days?: number;
  start?: string;
  end?: string;
}

export const dashboardApi = {
  overview: async (params: OverviewParams = {}): Promise<DashboardOverview> => {
    const query =
      params.start && params.end
        ? { start: params.start, end: params.end }
        : { days: params.days ?? 30 };
    const raw = await get<RawOverview>('/admin/stats/overview', query);
    return normalize(raw);
  },
};
