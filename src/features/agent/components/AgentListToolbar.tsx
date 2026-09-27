import { Input, Segmented } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { AgentListFilter } from '@/features/agent/types';

interface AgentListToolbarProps {
  query: string;
  filter: AgentListFilter;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: AgentListFilter) => void;
}

export default function AgentListToolbar({
  query,
  filter,
  onQueryChange,
  onFilterChange,
}: AgentListToolbarProps) {
  return (
    <div className="agent-list-toolbar" data-testid="agent-list-toolbar">
      <Input
        allowClear
        aria-label="搜索 Agent"
        data-testid="agent-search"
        prefix={<SearchOutlined aria-hidden />}
        placeholder="搜索名称、代号、用途或模型"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <Segmented
        aria-label="筛选 Agent 状态"
        data-testid="agent-filter"
        value={filter}
        onChange={(value) => onFilterChange(value as AgentListFilter)}
        options={[
          { label: '全部', value: 'all' },
          { label: '待发布', value: 'unpublished' },
          { label: '草稿', value: 'draft' },
        ]}
      />
    </div>
  );
}
