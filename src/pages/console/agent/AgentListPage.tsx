import { useState } from 'react';
import { App, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  SendOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import ShareModal from '@/features/rbac/components/ShareModal';
import type { Agent } from '@/api/types';

export default function AgentListPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<Agent | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['agent', 'list'],
    queryFn: () => agentApi.list(),
  });

  // 统一的失败提示：axios 拦截器会抛 BizError(message = 后端 respMsg)，
  // 之前各 mutation 都没有 onError，后端报错被 react-query 静默吞掉 → 点了「没反应」。
  const showError = (fallback: string) => (e: unknown) =>
    message.error(e instanceof Error && e.message ? e.message : fallback);

  const createMut = useMutation({
    mutationFn: agentApi.create,
    onSuccess: (a) => {
      message.success('已创建');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['agent', 'list'] });
      navigate(`/console/agents/${a.id}`);
    },
    onError: showError('创建失败'),
  });

  const delMut = useMutation({
    mutationFn: agentApi.delete,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['agent', 'list'] });
    },
    onError: showError('删除失败'),
  });

  const publishMut = useMutation({
    mutationFn: agentApi.publish,
    onSuccess: () => {
      message.success('已发布');
      qc.invalidateQueries({ queryKey: ['agent', 'list'] });
    },
    onError: showError('发布失败'),
  });

  const unpublishMut = useMutation({
    mutationFn: agentApi.unpublish,
    onSuccess: () => {
      message.success('已下架');
      qc.invalidateQueries({ queryKey: ['agent', 'list'] });
    },
    onError: showError('下架失败'),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Agent
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新建 Agent
        </Button>
      </div>

      <Table<Agent>
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '代号', dataIndex: 'code', width: 160 },
          { title: '模型', dataIndex: 'model', width: 180, render: (v) => v ?? '-' },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (s) => (
              <Tag color={s === 'PUBLISHED' ? 'green' : 'default'}>
                {s === 'PUBLISHED' ? '已发布' : '草稿'}
              </Tag>
            ),
          },
          { title: '更新时间', dataIndex: 'updateTime', width: 180 },
          {
            title: '创建人',
            dataIndex: 'creatorName',
            width: 120,
            render: (v) => v ?? '-',
          },
          {
            title: '操作',
            width: 260,
            render: (_, row) => (
              <Space>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => navigate(`/console/agents/${row.id}`)}
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  icon={<ExperimentOutlined />}
                  onClick={() => navigate(`/console/playground/${row.id}`)}
                >
                  调试
                </Button>
                <Button
                  size="small"
                  icon={<ShareAltOutlined />}
                  onClick={() => setShareTarget(row)}
                >
                  分享
                </Button>
                {row.status === 'PUBLISHED' ? (
                  <Popconfirm
                    title="下架该 Agent？下架后状态变回草稿"
                    onConfirm={() => unpublishMut.mutate(row.id)}
                  >
                    <Button size="small" type="link" icon={<DownloadOutlined />}>
                      下架
                    </Button>
                  </Popconfirm>
                ) : (
                  <Popconfirm title="发布该 Agent？" onConfirm={() => publishMut.mutate(row.id)}>
                    <Button size="small" type="link" icon={<SendOutlined />}>
                      发布
                    </Button>
                  </Popconfirm>
                )}
                <Popconfirm title="确认删除？" onConfirm={() => delMut.mutate(row.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建 Agent"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="代号" name="code" rules={[{ required: true }]}>
            <Input placeholder="英文唯一标识，如 customer-bot" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
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
    </div>
  );
}
