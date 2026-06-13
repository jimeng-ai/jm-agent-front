import { useState } from 'react';
import {
  App,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ExperimentOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { pluginApi, pluginToolApi } from '@/features/plugin/api';
import ToolDrawer from '@/features/plugin/components/ToolDrawer';
import AiGenerateModal from '@/features/plugin/components/AiGenerateModal';
import RefinePluginModal from '@/features/plugin/components/RefinePluginModal';
import CredentialPanel from '@/features/plugin/components/CredentialPanel';
import TestPanel from '@/features/plugin/components/TestPanel';
import ToolsSchemaPanel from '@/features/plugin/components/ToolsSchemaPanel';
import AuthConfigEditor from '@/features/plugin/components/authconfig/AuthConfigEditor';
import ShareSettings from '@/features/rbac/components/ShareSettings';
import { FORM_AUTH_TYPES } from '@/features/plugin/utils/authConfig';
import { useAuthStore } from '@/stores/authStore';
import type { PluginAuthType, PluginTool } from '@/api/types';

const { Title, Text } = Typography;

const AUTH_TYPE_OPTIONS: { label: string; value: PluginAuthType }[] = [
  { label: '无 (NONE)', value: 'NONE' },
  { label: 'Bearer Token', value: 'BEARER' },
  { label: 'Basic Auth', value: 'BASIC' },
  { label: 'API Key', value: 'API_KEY' },
  { label: 'HMAC 签名', value: 'HMAC' },
  { label: 'OAuth2 (client_credentials)', value: 'OAUTH2' },
  { label: '通用 Token 获取', value: 'TOKEN_FETCH' },
];

export default function PluginEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [form] = Form.useForm();
  const [tab, setTab] = useState('base');
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<PluginTool | undefined>();
  const [aiOpen, setAiOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

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
    // 只提交可编辑字段：antd Form 的 initialValues 含整份 plugin，onFinish 会连 update_time/create_time/
    // tenant_id/status 等只读审计字段一起回传；若原样发给后端会把旧 update_time 写回、且有篡改风险。
    mutationFn: (v: Record<string, unknown>) =>
      pluginApi.update(id, {
        name: v.name as string,
        baseUrl: v.baseUrl as string | undefined,
        description: v.description as string | undefined,
        authType: v.authType as PluginAuthType | undefined,
        authConfig: v.authConfig as string | undefined,
      }),
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

  const toolCount = toolsQuery.data?.length ?? Number(plugin.toolCount ?? 0);
  const refCount = Number(plugin.refAgentCount ?? 0);
  const isPublished = plugin.status === 'PUBLISHED';
  const isMine = !!myId && plugin.createUser === myId;
  const initial = (plugin.name?.trim()?.[0] ?? 'P').toUpperCase();

  return (
    <div>
      {/* 面包屑 */}
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => navigate('/console/plugins')}>插件</a> },
          { title: plugin.name },
          { title: '编辑' },
        ]}
      />

      {/* 头部：返回 + 图标 + 名称/徽章/副标题 + 操作按钮 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <Space align="start" size={16}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/console/plugins')} />
          <Avatar
            shape="square"
            size={48}
            style={{ background: '#eef2ff', color: '#4f46e5', fontSize: 20, flex: 'none' }}
          >
            {initial}
          </Avatar>
          <div>
            <Space align="center" size={8} wrap>
              <Title level={3} style={{ margin: 0 }}>
                {plugin.name}
              </Title>
              <Tag color={isPublished ? 'green' : 'default'}>{isPublished ? '已发布' : '草稿'}</Tag>
              {plugin.version && <Tag>v{plugin.version}</Tag>}
              <Tag color={isMine ? 'blue' : 'default'}>{isMine ? '我创建' : '团队共享'}</Tag>
            </Space>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary">
                {plugin.code}
                {plugin.creatorName ? ` · ${plugin.creatorName} 创建` : ''} · {toolCount} 动作 · 被{' '}
                {refCount} 个 Agent 引用
              </Text>
            </div>
          </div>
        </Space>
        <Space>
          <Button
            icon={<SaveOutlined />}
            loading={saveMut.isPending}
            onClick={() => {
              setTab('base');
              form.submit();
            }}
          >
            保存草稿
          </Button>
          <Button icon={<ExperimentOutlined />} onClick={() => setTab('test')}>
            调试
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={publishMut.isPending}
            onClick={() => publishMut.mutate()}
          >
            发布
          </Button>
        </Space>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'base',
            label: '基础',
            children: (
              <Card>
                <Form
                  form={form}
                  layout="vertical"
                  initialValues={{ ...plugin, authType: plugin.authType ?? 'NONE' }}
                  onFinish={(v) => saveMut.mutate(v)}
                >
                  <Row gutter={24}>
                    <Col xs={24} md={12}>
                      <Form.Item label="名称" name="name" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        label="标识符 (slug)"
                        tooltip="插件运行时的功能 slug，创建后不可修改"
                      >
                        <Input value={plugin.code} disabled />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    label="描述"
                    name="description"
                    extra="会展示在 Agent 编辑页的工具选择列表里"
                  >
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item
                    label="Base URL"
                    name="baseUrl"
                    extra="所有动作的请求路径会拼接在此 URL 之后"
                  >
                    <Input placeholder="https://api.example.com" />
                  </Form.Item>
                  <Row gutter={24}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        label="鉴权方式"
                        name="authType"
                        extra="决定凭证 Tab 里要填哪些字段；NONE 表示接口不需鉴权"
                      >
                        <Select
                          options={AUTH_TYPE_OPTIONS}
                          onChange={() => form.setFieldsValue({ authConfig: '' })}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item noStyle shouldUpdate={(prev, next) => prev.authType !== next.authType}>
                    {({ getFieldValue }) => {
                      const at = getFieldValue('authType') as PluginAuthType | undefined;
                      if (!at || !FORM_AUTH_TYPES.includes(at)) return null;
                      return (
                        <Form.Item
                          label="认证配置"
                          name="authConfig"
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
                          <AuthConfigEditor authType={at} pluginId={id} />
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
            key: 'creds',
            label: '凭证',
            children: (
              <Card>
                <CredentialPanel pluginId={id} authType={plugin.authType} />
              </Card>
            ),
          },
          {
            key: 'tools',
            label: `动作 · Schema · ${toolCount}`,
            children: (
              <Card>
                <ToolsSchemaPanel
                  pluginId={id}
                  tools={toolsQuery.data ?? []}
                  loading={toolsQuery.isLoading}
                  onEdit={(tool) => {
                    setEditingTool(tool);
                    setToolDrawerOpen(true);
                  }}
                  onDelete={(toolId) => delToolMut.mutate(toolId)}
                  onChanged={() => qc.invalidateQueries({ queryKey: ['plugin', id, 'tools'] })}
                  headerExtra={
                    <>
                      <Button icon={<ThunderboltOutlined />} onClick={() => setAiOpen(true)}>
                        AI 生成
                      </Button>
                      <Button
                        icon={<ThunderboltOutlined />}
                        disabled={(toolsQuery.data?.length ?? 0) === 0}
                        onClick={() => setRefineOpen(true)}
                      >
                        AI 改写
                      </Button>
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
                    </>
                  }
                />
              </Card>
            ),
          },
          {
            key: 'test',
            label: '调试',
            children: (
              <Card>
                <TestPanel pluginId={id} />
              </Card>
            ),
          },
          {
            key: 'share',
            label: '权限与共享',
            children: (
              <Card style={{ maxWidth: 520 }}>
                <ShareSettings
                  resourceType="PLUGIN"
                  resourceId={id}
                  active={tab === 'share'}
                  withSaveButton
                />
              </Card>
            ),
          },
        ]}
      />

      <ToolDrawer
        open={toolDrawerOpen}
        pluginId={id}
        tool={editingTool}
        baseUrl={plugin.baseUrl}
        onClose={() => setToolDrawerOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['plugin', id, 'tools'] })}
      />
      <AiGenerateModal
        open={aiOpen}
        pluginId={id}
        onClose={() => setAiOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['plugin', id, 'tools'] })}
      />
      <RefinePluginModal
        open={refineOpen}
        pluginId={id}
        plugin={plugin}
        tools={toolsQuery.data ?? []}
        onClose={() => setRefineOpen(false)}
        onApplied={() => qc.invalidateQueries({ queryKey: ['plugin', id, 'tools'] })}
      />
    </div>
  );
}
