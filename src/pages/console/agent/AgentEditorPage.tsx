import { useEffect, useState } from 'react';
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
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  ExperimentOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { agentApi, getModelCatalog } from '@/features/agent/api';
import {
  FALLBACK_MODELS,
  DEFAULT_MAX_TEMP,
  DEFAULT_SYSTEM_PROMPT,
} from '@/features/agent/constants';
import PluginBindPanel from '@/features/agent/components/PluginBindPanel';
import KnowledgeBindPanel from '@/features/agent/components/KnowledgeBindPanel';
import PromptSplitEditor from '@/features/agent/components/PromptSplitEditor';
import AvatarUpload from '@/features/agent/components/AvatarUpload';

interface KbBinding {
  kbIds?: string[];
  topK?: number;
  scoreThreshold?: number;
  rerank?: boolean;
}

/** 后端 JSON 字段（model_params / kb_config）以字符串返回，这里统一解析成对象。 */
function parseJsonObj(v: unknown): Record<string, unknown> | undefined {
  if (!v) return undefined;
  if (typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export default function AgentEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [kbBinding, setKbBinding] = useState<KbBinding>({
    topK: 5,
    scoreThreshold: 0.5,
    rerank: true,
  });

  // 模型目录走后端单一真相源；接口加载中/失败 → 离线兜底，保证下拉不空白。
  const modelsQuery = useQuery({
    queryKey: ['models', 'catalog'],
    queryFn: getModelCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const modelOptions = modelsQuery.data?.length ? modelsQuery.data : FALLBACK_MODELS;

  // Temperature 滑块上限随所选模型变化：Claude=1，GPT=2（见 modelOptions.maxTemp）。
  const selectedModel = Form.useWatch('model', form);
  // 头像占位首字随名称变化。
  const watchedName = Form.useWatch('name', form);
  const maxTemp = modelOptions.find((m) => m.value === selectedModel)?.maxTemp ?? DEFAULT_MAX_TEMP;

  const agentQuery = useQuery({
    queryKey: ['agent', 'detail', id],
    queryFn: () => agentApi.detail(id),
    enabled: !!id,
  });

  // Agent 详情加载后，回显已保存的知识库绑定。
  useEffect(() => {
    const kb = parseJsonObj(agentQuery.data?.kbConfig);
    if (kb) {
      setKbBinding({
        kbIds: Array.isArray(kb.kbIds) ? (kb.kbIds as string[]).map(String) : undefined,
        topK: typeof kb.topK === 'number' ? kb.topK : 5,
        scoreThreshold: typeof kb.scoreThreshold === 'number' ? kb.scoreThreshold : 0.5,
        rerank: typeof kb.rerank === 'boolean' ? kb.rerank : true,
      });
    }
  }, [agentQuery.data]);

  // 后端 model_params / kb_config 为 JSON 字符串列：必须序列化成字符串提交，否则存不进去。
  const buildPayload = (v: Record<string, unknown>): Record<string, unknown> => ({
    ...v,
    modelParams: JSON.stringify(v.modelParams ?? {}),
    kbConfig: JSON.stringify({
      kbIds: kbBinding.kbIds ?? [],
      topK: kbBinding.topK ?? 5,
      scoreThreshold: kbBinding.scoreThreshold ?? 0.5,
      rerank: kbBinding.rerank ?? true,
    }),
  });

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => agentApi.update(id, v),
    onSuccess: () => {
      message.success('已保存草稿（调试台生效）');
      qc.invalidateQueries({ queryKey: ['agent', 'detail', id] });
    },
  });

  const publishMut = useMutation({
    mutationFn: () => agentApi.publish(id),
    onSuccess: () => {
      message.success('已发布（对话端已更新为当前内容）');
      qc.invalidateQueries({ queryKey: ['agent', 'detail', id] });
    },
  });

  const [publishing, setPublishing] = useState(false);

  // 发布 = 先保存当前表单、再发布（打快照）。否则会用上次保存的内容发布、漏掉未保存的改动。
  const handlePublish = async () => {
    let v: Record<string, unknown>;
    try {
      v = await form.validateFields();
    } catch {
      return; // 校验未过：AntD 已高亮对应字段
    }
    setPublishing(true);
    try {
      await agentApi.update(id, buildPayload(v));
      await publishMut.mutateAsync();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

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
          <Tooltip title="保存当前编辑。仅在「调试台」生效，不影响对话端用户。">
            <Button
              icon={<SaveOutlined />}
              onClick={() => form.submit()}
              loading={saveMut.isPending}
            >
              保存草稿
            </Button>
          </Tooltip>
          <Tooltip title="保存并发布。对话端将更新为当前内容，终端用户才能体验到本次改动。">
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handlePublish}
              loading={publishing || publishMut.isPending}
            >
              发布
            </Button>
          </Tooltip>
        </Space>
      </Space>

      <Form
        form={form}
        layout="vertical"
        initialValues={(() => {
          const mp = parseJsonObj(agent.modelParams) ?? {};
          return {
            ...agent,
            model: agent.model ?? modelOptions[0]?.value ?? FALLBACK_MODELS[0].value,
            systemPrompt: agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            modelParams: {
              temperature: typeof mp.temperature === 'number' ? mp.temperature : 0.7,
              topP: typeof mp.topP === 'number' ? mp.topP : 1,
              maxTokens: typeof mp.maxTokens === 'number' ? mp.maxTokens : 2048,
            },
          };
        })()}
        onFinish={(v) => saveMut.mutate(buildPayload(v))}
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
                  <Form.Item label="头像" name="avatarUrl">
                    <AvatarUpload name={watchedName} />
                  </Form.Item>
                  <Form.Item
                    label="预设问题"
                    tooltip="对话为空时展示的引导问题，用户点一下即可发送。每行一个，最多展示 4 个。"
                  >
                    <Form.List name="presetQuestions">
                      {(fields, { add, remove }) => (
                        <Space direction="vertical" style={{ width: '100%' }} size={8}>
                          {fields.map((field) => (
                            <Space key={field.key} style={{ width: '100%' }} align="baseline">
                              <Form.Item {...field} noStyle>
                                <Input
                                  style={{ width: 520 }}
                                  placeholder="例如：推荐一套 CRM 方案"
                                />
                              </Form.Item>
                              <MinusCircleOutlined onClick={() => remove(field.name)} />
                            </Space>
                          ))}
                          {fields.length < 6 && (
                            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add('')}>
                              添加预设问题
                            </Button>
                          )}
                        </Space>
                      )}
                    </Form.List>
                  </Form.Item>
                </Card>
              ),
            },
            {
              key: 'prompt',
              label: '人设 Prompt',
              children: (
                <Card>
                  <Form.Item name="systemPrompt" noStyle>
                    <PromptSplitEditor />
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
                    <Select
                      options={modelOptions}
                      onChange={(val) => {
                        // 切到上限更低的模型（如 GPT→Claude）时，把已超限的 temperature 夹回上限内。
                        const nextMax =
                          modelOptions.find((m) => m.value === val)?.maxTemp ?? DEFAULT_MAX_TEMP;
                        const cur = form.getFieldValue(['modelParams', 'temperature']);
                        if (typeof cur === 'number' && cur > nextMax) {
                          form.setFieldValue(['modelParams', 'temperature'], nextMax);
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="Temperature" name={['modelParams', 'temperature']}>
                    <Slider min={0} max={maxTemp} step={0.05} />
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
                    绑定后，与该 Agent
                    对话时会自动在所选知识库中检索并基于命中内容作答（带引用）；不绑定则为纯人设对话。保存后生效。
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
