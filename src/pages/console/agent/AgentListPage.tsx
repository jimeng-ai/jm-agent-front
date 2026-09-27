import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Skeleton,
  Typography,
} from 'antd';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import AgentCard from '@/features/agent/components/AgentCard';
import AgentListToolbar from '@/features/agent/components/AgentListToolbar';
import type { AgentCardAction, AgentListFilter } from '@/features/agent/types';
import ShareModal from '@/features/rbac/components/ShareModal';
import type { Agent } from '@/api/types';
import './agent-workbench.css';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function matchesQuery(agent: Agent, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;
  return [agent.name, agent.code, agent.description, agent.model].some((value) =>
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(query),
  );
}

function matchesFilter(agent: Agent, filter: AgentListFilter) {
  if (filter === 'draft') return agent.status !== 'PUBLISHED';
  if (filter === 'unpublished') return agent.hasUnpublishedChanges === true;
  return true;
}

export default function AgentListPage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<Agent | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AgentListFilter>('all');
  const [pending, setPending] = useState<
    Record<string, Exclude<AgentCardAction, null>>
  >({});
  const [form] = Form.useForm();

  const agentsQuery = useQuery({
    queryKey: ['agent', 'list'],
    queryFn: () => agentApi.list(),
  });

  const markPending = (id: string, action: Exclude<AgentCardAction, null>) =>
    setPending((current) => ({ ...current, [id]: action }));
  const clearPending = (id: string) =>
    setPending((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  const invalidateAgentLists = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['agent', 'list'] }),
      qc.invalidateQueries({ queryKey: ['agent', 'list', 'all'] }),
      qc.invalidateQueries({ queryKey: ['chat', 'agents'] }),
      qc.invalidateQueries({ queryKey: ['dashboard', 'agents'] }),
    ]);
  const invalidateAgentDetail = (id: string) =>
    qc.invalidateQueries({ queryKey: ['agent', 'detail', id], exact: true });
  const removeAgentCaches = (id: string) => {
    qc.removeQueries({ queryKey: ['agent', 'detail', id], exact: true });
    qc.removeQueries({ queryKey: ['agent', id, 'skills'], exact: true });
    qc.removeQueries({ queryKey: ['agent', id, 'connections'], exact: true });
  };

  const createMut = useMutation({
    mutationFn: agentApi.create,
    onSuccess: async (agent) => {
      message.success('已创建');
      setOpen(false);
      form.resetFields();
      await invalidateAgentLists();
      navigate(`/console/agents/${agent.id}`);
    },
    onError: (error) => message.error(errorMessage(error, '创建失败')),
  });

  const deleteMut = useMutation({
    mutationFn: agentApi.delete,
    onMutate: (id) => markPending(id, 'delete'),
    onSuccess: async (_data, id) => {
      removeAgentCaches(id);
      message.success('已删除');
      await invalidateAgentLists();
    },
    onError: (error) => message.error(errorMessage(error, '删除失败')),
    onSettled: (_data, _error, id) => clearPending(id),
  });

  const publishMut = useMutation({
    mutationFn: agentApi.publish,
    onMutate: (id) => markPending(id, 'publish'),
    onSuccess: async (_agent, id) => {
      message.success('已发布');
      await Promise.all([invalidateAgentLists(), invalidateAgentDetail(id)]);
    },
    onError: (error) => message.error(errorMessage(error, '发布失败')),
    onSettled: (_data, _error, id) => clearPending(id),
  });

  const unpublishMut = useMutation({
    mutationFn: agentApi.unpublish,
    onMutate: (id) => markPending(id, 'unpublish'),
    onSuccess: async (_agent, id) => {
      message.success('已下架');
      await Promise.all([invalidateAgentLists(), invalidateAgentDetail(id)]);
    },
    onError: (error) => message.error(errorMessage(error, '下架失败')),
    onSettled: (_data, _error, id) => clearPending(id),
  });

  const rows = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const filtered = useMemo(
    () => rows.filter((agent) => matchesQuery(agent, query) && matchesFilter(agent, filter)),
    [rows, query, filter],
  );
  const publishedCount = rows.filter((agent) => agent.status === 'PUBLISHED').length;
  const pendingCount = rows.filter((agent) => agent.hasUnpublishedChanges).length;

  const resetFilters = () => {
    setQuery('');
    setFilter('all');
  };

  const confirmPublish = (agent: Agent) => {
    modal.confirm({
      title: `发布「${agent.name}」？`,
      content: '将当前已保存的草稿发布到对话端。',
      okText: '发布',
      cancelText: '取消',
      onOk: () => publishMut.mutate(agent.id),
    });
  };

  const confirmUnpublish = (agent: Agent) => {
    modal.confirm({
      title: `下架「${agent.name}」？`,
      content: '下架后对话端不再提供该 Agent，配置仍会保留为草稿。',
      okText: '下架',
      cancelText: '取消',
      onOk: () => unpublishMut.mutate(agent.id),
    });
  };

  const confirmDelete = (agent: Agent) => {
    modal.confirm({
      title: `删除「${agent.name}」？`,
      content: '此操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => deleteMut.mutate(agent.id),
    });
  };

  return (
    <main className="agent-workbench-page" data-testid="agent-workbench">
      <header className="agent-workbench-head">
        <div>
          <span className="agent-workbench-kicker">Agent operations</span>
          <Typography.Title level={2}>Agents</Typography.Title>
          <Typography.Text type="secondary">
            配置面向调试台的草稿，确认后再发布到对话端；技能和数据连接授权即时生效。
          </Typography.Text>
          <div className="agent-summary-strip" aria-label="Agent 工作区摘要">
            <div className="agent-summary-item" data-testid="agent-summary-total">
              <strong>{rows.length}</strong>
              <span>Agent 总数</span>
            </div>
            <div className="agent-summary-item" data-testid="agent-summary-published">
              <strong>{publishedCount}</strong>
              <span>已发布</span>
            </div>
            <div className="agent-summary-item" data-testid="agent-summary-pending">
              <strong>{pendingCount}</strong>
              <span>待发布更新</span>
            </div>
          </div>
        </div>

        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'ai',
                icon: <RobotOutlined />,
                label: 'AI 对话生成',
                onClick: () => navigate('/console/agents/new'),
              },
              {
                key: 'blank',
                icon: <PlusOutlined />,
                label: '空白手动创建',
                onClick: () => setOpen(true),
              },
            ],
          }}
        >
          <Button type="primary" icon={<PlusOutlined />} aria-label="新建 Agent">
            新建 Agent
          </Button>
        </Dropdown>
      </header>

      <AgentListToolbar
        query={query}
        filter={filter}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
      />

      {agentsQuery.isError && agentsQuery.data && (
        <Alert
          type="warning"
          showIcon
          message="Agent 列表刷新失败，当前显示上一次成功读取的内容"
          description={errorMessage(agentsQuery.error, '暂时无法刷新 Agent 列表')}
          action={
            <Button size="small" aria-label="重试刷新 Agent 列表" onClick={() => agentsQuery.refetch()}>
              重试
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {agentsQuery.isLoading && !agentsQuery.data ? (
        <div className="agent-card-grid" aria-label="正在加载 Agent">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="agent-card-skeleton" key={index}>
              <Skeleton active avatar paragraph={{ rows: 5 }} />
            </div>
          ))}
        </div>
      ) : agentsQuery.isError && !agentsQuery.data ? (
        <Result
          className="agent-list-state"
          status="error"
          title="Agent 加载失败"
          subTitle={errorMessage(agentsQuery.error, '暂时无法读取 Agent 列表')}
          extra={
            <Button aria-label="重试加载 Agent" onClick={() => agentsQuery.refetch()}>
              重试
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <Empty
          className="agent-list-state"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有 Agent，可以从 AI 对话生成或空白配置开始"
        >
          <Button aria-label="空白创建第一个 Agent" onClick={() => setOpen(true)}>
            空白创建
          </Button>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty
          className="agent-list-state"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="没有匹配的 Agent"
        >
          <Button aria-label="清除 Agent 筛选" onClick={resetFilters}>
            清除筛选
          </Button>
        </Empty>
      ) : (
        <div className="agent-card-grid" aria-live="polite">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              pendingAction={pending[agent.id] ?? null}
              onEdit={() => navigate(`/console/agents/${agent.id}`)}
              onDebug={() => navigate(`/console/playground/${agent.id}`)}
              onShare={() => setShareTarget(agent)}
              onPublish={() => confirmPublish(agent)}
              onUnpublish={() => confirmUnpublish(agent)}
              onDelete={() => confirmDelete(agent)}
            />
          ))}
        </div>
      )}

      <Modal
        title="新建 Agent"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="创建并配置"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(value) => createMut.mutate(value)}>
          <Form.Item label="代号" name="code" rules={[{ required: true, message: '请输入代号' }]}>
            <Input placeholder="英文唯一标识，如 customer-bot" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="客服机器人" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <ShareModal
        open={!!shareTarget}
        resourceType="AGENT"
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
      />
    </main>
  );
}
