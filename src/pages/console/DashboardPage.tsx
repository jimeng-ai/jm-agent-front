import { useMemo, useState } from 'react';
import { DatePicker, Modal } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import { pluginApi } from '@/features/plugin/api';
import { kbApi } from '@/features/knowledge/api';
import { dashboardApi } from '@/features/dashboard/api';
import { AreaChart, BarChart, PieChart, Sparkline } from '@/components/atlas/Charts';
import {
  PlusIcon,
  UploadIcon,
  PlayIcon,
  PlugIcon,
  ArrowRightIcon,
} from '@/components/icons/AtlasIcons';

const { RangePicker } = DatePicker;

const STATUS_TEXT: Record<number, { label: string; cls: 'up' | 'down' | 'flat' }> = {
  0: { label: '进行中', cls: 'flat' },
  1: { label: '成功', cls: 'up' },
  2: { label: '失败', cls: 'down' },
};

/** 紧凑数字：1234567 -> 1.23M，12345 -> 12.3K。 */
function compact(v: number): { num: string; unit: string } {
  if (v >= 1_000_000) return { num: (v / 1_000_000).toFixed(2), unit: 'M' };
  if (v >= 1_000) return { num: (v / 1_000).toFixed(1), unit: 'K' };
  return { num: String(Math.round(v)), unit: '' };
}

/** 把一条序列按量级缩放到 M / K，返回缩放后的数据与单位后缀。 */
function scaleSeries(series: number[]): { data: number[]; suffix: string } {
  const max = Math.max(0, ...series);
  if (max >= 1_000_000) return { data: series.map((v) => v / 1_000_000), suffix: 'M' };
  if (max >= 1_000) return { data: series.map((v) => v / 1_000), suffix: 'K' };
  return { data: series, suffix: '' };
}

