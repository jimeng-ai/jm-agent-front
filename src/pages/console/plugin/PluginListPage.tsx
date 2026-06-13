import { useMemo, useState } from 'react';
import {
  App,
  Avatar,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  SendOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { pluginApi } from '@/features/plugin/api';
import ShareModal from '@/features/rbac/components/ShareModal';
import { useAuthStore } from '@/stores/authStore';
import type { Plugin } from '@/api/types';

const { Title, Text } = Typography;

type TabKey = 'ALL' | 'MINE' | 'SHARED' | 'BUILTIN';

/** 更新时间的紧凑展示：今天 → 今天 HH:mm；昨天 → 昨天 HH:mm；本年 → MM-DD；更早 → YYYY-MM-DD。 */
function formatUpdated(v?: string): string {
  if (!v) return '—';
  const d = dayjs(v);
  if (!d.isValid()) return '—';
  const now = dayjs();
  if (d.isSame(now, 'day')) return `今天 ${d.format('HH:mm')}`;
  if (d.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${d.format('HH:mm')}`;
  if (d.isSame(now, 'year')) return d.format('MM-DD');
  return d.format('YYYY-MM-DD');
}

/** 取首字符做方块头像（插件 / 创建人）。 */
function initial(name?: string): string {
  return (name?.trim()?.[0] ?? '?').toUpperCase();
}

/** Tab 归属：我创建（create_user==我）/ 团队共享（别人创建但我可见）/ 系统内置（无租户，当前数据恒空）。 */
function belongsTo(p: Plugin, key: TabKey, myId?: string): boolean {
  switch (key) {
    case 'MINE':
      return !!myId && p.createUser === myId;
    case 'SHARED':
      return !p.tenantId ? false : !(myId && p.createUser === myId);
    case 'BUILTIN':
      return !p.tenantId;
    default:
      return true;
  }
}

export default function PluginListPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const myId = useAuthStore((s) => s.user?.id);

  const [open, setOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [tab, setTab] = useState<TabKey>('ALL');
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['plugin', 'list'],
    queryFn: () => pluginApi.list(),
  });

  const createMut = useMutation({
    mutationFn: pluginApi.create,
    onSuccess: (p) => {
      message.success('创建成功');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
      navigate(`/console/plugins/${p.id}`);
    },
  });

  const delMut = useMutation({
    mutationFn: pluginApi.delete,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
    },
  });

  const publishMut = useMutation({
    mutationFn: pluginApi.publish,
    onSuccess: () => {
      message.success('已发布');
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
    },
  });

  const unpublishMut = useMutation({
    mutationFn: pluginApi.unpublish,
    onSuccess: () => {
      message.success('已下架');
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
    },
  });

  const all = useMemo(() => data ?? [], [data]);

  const counts = useMemo(
    () => ({
      ALL: all.length,
      MINE: all.filter((p) => belongsTo(p, 'MINE', myId)).length,
      SHARED: all.filter((p) => belongsTo(p, 'SHARED', myId)).length,
      BUILTIN: all.filter((p) => belongsTo(p, 'BUILTIN', myId)).length,
    }),
    [all, myId],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return all
      .filter((p) => belongsTo(p, tab, myId))
      .filter((p) => !kw || p.name?.toLowerCase().includes(kw));
  }, [all, tab, keyword, myId]);

  // 顶部统计：插件数 / 动作总数 / 引用总数。
  const totalTools = useMemo(() => all.reduce((s, p) => s + (p.toolCount ?? 0), 0), [all]);
  const totalRefs = useMemo(() => all.reduce((s, p) => s + (p.refAgentCount ?? 0), 0), [all]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 表头：标题 + 统计 / 新建按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            插件
          </Title>
          <Text type="secondary">
            团队自建 · {all.length} 个插件 · 共 {totalTools} 个动作 · 被 {totalRefs} 个 Agent 引用
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新建插件
        </Button>
      </div>

      {/* 筛选行：Tab + 名称搜索 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          margin: '16px 0 12px',
        }}
      >
        <Segmented<TabKey>
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { label: `全部 ${counts.ALL}`, value: 'ALL' },
            { label: `我创建 ${counts.MINE}`, value: 'MINE' },
            { label: `团队共享 ${counts.SHARED}`, value: 'SHARED' },
            { label: `系统内置 ${counts.BUILTIN}`, value: 'BUILTIN' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="按名称搜索…"
          style={{ width: 280 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Table<Plugin>
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={filtered}
          scroll={{ y: 'calc(100vh - 300px)' }}
          onRow={(row) => ({
            onClick: () => navigate(`/console/plugins/${row.id}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 个`,
          }}
          columns={[
            {
              title: '插件',
              dataIndex: 'name',
              ellipsis: true,
              render: (_, p) => (
                <Space align="start">
                  <Avatar
                    shape="square"
                    style={{ background: '#eef2ff', color: '#4f46e5', flex: 'none' }}
                  >
                    {initial(p.name)}
                  </Avatar>
                  <div style={{ minWidth: 0 }}>
                    <Space size={6}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <Tag color={p.status === 'PUBLISHED' ? 'green' : 'default'}>
                        {p.status === 'PUBLISHED' ? '已发布' : '草稿'}
                      </Tag>
                    </Space>
                    <div
                      style={{
                        color: '#8c8c8c',
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 420,
                      }}
                    >
                      {p.description || p.baseUrl || '—'}
                    </div>
                  </div>
                </Space>
              ),
            },
            {
              title: '动作',
              dataIndex: 'toolCount',
              width: 90,
              align: 'right',
              render: (v?: number) => v ?? 0,
            },
            {
              title: '被引用',
              dataIndex: 'refAgentCount',
              width: 90,
              align: 'right',
              render: (v?: number) => v ?? 0,
            },
            {
              title: '更新',
              dataIndex: 'updateTime',
              width: 130,
              render: (v?: string) => <Text type="secondary">{formatUpdated(v)}</Text>,
            },
            {
              title: '创建者',
              dataIndex: 'creatorName',
              width: 140,
              ellipsis: true,
              render: (v?: string) => (
                <Space size={6}>
                  <Avatar size="small" style={{ background: '#f0f0f0', color: '#595959' }}>
                    {initial(v)}
                  </Avatar>
                  <span>{v ?? '-'}</span>
                </Space>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, p) => (
                <Space
                  size="middle"
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: 'default' }}
                >
                  <Tooltip title="分享">
                    <ShareAltOutlined onClick={() => setShareTarget({ id: p.id, name: p.name })} />
                  </Tooltip>
                  {p.status === 'PUBLISHED' ? (
                    <Popconfirm
                      title="下架该插件？下架后状态变回草稿"
                      onConfirm={() => unpublishMut.mutate(p.id)}
                    >
                      <Tooltip title="下架">
                        <DownloadOutlined />
                      </Tooltip>
                    </Popconfirm>
                  ) : (
                    <Popconfirm title="发布该插件？" onConfirm={() => publishMut.mutate(p.id)}>
                      <Tooltip title="发布">
                        <SendOutlined />
                      </Tooltip>
                    </Popconfirm>
                  )}
                  <Popconfirm
                    title="确认删除？关联工具与映射会一并删除"
                    onConfirm={() => delMut.mutate(p.id)}
                  >
                    <Tooltip title="删除">
                      <DeleteOutlined style={{ color: '#ff4d4f' }} />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title="新建插件"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="如 天气服务" />
          </Form.Item>
          <Form.Item label="Base URL" name="baseUrl">
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <ShareModal
        open={!!shareTarget}
        resourceType="PLUGIN"
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
      />
    </div>
  );
}
