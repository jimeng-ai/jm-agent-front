import { useRef, useState } from 'react';
import { App, Button, Popconfirm, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { skillApi } from '@/features/skill/api';
import type { SkillView } from '@/features/skill/types';
import SkillDetailDrawer from './SkillDetailDrawer';
import ImportSkillModal from './ImportSkillModal';

const { Title, Text } = Typography;

type FilterKey = 'ALL' | 'MINE';

const SCOPE_LABEL: Record<string, string> = { PRIVATE: '私有', TENANT: '团队' };
const SCOPE_COLOR: Record<string, string> = { PRIVATE: 'default', TENANT: 'blue' };
const TYPE_LABEL: Record<string, string> = { PROMPT: 'Prompt', DOER: 'Doer' };
const TYPE_COLOR: Record<string, string> = { PROMPT: 'purple', DOER: 'orange' };
const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', ACTIVE: '启用', DISABLED: '停用' };
const STATUS_COLOR: Record<string, string> = { DRAFT: 'default', ACTIVE: 'green', DISABLED: 'red' };
const SOURCE_LABEL: Record<string, string> = { UPLOAD: '上传', MARKET: '市场', AI_GEN: 'AI 生成' };

export default function SkillListPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const mine = filter === 'MINE' ? true : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'list', filter],
    queryFn: () => skillApi.list(mine),
  });

  const skills = data ?? [];

  function refresh() {
    qc.invalidateQueries({ queryKey: ['skill', 'list'] });
  }

  const uploadMut = useMutation({
    mutationFn: skillApi.upload,
    onSuccess: () => {
      message.success('上传成功');
      refresh();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '上传失败');
    },
  });

  const shareMut = useMutation({
    mutationFn: skillApi.share,
    onSuccess: () => {
      message.success('已共享给团队');
      refresh();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '操作失败');
    },
  });

  const unshareMut = useMutation({
    mutationFn: skillApi.unshare,
    onSuccess: () => {
      message.success('已取消共享');
      refresh();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '操作失败');
    },
  });

  const enableMut = useMutation({
    mutationFn: skillApi.enable,
    onSuccess: () => {
      message.success('已启用');
      refresh();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '操作失败');
    },
  });

  const disableMut = useMutation({
    mutationFn: skillApi.disable,
    onSuccess: () => {
      message.success('已停用');
      refresh();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '操作失败');
    },
  });

  const removeMut = useMutation({
    mutationFn: skillApi.remove,
    onSuccess: () => {
      message.success('已删除');
      refresh();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '删除失败');
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMut.mutate(file);
    e.target.value = '';
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 表头：标题 + 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            技能 (Skills)
          </Title>
          <Text type="secondary">管理租户 Skill · 共 {skills.length} 个</Text>
        </div>
        <Space>
          <Button onClick={() => navigate('/console/skill/builder')}>AI 生成</Button>
          <Button onClick={() => setImportOpen(true)}>从 GitHub 导入</Button>
          <Button
            icon={<UploadOutlined />}
            loading={uploadMut.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            上传 SKILL.md
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </Space>
      </div>

      {/* 筛选行 */}
      <div style={{ margin: '16px 0 12px' }}>
        <Segmented<FilterKey>
          value={filter}
          onChange={(v) => setFilter(v)}
          options={[
            { label: '全部可见', value: 'ALL' },
            { label: '我创建的', value: 'MINE' },
          ]}
        />
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Table<SkillView>
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={skills}
          scroll={{ y: 'calc(100vh - 300px)' }}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 个`,
          }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              ellipsis: true,
              render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
            },
            {
              title: '描述',
              dataIndex: 'description',
              ellipsis: true,
              render: (v?: string) => <Text type="secondary">{v || '—'}</Text>,
            },
            {
              title: '类型',
              dataIndex: 'skillType',
              width: 100,
              render: (v: string) => <Tag color={TYPE_COLOR[v]}>{TYPE_LABEL[v] ?? v}</Tag>,
            },
            {
              title: '来源',
              dataIndex: 'source',
              width: 100,
              render: (v: string) => SOURCE_LABEL[v] ?? v,
            },
            {
              title: '范围',
              dataIndex: 'scope',
              width: 100,
              render: (v: string) => <Tag color={SCOPE_COLOR[v]}>{SCOPE_LABEL[v] ?? v}</Tag>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v] ?? v}</Tag>,
            },
            {
              title: '操作',
              key: 'actions',
              width: 160,
              render: (_, s) => (
                <Space
                  size="middle"
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: 'default' }}
                >
                  <Tooltip title="查看详情">
                    <EyeOutlined onClick={() => setDetailId(s.id)} />
                  </Tooltip>

                  {s.scope === 'PRIVATE' ? (
                    <Tooltip title="共享给团队">
                      <ShareAltOutlined onClick={() => shareMut.mutate(s.id)} />
                    </Tooltip>
                  ) : (
                    <Tooltip title="取消共享">
                      <StopOutlined onClick={() => unshareMut.mutate(s.id)} />
                    </Tooltip>
                  )}

                  {s.status === 'ACTIVE' ? (
                    <Popconfirm title="停用该 Skill？" onConfirm={() => disableMut.mutate(s.id)}>
                      <Tooltip title="停用">
                        <PauseCircleOutlined />
                      </Tooltip>
                    </Popconfirm>
                  ) : (
                    <Popconfirm title="启用该 Skill？" onConfirm={() => enableMut.mutate(s.id)}>
                      <Tooltip title="启用">
                        <PlayCircleOutlined />
                      </Tooltip>
                    </Popconfirm>
                  )}

                  <Popconfirm title="确认删除该 Skill？" onConfirm={() => removeMut.mutate(s.id)}>
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

      <SkillDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      <ImportSkillModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