/** 环比百分比；prev 为 0 时返回 null（无可比基准）。 */
function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** 环比展示；delta 为 null 时显示「—」。lowerIsBetter 用于延迟等指标（下降为好）。 */
function Delta({
  delta,
  suffix = '%',
  lowerIsBetter = false,
}: {
  delta: number | null;
  suffix?: string;
  lowerIsBetter?: boolean;
}) {
  if (delta === null) {
    return <span className="delta flat">—</span>;
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const trend = delta === 0 ? 'flat' : improved ? 'up' : 'down';
  const arrow = delta === 0 ? '→' : delta > 0 ? '↗' : '↘';
  return (
    <span className={`delta ${trend}`}>
      {arrow} {delta > 0 ? '+' : ''}
      {delta.toFixed(1)}
      {suffix}
    </span>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/** 时间选择器预设：今日、近 7 / 30 / 90 天、近半年（精确到天，含端点）。 */
function rangePresets(): { label: string; value: [Dayjs, Dayjs] }[] {
  const today = dayjs();
  const last = (n: number): [Dayjs, Dayjs] => [today.subtract(n - 1, 'day'), today];
  return [
    { label: '今日', value: [today, today] },
    { label: '近 7 天', value: last(7) },
    { label: '近 30 天', value: last(30) },
    { label: '近 90 天', value: last(90) },
    { label: '近半年', value: last(180) },
  ];
}

export default function DashboardPage() {
  const navigate = useNavigate();
  // 时间窗口默认近 30 天；RangePicker 含端点，精确到天。
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, 'day'), dayjs()]);
  // 「模型用量 Top」的「查看全部」弹窗：展示时间范围内全部模型的调用分布（饼图）。
  const [modelsOpen, setModelsOpen] = useState(false);
  const start = range[0].format('YYYY-MM-DD');
  const end = range[1].format('YYYY-MM-DD');
  const days = range[1].diff(range[0], 'day') + 1;

  // 单一数据源 + 起止日期作为 query key：选择器即全局控制整个仪表盘。
  const overviewQ = useQuery({
    queryKey: ['dashboard', 'overview', start, end],
    queryFn: () => dashboardApi.overview({ start, end }),
  });
  const agentQ = useQuery({ queryKey: ['dashboard', 'agents'], queryFn: () => agentApi.list() });
  const pluginQ = useQuery({ queryKey: ['dashboard', 'plugins'], queryFn: () => pluginApi.list() });
  const kbQ = useQuery({ queryKey: ['dashboard', 'kbs'], queryFn: () => kbApi.list() });

  const data = overviewQ.data;
  const totals = data?.totals;
  const prev = data?.previous;

  const agentCount = agentQ.data?.length ?? 0;
  const pluginCount = pluginQ.data?.length ?? 0;
  const kbCount = kbQ.data?.length ?? 0;

  const { labels, tokenChart, callChart, tokenSpark, callSpark } = useMemo(() => {
    const trend = data?.trend ?? [];
    const labels = trend.map((p) => {
      const [, m, d] = p.date.split('-');
      return `${Number(m)}/${Number(d)}`;
    });
    const tokenSeries = trend.map((p) => p.tokens);
    const callSeries = trend.map((p) => p.calls);
    return {
      labels,
      tokenChart: scaleSeries(tokenSeries),
      callChart: scaleSeries(callSeries),
      tokenSpark: tokenSeries.slice(-14),
      callSpark: callSeries.slice(-14),
    };
  }, [data]);

  const tokensC = compact(totals?.tokens ?? 0);
  const callsC = compact(totals?.calls ?? 0);
  const avgLatencySec = (totals?.avgLatencyMs ?? 0) / 1000;
  const prevLatencySec = (prev?.avgLatencyMs ?? 0) / 1000;

  const topModels = data?.topModels ?? [];
  const maxModelCalls = Math.max(1, ...topModels.map((m) => m.calls));
  const recentCalls = data?.recentCalls ?? [];
  // 饼图数据：优先用全量模型，回退到 topModels；按调用次数分布。
  const modelPie = (data?.allModels ?? topModels).map((m) => ({
    label: m.model,
    value: m.calls,
  }));
  const modelPieTotal = modelPie.reduce((s, d) => s + d.value, 0);

  const todayLabel = (() => {
    const d = new Date();
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  })();

  const loading = overviewQ.isLoading;
  const hasData = (totals?.calls ?? 0) > 0;
  const rangeText = String(days);

  const renderChartArea = (chart: { data: number[]; suffix: string }, kind: 'area' | 'bar') => {
    if (loading) {
      return (
        <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>
          加载中…
        </div>
      );
    }
    if (!hasData) {
      return (
        <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>
          该时间范围内暂无调用记录
        </div>
      );
    }
    return kind === 'area' ? (
      <AreaChart labels={labels} data={chart.data} height={240} unitSuffix={chart.suffix} />
    ) : (
      <BarChart labels={labels} data={chart.data} height={240} unitSuffix={chart.suffix} />
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title display">仪表盘</h1>
          <div className="sub">JM Agent · {todayLabel}</div>
        </div>
        <div className="dash-range">
          <RangePicker
            value={range}
            onChange={(v) => {
              if (v && v[0] && v[1]) setRange([v[0], v[1]]);
            }}
            allowClear={false}
            format="YYYY-MM-DD"
            presets={rangePresets()}
            maxDate={dayjs()}
          />
        </div>
      </div>

      {/* KPI row */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="label">Token 消耗</div>
          <div className="value">
            <span>{loading ? '—' : tokensC.num}</span>
            {tokensC.unit && <span className="unit">{tokensC.unit}</span>}
          </div>
          <div className="foot">
            <Delta delta={pct(totals?.tokens ?? 0, prev?.tokens ?? 0)} />
            <span style={{ color: 'var(--text-3)' }}>vs 上 {days} 天</span>
          </div>
          <div className="spark">
            <Sparkline data={tokenSpark.length ? tokenSpark : [0, 0]} />
          </div>
        </div>

        <div className="kpi">
          <div className="label">调用次数</div>
          <div className="value">
            <span>{loading ? '—' : callsC.num}</span>
            {callsC.unit && <span className="unit">{callsC.unit}</span>}
          </div>
          <div className="foot">
            <Delta delta={pct(totals?.calls ?? 0, prev?.calls ?? 0)} />
            <span style={{ color: 'var(--text-3)' }}>
              成功率 {((totals?.successRate ?? 0) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="spark">
            <Sparkline data={callSpark.length ? callSpark : [0, 0]} color="var(--chart-2)" />
          </div>
        </div>

        <div className="kpi">
          <div className="label">Agent</div>
          <div className="value">
            <span>{agentCount}</span>
            <span className="unit">个</span>
          </div>
          <div className="foot">
            <span style={{ color: 'var(--text-2)' }}>
              知识库 {kbCount} · 插件 {pluginCount}
            </span>
          </div>
        </div>

        <div className="kpi">
          <div className="label">平均延迟</div>
          <div className="value">
            <span>{loading ? '—' : avgLatencySec.toFixed(2)}</span>
            <span className="unit">s</span>
          </div>
          <div className="foot">
            <Delta delta={pct(avgLatencySec, prevLatencySec)} lowerIsBetter />
            <span style={{ color: 'var(--text-3)' }}>vs 上 {days} 天</span>
          </div>
        </div>
      </div>

      {/* Trend — 左：Token 面积图；右：调用次数条形图 */}
      <div className="dash-trend-2" style={{ marginBottom: 20 }}>
        <div className="atlas-card">
          <div className="atlas-card-head">
            <div>
              <div className="h">Token 用量趋势</div>
              <div className="sub">近 {rangeText} 天 · 来源 ai_model_call_log</div>
            </div>
            <div className="spacer" />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 12,
                color: 'var(--text-2)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  background: 'var(--chart-1)',
                  borderRadius: 2,
                  marginRight: 6,
                }}
              />
              Token{tokenChart.suffix ? `（${tokenChart.suffix}）` : ''}
            </span>
          </div>
          <div style={{ padding: '16px 20px 20px' }}>
            {renderChartArea(tokenChart, 'area')}
            <div
              style={{
                marginTop: 12,
                paddingLeft: 40,
                fontSize: 12,
                color: 'var(--text-3)',
              }}
              className="mono"
            >
              输入 {compact(totals?.inputTokens ?? 0).num}
              {compact(totals?.inputTokens ?? 0).unit} · 输出{' '}
              {compact(totals?.outputTokens ?? 0).num}
              {compact(totals?.outputTokens ?? 0).unit} tokens
            </div>
          </div>
        </div>

        <div className="atlas-card">
          <div className="atlas-card-head">
            <div>
              <div className="h">调用次数</div>
              <div className="sub">近 {rangeText} 天 · 按天统计</div>
            </div>
            <div className="spacer" />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 12,
                color: 'var(--text-2)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  background: 'var(--chart-1)',
                  borderRadius: 2,
                  marginRight: 6,
                }}
              />
              调用次数{callChart.suffix ? `（${callChart.suffix}）` : ''}
            </span>
          </div>
          <div style={{ padding: '16px 20px 20px' }}>
            {renderChartArea(callChart, 'bar')}
            <div
              style={{
                marginTop: 12,
                paddingLeft: 40,
                fontSize: 12,
                color: 'var(--text-3)',
              }}
              className="mono"
            >
              共 {(totals?.calls ?? 0).toLocaleString()} 次 · 成功率{' '}
              {((totals?.successRate ?? 0) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      <div className="row-2" style={{ marginBottom: 20 }}>
        {/* Top models */}
        <div className="atlas-card">
          <div className="atlas-card-head">
            <div>
              <div className="h">模型用量 Top（近 {rangeText} 天）</div>
            </div>
            <div className="spacer" />
            <button
              type="button"
              className="atlas-btn ghost sm"
              onClick={() => setModelsOpen(true)}
            >
              查看全部 <ArrowRightIcon size={12} className="icon" />
            </button>
          </div>
          <div>
            {topModels.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>
                {loading ? '加载中…' : '暂无模型调用记录'}
              </div>
            ) : (
              topModels.map((m, i) => (
                <div
                  key={m.model}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '16px 1fr 110px 90px',
                    gap: 14,
                    alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: i < topModels.length - 1 ? '1px solid var(--divider)' : 'none',
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="mono"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m.model}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
                      {compact(m.tokens).num}
                      {compact(m.tokens).unit} tokens
                    </div>
                  </div>
                  <div className="share-bar">
                    <span style={{ width: `${Math.round((m.calls / maxModelCalls) * 100)}%` }} />
                  </div>
                  <div
                    className="tabular mono"
                    style={{ textAlign: 'right', fontSize: 12, color: 'var(--text)' }}
                  >
                    {m.calls.toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent calls */}
        <div className="atlas-card">
          <div className="atlas-card-head">
            <div>
              <div className="h">最近使用</div>
              <div className="sub">当前工作区 · 按 Agent</div>
            </div>
          </div>
          <div>
            {recentCalls.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>
                {loading ? '加载中…' : '暂无调用记录'}
              </div>
            ) : (
              recentCalls.map((c) => {
                const st = STATUS_TEXT[c.callStatus ?? 0] ?? STATUS_TEXT[0];
                return (
                  <div key={c.id} className="activity-row">
                    <span className={`delta ${st.cls}`} style={{ fontSize: 11 }}>
                      ●
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <span className="who" style={{ fontSize: 12 }}>
                        {c.agentName ?? '未知 Agent'}
                      </span>{' '}
                      <span className="what">
                        {c.totalTokens.toLocaleString()} tokens
                        {c.latencyMs != null ? ` · ${(c.latencyMs / 1000).toFixed(2)}s` : ''}
                        {c.hasTool ? ' · 工具调用' : ''}
                        {st.cls === 'down' ? ` · ${st.label}` : ''}
                      </span>
                    </div>
                    <div className="when">{relTime(c.createTime)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 模型用量「查看全部」：时间范围内全部模型的调用分布饼图 */}
      <Modal
        open={modelsOpen}
        onCancel={() => setModelsOpen(false)}
        footer={null}
        width={560}
        title={`模型用量分布（近 ${rangeText} 天）`}
      >
        {modelPie.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>
            {loading ? '加载中…' : '该时间范围内暂无模型调用记录'}
          </div>
        ) : (
          <div style={{ padding: '8px 4px 4px' }}>
            <PieChart data={modelPie} />
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-3)' }} className="mono">
              共 {modelPieTotal.toLocaleString()} 次调用 · {modelPie.length} 个模型
            </div>
          </div>
        )}
      </Modal>

      {/* Quick actions */}
      <div className="atlas-card pad">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>快速操作</div>
        </div>
        <div className="qa-grid">
          <button type="button" className="qa" onClick={() => navigate('/console/agents')}>
            <div className="qa-icon">
              <PlusIcon size={14} />
            </div>
            <div>
              <div className="qa-title">新建 Agent</div>
              <div className="qa-sub">从模板或空白开始</div>
            </div>
          </button>
          <button type="button" className="qa" onClick={() => navigate('/console/knowledge')}>
            <div className="qa-icon">
              <UploadIcon size={14} />
            </div>
            <div>
              <div className="qa-title">上传知识库文档</div>
              <div className="qa-sub">PDF、Word、Markdown</div>
            </div>
          </button>
          <button type="button" className="qa" onClick={() => navigate('/console/playground')}>
            <div className="qa-icon">
              <PlayIcon size={14} />
            </div>
            <div>
              <div className="qa-title">打开 Playground</div>
              <div className="qa-sub">对话调试与回放</div>
            </div>
          </button>
          <button type="button" className="qa" onClick={() => navigate('/console/plugins')}>
            <div className="qa-icon">
              <PlugIcon size={14} />
            </div>
            <div>
              <div className="qa-title">新建插件</div>
              <div className="qa-sub">用 TypeScript / Python 暴露能力</div>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}
