import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Result,
  Select,
  Skeleton,
  Slider,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { Agent } from '@/api/types';
import { agentApi, getModelCatalog } from '@/features/agent/api';
import AgentConnectionGrantPanel from '@/features/agent/components/AgentConnectionGrantPanel';
import AgentEditorHeader from '@/features/agent/components/AgentEditorHeader';
import AgentEditorNav from '@/features/agent/components/AgentEditorNav';
import AgentPublishSummary from '@/features/agent/components/AgentPublishSummary';
import AvatarUpload from '@/features/agent/components/AvatarUpload';
import KnowledgeBindPanel, {
  type KbBindingValue,
} from '@/features/agent/components/KnowledgeBindPanel';
import PromptSplitEditor from '@/features/agent/components/PromptSplitEditor';
import SkillBindPanel from '@/features/agent/components/SkillBindPanel';
import {
  DEFAULT_MAX_TEMP,
  DEFAULT_SYSTEM_PROMPT,
  FALLBACK_MODELS,
} from '@/features/agent/constants';
import useUnsavedChangesGuard from '@/features/agent/hooks/useUnsavedChangesGuard';
import type { AgentEditorSection } from '@/features/agent/types';
import './agent-workbench.css';

interface PublishFailure extends Error {
  draftSaved?: boolean;
}

interface DraftSubmission {
  values: Record<string, unknown>;
  revision: number;
}

interface RequiredIssue {
  section: AgentEditorSection;
  fields: string[];
  message: string;
}

