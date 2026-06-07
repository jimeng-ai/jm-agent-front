import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Input, Segmented, Space, Table, Tooltip, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { downloadTracesCsv, traceApi } from '@/features/trace/api';
import TraceDetail from '@/features/trace/components/TraceDetail';
import { TraceStatusTag } from '@/features/trace/components/TraceVisuals';
import type { TraceLog, TraceQuery, TraceStatus } from '@/features/trace/types';
import { formatDuration, formatTime, num } from '@/features/trace/utils';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

/** 时间选择器预设（与仪表盘一致）：今日 / 近 7 / 30 / 90 天 / 近半年。 */
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

const STATUS_OPTIONS = [
  { label: '全部', value: 'ALL' },
  { label: '成功', value: 'SUCCESS' },
  { label: '告警', value: 'WARN' },
  { label: '错误', value: 'ERROR' },
] as const;

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

export default function TraceListPage() {
  const { message } = App.useApp();
  // 时间窗口默认近 30 天；RangePicker 含端点、精确到天（与仪表盘一致）。
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(29, 'day'),
    dayjs(),
  ]);
  const [status, setStatus] = useState<'ALL' | TraceStatus>('ALL');
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string>();
  const [exporting, setExporting] = useState(false);

  const filter: TraceQuery = useMemo(
    () => ({
      start: dateRange[0].startOf('day').valueOf(),
      end: dateRange[1].endOf('day').valueOf(),
      status: status === 'ALL' ? undefined : status,
      keyword: searchKeyword || undefined,
    }),
    [dateRange, status, searchKeyword],
  );

  const overviewQ = useQuery({
    queryKey: ['trace', 'overview', filter.start, filter.end],
    queryFn: () => traceApi.overview({ start: filter.start, end: filter.end }),
    staleTime: 30_000,
  });

  const listQ = useQuery({
    queryKey: ['trace', 'list', filter, page, pageSize],
    queryFn: () => traceApi.list({ ...filter, page, size: pageSize }),
    staleTime: 10_000,
  });

  const detailQ = useQuery({
    queryKey: ['trace', 'detail', selectedId],
    queryFn: () => traceApi.detail(selectedId as string),
    enabled: !!selectedId,
  });

  const records = listQ.data?.records ?? [];
  const total = num(listQ.data?.total);

  // 任一筛选变化：回到第一页。
  const resetTo =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  const onSearch = () => {
    setSearchKeyword(keyword.trim());
    setPage(1);
  };

  const onRefresh = () => {
    overviewQ.refetch();
    listQ.refetch();
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
            <RangePicker
              value={dateRange}
              onChange={(v) => {
                if (v && v[0] && v[1]) resetTo<[Dayjs, Dayjs]>(setDateRange)([v[0], v[1]]);
              }}
              allowClear={false}
              format="YYYY-MM-DD"
              presets={rangePresets()}
              maxDate={dayjs()}
            />
            <Segmented
              options={STATUS_OPTIONS as unknown as { label: string; value: string }[]}
              value={status}
              onChange={(v) => resetTo<'ALL' | TraceStatus>(setStatus)(v as 'ALL' | TraceStatus)}
            />
            <Input.Search
              allowClear
              placeholder="按 trace_id / Agent / 消息 搜索"
              style={{ width: 260 }}
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
                pageSize,
                total,
                showSizeChanger: true,
                pageSizeOptions: PAGE_SIZE_OPTIONS,
                showTotal: (t) => `共 ${t.toLocaleString('en-US')} 条`,
                onChange: (p, s) => {
                  // 改变每页数量时回到第一页，避免越界空页。
                  setPage(s !== pageSize ? 1 : p);
                  setPageSize(s);
                },
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
                  title: '用户消息',
                  dataIndex: 'userMessage',
                  ellipsis: true,
                  render: (v?: string) =>
                    v ? (
                      <Tooltip title={v}>
                        <span>{v}</span>
                      </Tooltip>
                    ) : (
                      '—'
                    ),
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
