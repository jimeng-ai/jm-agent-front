import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Slider,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ExperimentOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import { AVAILABLE_MODELS, DEFAULT_SYSTEM_PROMPT } from '@/features/agent/constants';
import PluginBindPanel from '@/features/agent/components/PluginBindPanel';
import KnowledgeBindPanel from '@/features/agent/components/KnowledgeBindPanel';

interface KbBinding {
  kbIds?: string[];
  topK?: number;
  scoreThreshold?: number;
}

export default function AgentEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [kbBinding, setKbBinding] = useState<KbBinding>({ topK: 5, scoreThreshold: 0.5 });

  const agentQuery = useQuery({
    queryKey: ['agent', 'detail', id],
    queryFn: () => agentApi.detail(id),
    enabled: !!id,
  });

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => agentApi.update(id, v),
    onSuccess: () => {
      message.success('已保存');
      qc.invalidateQueries({ queryKey: ['agent', 'detail', id] });
    },
  });

  const publishMut = useMutation({
    mutationFn: () => agentApi.publish(id),
    onSuccess: () => {
      message.success('已发布');
      qc.invalidateQueries({ queryKey: ['agent', 'detail', id] });
    },
  });

  if (agentQuery.isLoading) return <Spin />;
  const agent = agentQuery.data;
  if (!agent) return null;

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/console/agents')} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            {agent.name}
          </Typography.Title>
          <Tag color={agent.status === 'PUBLISHED' ? 'green' : 'default'}>
            {agent.status === 'PUBLISHED' ? '已发布' : '草稿'}
          </Tag>
        </Space>
        <Space>
          <Button
            icon={<ExperimentOutlined />}
            onClick={() => navigate(`/console/playground/${id}`)}
          >
            调试台
          </Button>
          <Button icon={<SaveOutlined />} onClick={() => form.submit()} loading={saveMut.isPending}>
            保存草稿
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => publishMut.mutate()}
            loading={publishMut.isPending}
          >
            发布
          </Button>
        </Space>
      </Space>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ...agent,
          model: agent.model ?? AVAILABLE_MODELS[0].value,
          systemPrompt: agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          modelParams: {
            temperature: agent.modelParams?.temperature ?? 0.7,
            topP: agent.modelParams?.topP ?? 1,
            maxTokens: agent.modelParams?.maxTokens ?? 2048,
          },
        }}
        onFinish={(v) => saveMut.mutate(v)}
      >
        <Tabs
          items={[
            {
              key: 'base',
              label: '基础信息',
              children: (
                <Card style={{ maxWidth: 720 }}>
                  <Form.Item label="代号" name="code" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item label="名称" name="name" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item label="描述" name="description">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item label="头像 URL" name="avatar">
                    <Input placeholder="https://..." />
                  </Form.Item>
                </Card>
              ),
            },
            {
              key: 'prompt',
              label: '人设 Prompt',
              children: (
                <Card>
                  <Form.Item
                    label="System Prompt"
                    name="systemPrompt"
                    extra="定义 Agent 的角色、风格、约束。变量占位：{{user_name}} 等。"
                  >
                    <Input.TextArea
                      rows={16}
                      style={{ fontFamily: 'Menlo, monospace', fontSize: 13 }}
                    />
                  </Form.Item>
                </Card>
              ),
            },
            {
              key: 'model',
              label: '模型与参数',
              children: (
                <Card style={{ maxWidth: 560 }}>
                  <Form.Item label="模型" name="model" rules={[{ required: true }]}>
                    <Select options={AVAILABLE_MODELS} />
                  </Form.Item>
                  <Form.Item label="Temperature" name={['modelParams', 'temperature']}>
                    <Slider min={0} max={2} step={0.05} />
                  </Form.Item>
                  <Form.Item label="Top P" name={['modelParams', 'topP']}>
                    <Slider min={0} max={1} step={0.05} />
                  </Form.Item>
                  <Form.Item label="Max Tokens" name={['modelParams', 'maxTokens']}>
                    <InputNumber min={256} max={32768} step={256} style={{ width: 200 }} />
                  </Form.Item>
                </Card>
              ),
            },
            {
              key: 'plugins',
              label: '插件绑定',
              children: (
                <Card>
                  <PluginBindPanel agentId={id} />
                </Card>
              ),
            },
            {
              key: 'knowledge',
              label: '知识库绑定',
              children: (
                <Card>
                  <KnowledgeBindPanel value={kbBinding} onChange={setKbBinding} />
                  <Typography.Text type="secondary">
                    （知识库绑定字段后端尚未在 Agent 实体内固化，此处仅前端表单保留，后续后端补字段后联调）
                  </Typography.Text>
                </Card>
              ),
            },
          ]}
        />
      </Form>
    </div>
  );
}