/** 后端 JSON 字段（model_params / kb_config）以字符串返回，这里统一解析成对象。 */
function parseJsonObj(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseKbBinding(kbConfig: unknown): KbBindingValue {
  const kb = parseJsonObj(kbConfig);
  return {
    kbIds: Array.isArray(kb?.kbIds) ? (kb.kbIds as unknown[]).map(String) : [],
    topK: typeof kb?.topK === 'number' ? kb.topK : 5,
    scoreThreshold: typeof kb?.scoreThreshold === 'number' ? kb.scoreThreshold : 0.5,
    rerank: typeof kb?.rerank === 'boolean' ? kb.rerank : true,
  };
}

function requiredIssue(values: Record<string, unknown>): RequiredIssue | null {
  const missingIdentity = ['code', 'name'].filter(
    (field) => typeof values[field] !== 'string' || !(values[field] as string).trim(),
  );
  if (missingIdentity.length) {
    return { section: 'base', fields: missingIdentity, message: '请先填写 Agent 代号和名称' };
  }
  if (typeof values.model !== 'string' || !values.model.trim()) {
    return { section: 'model', fields: ['model'], message: '请先选择 Agent 模型' };
  }
  return null;
}

export default function AgentEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [activeSection, setActiveSection] = useState<AgentEditorSection>('base');
  const [dirty, setDirty] = useState(false);
  const [kbBinding, setKbBinding] = useState<KbBindingValue>({
    kbIds: [],
    topK: 5,
    scoreThreshold: 0.5,
    rerank: true,
  });
  const kbInitializedFor = useRef<string | null>(null);
  const formInitializedFor = useRef<string | null>(null);
  const editRevisionRef = useRef(0);

  // 模型目录走后端单一真相源；接口加载中/失败 → 离线兜底，保证下拉不空白。
  const modelsQuery = useQuery({
    queryKey: ['models', 'catalog'],
    queryFn: getModelCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const modelOptions = modelsQuery.data?.length ? modelsQuery.data : FALLBACK_MODELS;

  const agentQuery = useQuery({
    queryKey: ['agent', 'detail', id],
    queryFn: () => agentApi.detail(id),
    enabled: !!id,
  });
  const skillBindingsQuery = useQuery({
    queryKey: ['agent', id, 'skills'],
    queryFn: () => agentApi.listSkills(id),
    enabled: !!id,
  });
  const connectionBindingsQuery = useQuery({
    queryKey: ['agent', id, 'connections'],
    queryFn: () => agentApi.listConnections(id),
    enabled: !!id,
  });

  // section 切换会卸载对应 Form.Item；preserve 让 header / 发布摘要始终读取完整草稿快照。
  const selectedModel = Form.useWatch('model', { form, preserve: true });
  const watchedName = Form.useWatch('name', { form, preserve: true });
  const watchedValues = Form.useWatch([], { form, preserve: true }) as Partial<Agent> | undefined;
  const maxTemp =
    modelOptions.find((model) => model.value === selectedModel)?.maxTemp ?? DEFAULT_MAX_TEMP;

  const initialValues = useMemo(() => {
    const agent = agentQuery.data;
    if (!agent) return undefined;
    const modelParams = parseJsonObj(agent.modelParams) ?? {};
    return {
      code: agent.code,
      name: agent.name,
      description: agent.description,
      avatarUrl: agent.avatarUrl,
      presetQuestions: agent.presetQuestions ?? [],
      systemPrompt: agent.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      model: agent.model ?? modelOptions[0]?.value ?? FALLBACK_MODELS[0].value,
      modelParams: {
        temperature: typeof modelParams.temperature === 'number' ? modelParams.temperature : 0.7,
        topP: typeof modelParams.topP === 'number' ? modelParams.topP : 1,
        maxTokens: typeof modelParams.maxTokens === 'number' ? modelParams.maxTokens : 2048,
      },
    };
  }, [agentQuery.data, modelOptions]);

  // 仅首次读到当前 Agent 时初始化知识库，避免后台 refetch 覆盖用户正在编辑的未保存值。
  useEffect(() => {
    if (!agentQuery.data || agentQuery.data.id !== id || kbInitializedFor.current === id) return;
    setKbBinding(parseKbBinding(agentQuery.data.kbConfig));
    kbInitializedFor.current = id;
  }, [agentQuery.data, id]);

  useEffect(() => {
    if (
      !initialValues ||
      agentQuery.data?.id !== id ||
      formInitializedFor.current === id
    ) {
      return;
    }
    form.setFieldsValue(initialValues);
    formInitializedFor.current = id;
    editRevisionRef.current = 0;
    setActiveSection('base');
    setDirty(false);
  }, [agentQuery.data?.id, form, id, initialValues]);

  const markDraftChanged = () => {
    editRevisionRef.current += 1;
    setDirty(true);
  };

  const buildPayload = (values: Record<string, unknown>): Partial<Agent> => ({
    ...values,
    modelParams: JSON.stringify(values.modelParams ?? {}),
    kbConfig: JSON.stringify({
      kbIds: kbBinding.kbIds ?? [],
      topK: kbBinding.topK ?? 5,
      scoreThreshold: kbBinding.scoreThreshold ?? 0.5,
      rerank: kbBinding.rerank ?? true,
    }),
  });

  const invalidateAgentSurfaces = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['agent', 'detail', id] }),
      qc.invalidateQueries({ queryKey: ['agent', 'list'] }),
      qc.invalidateQueries({ queryKey: ['agent', 'list', 'all'] }),
      qc.invalidateQueries({ queryKey: ['chat', 'agents'] }),
      qc.invalidateQueries({ queryKey: ['dashboard', 'agents'] }),
    ]);

  const saveMut = useMutation({
    mutationFn: ({ values }: DraftSubmission) => agentApi.update(id, buildPayload(values)),
    onSuccess: async (_agent, submission) => {
      const hasNewerEdits = editRevisionRef.current !== submission.revision;
      if (!hasNewerEdits) setDirty(false);
      if (hasNewerEdits) {
        message.warning('草稿已保存，但保存期间有新修改尚未保存');
      } else {
        message.success('已保存草稿（调试台生效）');
      }
      await invalidateAgentSurfaces();
    },
    onError: (error) => message.error(errorMessage(error, '保存草稿失败')),
  });

  const publishMut = useMutation({
    mutationFn: async ({ values }: DraftSubmission) => {
      let draftSaved = false;
      try {
        await agentApi.update(id, buildPayload(values));
        draftSaved = true;
        return await agentApi.publish(id);
      } catch (error) {
        const failure = new Error(errorMessage(error, '发布失败')) as PublishFailure;
        failure.draftSaved = draftSaved;
        throw failure;
      }
    },
    onSuccess: async (_agent, submission) => {
      const hasNewerEdits = editRevisionRef.current !== submission.revision;
      if (!hasNewerEdits) setDirty(false);
      if (hasNewerEdits) {
        message.warning('已发布提交时的内容，但发布期间有新修改尚未保存');
      } else {
        message.success('已发布（对话端已更新为当前内容）');
      }
      await invalidateAgentSurfaces();
    },
    onError: async (error: PublishFailure, submission) => {
      if (error.draftSaved) {
        const hasNewerEdits = editRevisionRef.current !== submission.revision;
        if (!hasNewerEdits) setDirty(false);
        await invalidateAgentSurfaces();
        message.error(
          `草稿已保存，但发布失败：${error.message}${
            hasNewerEdits ? '；发布期间有新修改未保存' : ''
          }`,
        );
        return;
      }
      message.error(errorMessage(error, '发布失败'));
    },
  });

  const currentFormValues = (validated?: Record<string, unknown>) => ({
    ...(form.getFieldsValue(true) as Record<string, unknown>),
    ...(validated ?? {}),
  });

  const ensureRequiredValues = (values: Record<string, unknown>) => {
    const issue = requiredIssue(values);
    if (!issue) return true;
    setActiveSection(issue.section);
    message.error(issue.message);
    window.requestAnimationFrame(() => {
      void form.validateFields(issue.fields).catch(() => undefined);
    });
    return false;
  };

  const handleSave = (validated: Record<string, unknown>) => {
    const values = currentFormValues(validated);
    if (!ensureRequiredValues(values)) return;
    saveMut.mutate({ values, revision: editRevisionRef.current });
  };

  const handlePublish = async () => {
    try {
      const validated = (await form.validateFields()) as Record<string, unknown>;
      const values = currentFormValues(validated);
      if (!ensureRequiredValues(values)) return;
      publishMut.mutate({ values, revision: editRevisionRef.current });
    } catch {
      // 校验未过时 Ant Design 已把对应字段高亮。
    }
  };

  useUnsavedChangesGuard(
    dirty,
    publishMut.isPending ? 'publishing' : saveMut.isPending ? 'saving' : null,
  );

  if (agentQuery.isLoading && !agentQuery.data) {
    return (
      <div className="agent-editor-page">
        <Skeleton active avatar paragraph={{ rows: 12 }} />
      </div>
    );
  }
  if (agentQuery.isError && !agentQuery.data) {
    return (
      <Result
        status="error"
        title="Agent 加载失败"
        subTitle={errorMessage(agentQuery.error, '暂时无法读取 Agent 详情')}
        extra={
          <Space>
            <Button aria-label="返回 Agent 列表" onClick={() => navigate('/console/agents')}>
              返回列表
            </Button>
            <Button
              type="primary"
              aria-label="重试加载 Agent 详情"
              onClick={() => agentQuery.refetch()}
            >
              重试
            </Button>
          </Space>
        }
      />
    );
  }

  const agent = agentQuery.data;
  if (!agent || !initialValues) {
    return <Result status="404" title="Agent 不存在" />;
  }

  const headerAgent: Agent = {
    ...agent,
    name: typeof watchedName === 'string' && watchedName.trim() ? watchedName : agent.name,
  };

  const sectionContent = (() => {
    switch (activeSection) {
      case 'base':
        return (
          <Card
            className="agent-editor-section-card"
            title="基础信息"
            data-testid="agent-editor-section-base"
          >
            <div className="agent-form-measure">
              <Form.Item
                label="代号"
                name="code"
                rules={[{ required: true, message: '请输入代号' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="名称"
                name="name"
                rules={[{ required: true, message: '请输入名称' }]}
              >
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
                              style={{ width: '100%' }}
                              placeholder="例如：推荐一套 CRM 方案"
                            />
                          </Form.Item>
                          <Tooltip title="删除预设问题">
                            <Button
                              type="text"
                              danger
                              shape="circle"
                              aria-label={`删除第 ${field.name + 1} 个预设问题`}
                              icon={<MinusCircleOutlined />}
                              onClick={() => remove(field.name)}
                            />
                          </Tooltip>
                        </Space>
                      ))}
                      {fields.length < 6 && (
                        <Button
                          type="dashed"
                          icon={<PlusOutlined />}
                          aria-label="添加预设问题"
                          onClick={() => add('')}
                        >
                          添加预设问题
                        </Button>
                      )}
                    </Space>
                  )}
                </Form.List>
              </Form.Item>
            </div>
          </Card>
        );
      case 'prompt':
        return (
          <Card
            className="agent-editor-section-card"
            title="人设 Prompt"
            data-testid="agent-editor-section-prompt"
          >
            <Form.Item name="systemPrompt" noStyle>
              <PromptSplitEditor />
            </Form.Item>
          </Card>
        );
      case 'model':
        return (
          <Card
            className="agent-editor-section-card"
            title="模型参数"
            data-testid="agent-editor-section-model"
          >
            <div className="agent-form-measure">
              {modelsQuery.isError && (
                <Alert
                  type="warning"
                  showIcon
                  message={
                    modelsQuery.data?.length
                      ? '模型目录后台刷新失败，当前显示上一次成功读取的目录'
                      : '模型目录读取失败，当前使用内置兜底目录'
                  }
                  description={errorMessage(modelsQuery.error, '暂时无法读取模型目录')}
                  action={
                    <Button
                      size="small"
                      aria-label="重试刷新模型目录"
                      onClick={() => modelsQuery.refetch()}
                    >
                      重试
                    </Button>
                  }
                  style={{ marginBottom: 16 }}
                />
              )}
              <Form.Item
                label="模型"
                name="model"
                rules={[{ required: true, message: '请选择模型' }]}
              >
                <Select
                  aria-label="Agent 模型"
                  options={modelOptions}
                  onChange={(value) => {
                    const nextMax =
                      modelOptions.find((model) => model.value === value)?.maxTemp ??
                      DEFAULT_MAX_TEMP;
                    const current = form.getFieldValue(['modelParams', 'temperature']);
                    if (typeof current === 'number' && current > nextMax) {
                      form.setFieldValue(['modelParams', 'temperature'], nextMax);
                      markDraftChanged();
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="Temperature" name={['modelParams', 'temperature']}>
                <Slider aria-label="Temperature" min={0} max={maxTemp} step={0.05} />
              </Form.Item>
              <Form.Item label="Top P" name={['modelParams', 'topP']}>
                <Slider aria-label="Top P" min={0} max={1} step={0.05} />
              </Form.Item>
              <Form.Item label="Max Tokens" name={['modelParams', 'maxTokens']}>
                <InputNumber
                  aria-label="Max Tokens"
                  min={256}
                  max={32768}
                  step={256}
                  style={{ width: 200 }}
                />
              </Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                这三个参数仅在<strong>对话平面</strong>生效。当该 Agent 绑定了需要沙箱执行的技能，
                或会话中上传过文件时，该轮改走<strong>沙箱平面</strong>——Claude Agent SDK 的 Options
                不接受 temperature / topP / maxTokens，这几项届时<strong>不会生效</strong>，
                但也不会报错。需要按 Agent 调参时，请避免让它走沙箱平面。
              </Typography.Text>
            </div>
          </Card>
        );
      case 'knowledge':
        return (
          <Card
            className="agent-editor-section-card"
            title="知识库"
            data-testid="agent-editor-section-knowledge"
          >
            <KnowledgeBindPanel
              value={kbBinding}
              onChange={(next) => {
                setKbBinding(next);
                markDraftChanged();
              }}
            />
            <Typography.Text type="secondary">
              绑定后，与该 Agent
              对话时会自动在所选知识库中检索并基于命中内容作答（带引用）；不绑定则为纯人设对话。保存草稿后生效。
            </Typography.Text>
          </Card>
        );
      case 'skills':
        return (
          <Card
            className="agent-editor-section-card"
            title="技能 · 即时授权"
            data-testid="agent-editor-section-skills"
          >
            <SkillBindPanel agentId={id} />
          </Card>
        );
      case 'connectors':
        return (
          <Card
            className="agent-editor-section-card"
            title="数据连接 · 即时授权"
            data-testid="agent-editor-section-connectors"
          >
            <AgentConnectionGrantPanel agentId={id} />
          </Card>
        );
    }
  })();

  return (
    <main className="agent-workbench-page agent-editor-page" data-testid="agent-editor-workbench">
      <AgentEditorHeader
        agent={headerAgent}
        dirty={dirty}
        saving={saveMut.isPending}
        publishing={publishMut.isPending}
        onBack={() => navigate('/console/agents')}
        onDebug={() => navigate(`/console/playground/${id}`)}
        onSave={() => form.submit()}
        onPublish={handlePublish}
      />

      {agentQuery.isError && agentQuery.data && (
        <Alert
          type="warning"
          showIcon
          message="Agent 详情刷新失败，当前显示上一次成功读取的内容"
          description={errorMessage(agentQuery.error, '暂时无法刷新 Agent 详情')}
          action={
            <Button
              size="small"
              aria-label="重试刷新 Agent 详情"
              onClick={() => agentQuery.refetch()}
            >
              重试
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={markDraftChanged}
        onFinish={handleSave}
      >
        <div className="agent-editor-workbench">
          <aside className="agent-editor-nav-shell">
            <AgentEditorNav active={activeSection} onChange={setActiveSection} />
          </aside>

          <section className="agent-editor-main">{sectionContent}</section>

          <aside className="agent-publish-summary-shell">
            <AgentPublishSummary
              values={{ ...initialValues, ...(watchedValues ?? {}) }}
              knowledgeCount={kbBinding.kbIds?.length ?? 0}
              skillCount={skillBindingsQuery.data?.length}
              connectionCount={connectionBindingsQuery.data?.length}
              skillCountError={skillBindingsQuery.isError}
              connectionCountError={connectionBindingsQuery.isError}
            />
          </aside>
        </div>
      </Form>
    </main>
  );
}
