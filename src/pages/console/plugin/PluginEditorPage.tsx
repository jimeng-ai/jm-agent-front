import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { pluginApi, pluginToolApi } from '@/features/plugin/api';
import ToolDrawer from '@/features/plugin/components/ToolDrawer';
import CredentialPanel from '@/features/plugin/components/CredentialPanel';
import TestPanel from '@/features/plugin/components/TestPanel';
import type { PluginAuthType, PluginTool } from '@/api/types';

const AUTH_TYPE_OPTIONS: { label: string; value: PluginAuthType }[] = [
  { label: '无 (NONE)', value: 'NONE' },
  { label: 'Bearer Token', value: 'BEARER' },
  { label: 'Basic Auth', value: 'BASIC' },
  { label: 'API Key', value: 'API_KEY' },
  { label: 'HMAC 签名', value: 'HMAC' },
];

export default function PluginEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<PluginTool | undefined>();
  const [testOpen, setTestOpen] = useState(false);

  const pluginQuery = useQuery({
    queryKey: ['plugin', 'detail', id],
    queryFn: () => pluginApi.detail(id),
    enabled: !!id,
  });

  const toolsQuery = useQuery({
    queryKey: ['plugin', id, 'tools'],
    queryFn: () => pluginToolApi.list(id),
    enabled: !!id,
  });

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => pluginApi.update(id, v),
    onSuccess: () => {
      message.success('保存成功');
      qc.invalidateQueries({ queryKey: ['plugin', 'detail', id] });
    },
  });

  const publishMut = useMutation({
    mutationFn: () => pluginApi.publish(id),
    onSuccess: () => {
      message.success('已发布');
      qc.invalidateQueries({ queryKey: ['plugin', 'detail', id] });
    },
  });

  const delToolMut = useMutation({
    mutationFn: (toolId: string) => pluginToolApi.delete(id, toolId),
    onSuccess: () => {
      message.success('工具已删除');
      qc.invalidateQueries({ queryKey: ['plugin', id, 'tools'] });
    },
  });

  if (pluginQuery.isLoading) return <Spin />;
  const plugin = pluginQuery.data;
  if (!plugin) return null;

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/console/plugins')} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            {plugin.name}
          </Typography.Title>
          <Tag color={plugin.status === 'PUBLISHED' ? 'green' : 'default'}>
            {plugin.status === 'PUBLISHED' ? '已发布' : '草稿'}
          </Tag>
        </Space>
        <Space>
          <Button icon={<ExperimentOutlined />} onClick={() => setTestOpen(true)}>
            试调用
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={publishMut.isPending}
            onClick={() => publishMut.mutate()}
          >
            发布
          </Button>
        </Space>
      </Space>

      <Tabs
        items={[
          {
            key: 'base',
            label: '基础信息',
            children: (
              <Card>
                <Form
                  form={form}
                  layout="vertical"
                  initialValues={{ ...plugin, authType: plugin.authType ?? 'NONE' }}
                  onFinish={(v) => saveMut.mutate(v)}
                  style={{ maxWidth: 720 }}
                >
                  <Form.Item label="名称" name="name" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item label="Base URL" name="baseUrl">
                    <Input placeholder="https://api.example.com" />
                  </Form.Item>
                  <Form.Item label="描述" name="description">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item
                    label="认证方式"
                    name="authType"
                    extra="决定凭证 Tab 里要填哪些字段；NONE 表示接口不需鉴权"
                  >
                    <Select options={AUTH_TYPE_OPTIONS} />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, next) => prev.authType !== next.authType}
                  >
                    {({ getFieldValue }) => {
                      const at = getFieldValue('authType') as PluginAuthType | undefined;
                      if (at !== 'API_KEY' && at !== 'HMAC') return null;
                      return (
                        <Form.Item
                          label={`auth_config (${at} 非密配置 JSON)`}
                          name="authConfig"
                          extra={
                            at === 'API_KEY'
                              ? '示例：{ "location": "header", "key_name": "X-API-Key" }'
                              : '示例：{ "algorithm": "HMAC_SHA256", "sign_template": "...", "placement": { "type": "header", "name": "X-Sign" } }'
                          }
                          rules={[
                            {
                              validator: (_, v) => {
                                if (!v) return Promise.resolve();
                                try {
                                  JSON.parse(v);
                                  return Promise.resolve();
                                } catch (e) {
                                  return Promise.reject((e as Error).message);
                                }
                              },
                            },
                          ]}
                        >
                          <Input.TextArea
                            rows={6}
                            style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    htmlType="submit"
                    loading={saveMut.isPending}
                  >
                    保存
                  </Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'tools',
            label: `工具 (${toolsQuery.data?.length ?? 0})`,
            children: (
              <Card>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingTool(undefined);
                      setToolDrawerOpen(true);
                    }}
                  >
                    新增工具
                  </Button>
                </div>
                <Table<PluginTool>
                  rowKey="id"
                  loading={toolsQuery.isLoading}
                  dataSource={toolsQuery.data ?? []}
                  pagination={false}
                  columns={[
                    { title: '名称', dataIndex: 'name' },
                    { title: '描述', dataIndex: 'description', ellipsis: true },
                    {
                      title: '启用',
                      dataIndex: 'enabled',
                      width: 80,
                      render: (v) => <Switch checked={v} disabled />,
                    },
                    {
                      title: '操作',
                      width: 120,
                      render: (_, row) => (
                        <Space>
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                              setEditingTool(row);
                              setToolDrawerOpen(true);
                            }}
                          />
                          <Popconfirm
                            title="确认删除？"
                            onConfirm={() => delToolMut.mutate(row.id)}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'creds',
            label: '凭证',
            children: (
              <Card>
                <CredentialPanel pluginId={id} authType={plugin.authType} />
              </Card>
            ),
          },
        ]}
      />

      <ToolDrawer
        open={toolDrawerOpen}
        pluginId={id}
        tool={editingTool}
        onClose={() => setToolDrawerOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['plugin', id, 'tools'] })}
      />
      <TestPanel open={testOpen} pluginId={id} onClose={() => setTestOpen(false)} />
    </div>
  );
}
