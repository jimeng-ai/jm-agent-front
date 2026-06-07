import { useMemo, useState } from 'react';
import { App, Button, Input, Segmented, Space, Table, Tooltip, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { downloadTracesCsv, traceApi } from '@/features/trace/api';
import TraceDetail from '@/features/trace/components/TraceDetail';
import { TraceStatusTag } from '@/features/trace/components/TraceVisuals';
import type { TraceLog, TraceQuery, TraceStatus } from '@/features/trace/types';
import { formatDuration, formatTime, num } from '@/features/trace/utils';

const { Title, Text } = Typography;

const RANGE_OPTIONS = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]['value'];

const RANGE_MS: Record<RangeKey, number> = {
  '1h': 3600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

const STATUS_OPTIONS = [
  { label: '全部', value: 'ALL' },
  { label: '成功', value: 'SUCCESS' },
  { label: '告警', value: 'WARN' },
  { label: '错误', value: 'ERROR' },
] as const;

const PAGE_SIZE = 20;

export default function TraceListPage() {
  const { message } = App.useApp();
  const [range, setRange] = useState<RangeKey>('24h');
  const [status, setStatus] = useState<'ALL' | TraceStatus>('ALL');
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();
  const [exporting, setExporting] = useState(false);

  // 锚定时间：翻页/筛选期间窗口固定，避免 now 漂移导致重复/漏数据。
  const [anchor, setAnchor] = useState(() => Date.now());

  const filter: TraceQuery = useMemo(
    () => ({
      start: anchor - RANGE_MS[range],
      end: anchor,
      status: status === 'ALL' ? undefined : status,
      keyword: searchKeyword || undefined,
    }),
    [anchor, range, status, searchKeyword],
  );

  const overviewQ = useQuery({
    queryKey: ['trace', 'overview', filter.start, filter.end],
    queryFn: () => traceApi.overview({ start: filter.start, end: filter.end }),
    staleTime: 30_000,
  });

  const listQ = useQuery({
    queryKey: ['trace', 'list', filter, page],
    queryFn: () => traceApi.list({ ...filter, page, size: PAGE_SIZE }),
    staleTime: 10_000,
  });

  const detailQ = useQuery({
    queryKey: ['trace', 'detail', selectedId],
    queryFn: () => traceApi.detail(selectedId as string),
    enabled: !!selectedId,
  });

  const records = listQ.data?.records ?? [];
  const total = num(listQ.data?.total);

  // 任一筛选变化：回到第一页并重置时间窗口。
  const resetTo =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
      setAnchor(Date.now());
    };

  const onSearch = () => {
    setSearchKeyword(keyword.trim());
    setPage(1);
    setAnchor(Date.now());
  };

  const onRefresh = () => {
    setAnchor(Date.now());
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadTracesCsv(filter);
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 表头：标题 + 概览统计 / 操作按钮，单行对齐 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            调用日志
          </Title>
          <Text type="secondary">
            {num(overviewQ.data?.totalCalls).toLocaleString('en-US')} 次调用 · 平均延迟{' '}
            {formatDuration(overviewQ.data?.avgLatencyMs)} · 错误率{' '}
            {(num(overviewQ.data?.errorRate) * 100).toFixed(1)}%
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新
          </Button>
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={onExport}>
            导出 CSV
          </Button>
        </Space>
      </div>

      {/* 主体：左列表 + 右详情，撑满剩余高度、各自内部滚动 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16, flex: 1, minHeight: 0 }}>
        {/* 左：筛选 + 列表 + 分页 */}
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Space wrap style={{ marginBottom: 12 }}>
            <Segmented
              options={RANGE_OPTIONS as unknown as { label: string; value: string }[]}
              value={range}
              onChange={(v) => resetTo<RangeKey>(setRange)(v as RangeKey)}
            />
            <Segmented
              options={STATUS_OPTIONS as unknown as { label: string; value: string }[]}
              value={status}
              onChange={(v) => resetTo<'ALL' | TraceStatus>(setStatus)(v as 'ALL' | TraceStatus)}
            />
            <Input.Search
              allowClear
              placeholder="按 trace_id 或 Agent 搜索"
              style={{ width: 240 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={onSearch}
            />
          </Space>

          <div style={{ flex: 1, minHeight: 0 }}>
            <Table<TraceLog>
              rowKey="traceId"
              size="middle"
              loading={listQ.isLoading}
              dataSource={records}
              scroll={{ y: 'calc(100vh - 360px)' }}
              onRow={(row) => ({
                onClick: () => setSelectedId(row.traceId),
                style: { cursor: 'pointer' },
              })}
              rowClassName={(row) => (row.traceId === selectedId ? 'ant-table-row-selected' : '')}
              pagination={{
                current: page,
                pageSize: PAGE_SIZE,
                total,
                showSizeChanger: false,
                showTotal: (t) => `共 ${t.toLocaleString('en-US')} 条`,
                onChange: (p) => setPage(p),
              }}
              columns={[
                {
                  title: 'TRACE ID',
                  dataIndex: 'traceId',
                  ellipsis: true,
                  render: (v: string) => (
                    <Tooltip title={v}>
                      <span style={{ fontFamily: 'monospace' }}>{v}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: 'AGENT',
                  dataIndex: 'agentName',
                  width: 120,
                  ellipsis: true,
                  render: (v?: string) => v || '—',
                },
                {
                  title: '开始时间',
                  dataIndex: 'startTime',
                  width: 170,
                  render: (v?: string) => formatTime(v),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (s: TraceStatus) => <TraceStatusTag status={s} />,
                },
                {
                  title: '耗时',
                  dataIndex: 'totalLatencyMs',
                  width: 90,
                  align: 'right',
                  render: (v) => formatDuration(v),
                },
              ]}
            />
          </div>
        </div>

        {/* 右：详情（固定高度，内部滚动） */}
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            padding: 20,
            background: '#fff',
          }}
        >
          <TraceDetail trace={detailQ.data} loading={!!selectedId && detailQ.isLoading} />
        </div>
      </div>
    </div>
  );
}
