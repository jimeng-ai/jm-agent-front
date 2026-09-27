import { Button, Input, Select } from 'antd';
import { ClearOutlined, SearchOutlined } from '@ant-design/icons';

export interface ConnectorFilters {
  query: string;
  attention: 'ALL' | 'ATTENTION';
  kind: string;
  health: string;
  writePolicy: string;
  semantic: string;
}

interface Props {
  total: number;
  healthy: number;
  attention: number;
  running: number;
  filters: ConnectorFilters;
  typeOptions: Array<{ label: string; value: string }>;
  onChange: (filters: ConnectorFilters) => void;
  onClear: () => void;
}

export default function ConnectorListToolbar({
  total,
  healthy,
  attention,
  running,
  filters,
  typeOptions,
  onChange,
  onClear,
}: Props) {
  const update = <K extends keyof ConnectorFilters>(key: K, value: ConnectorFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const active = Object.entries(filters).some(([key, value]) =>
    key === 'query' ? value !== '' : value !== 'ALL',
  );

  return (
    <>
      <section className="connector-summary" aria-label="连接状态摘要">
        <div className="connector-summary__item" data-testid="connector-summary-total">
          <span>全部连接</span>
          <strong>{total}</strong>
        </div>
        <div className="connector-summary__item is-healthy" data-testid="connector-summary-healthy">
          <span>健康可用</span>
          <strong>{healthy}</strong>
        </div>
        <div
          className="connector-summary__item is-attention"
          data-testid="connector-summary-attention"
        >
          <span>需要处理</span>
          <strong>{attention}</strong>
        </div>
        <div className="connector-summary__item is-running" data-testid="connector-summary-running">
          <span>语义生成中</span>
          <strong>{running}</strong>
        </div>
      </section>

      <section className="connector-toolbar" aria-label="筛选数据连接">
        <Input
          allowClear
          prefix={<SearchOutlined aria-hidden />}
          placeholder="搜索名称、类型或能力"
          value={filters.query}
          onChange={(event) => update('query', event.target.value)}
          aria-label="搜索数据连接"
        />
        <Select
          value={filters.attention}
          onChange={(value) => update('attention', value)}
          aria-label="按待处理状态筛选"
          options={[
            { label: '全部处理状态', value: 'ALL' },
            { label: '仅看需处理', value: 'ATTENTION' },
          ]}
        />
        <Select
          value={filters.kind}
          onChange={(value) => update('kind', value)}
          aria-label="按连接类型筛选"
          options={[{ label: '全部类型', value: 'ALL' }, ...typeOptions]}
        />
        <Select
          value={filters.health}
          onChange={(value) => update('health', value)}
          aria-label="按健康状态筛选"
          options={[
            { label: '全部健康状态', value: 'ALL' },
            { label: '健康', value: 'HEALTHY' },
            { label: '异常', value: 'UNHEALTHY' },
            { label: '未探测', value: 'UNKNOWN' },
          ]}
        />
        <Select
          value={filters.writePolicy}
          onChange={(value) => update('writePolicy', value)}
          aria-label="按写策略筛选"
          options={[
            { label: '全部写策略', value: 'ALL' },
            { label: '只读', value: 'FORBIDDEN' },
            { label: '写需审批', value: 'REQUIRE_APPROVAL' },
            { label: '写自动', value: 'AUTO' },
          ]}
        />
        <Select
          value={filters.semantic}
          onChange={(value) => update('semantic', value)}
          aria-label="按语义状态筛选"
          options={[
            { label: '全部语义状态', value: 'ALL' },
            { label: '未生成', value: 'NONE' },
            { label: '生成中', value: 'RUNNING' },
            { label: '已生成', value: 'READY' },
            { label: '失败', value: 'FAILED' },
            { label: '不适用', value: 'NOT_APPLICABLE' },
            { label: '不完整', value: 'PARTIAL' },
          ]}
        />
        <Button icon={<ClearOutlined />} disabled={!active} onClick={onClear}>
          清除筛选
        </Button>
      </section>
    </>
  );
}
