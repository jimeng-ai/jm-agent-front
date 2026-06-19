import { useEffect, useRef, useState } from 'react';
import { App, Button, Input, Popconfirm, Space, Typography, Upload } from 'antd';
import {
  ArrowLeftOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  builderApi,
  consumeBuilderRun,
  type BuilderDraft,
  type BuilderToolCall,
} from '@/features/agent-builder/api';
import AgentPreviewCard from '@/features/agent-builder/components/AgentPreviewCard';
import AttachmentThumb from '@/features/chat-admin/components/AttachmentThumb';
import MessageBubble from '@/features/chat-admin/components/MessageBubble';
import MessageComposer from '@/features/chat-admin/components/MessageComposer';
import { useAttachments } from '@/features/chat-admin/hooks/useAttachments';
import {
  newMessage,
  type ChatAttachment,
  type ChatMessage,
  type MessageSegment,
} from '@/features/chat-admin/types';

const { Title } = Typography;

/** 落地页场景卡片：点击直接用对应描述起手生成。 */
const SCENES = [
  {
    emoji: '💬',
    title: '客服 / 售后',
    desc: '退换货、物流查询、投诉工单',
    seed: '做一个电商售后客服 Agent，能处理退换货、物流查询和投诉工单，语气友好专业',
  },
  {
    emoji: '📊',
    title: '数据分析',
    desc: '查库、跑数、生成图表与结论',
    seed: '做一个数据分析助手，能查库、跑数、生成图表并给出结论',
  },
  {
    emoji: '📚',
    title: '知识库问答',
    desc: '基于企业文档精准问答',
    seed: '基于公司制度文档做一个知识库问答助手，回答要有依据、能引用来源',
  },
  {
    emoji: '⌨️',
    title: '代码助手',
    desc: 'Review、补全、解释与重构',
    seed: '做一个代码助手，能做 code review、补全、解释与重构',
  },
];

/** 4 角星 path（24x24 viewBox） */
const STAR_PATH = 'M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9L12 18.5l-1.9-6.1L4 10.5l6.1-1.9z';

/** Twinkle 图标：主星呼吸缩放 + 两颗小星错峰闪烁。 */
function SparkleIcon() {
  return (
    <div className="ai-spark" aria-hidden>
      <svg className="ai-spark__main" viewBox="0 0 24 24" width="46" height="46" fill="#fff">
        <path d={STAR_PATH} />
      </svg>
      <svg
        className="ai-spark__s ai-spark__s1"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="#fff"
      >
        <path d={STAR_PATH} />
      </svg>
      <svg
        className="ai-spark__s ai-spark__s2"
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="#fff"
      >
        <path d={STAR_PATH} />
      </svg>
    </div>
  );
}

function toolDesc(name: string): string {
  return name === 'draft_agent' ? '更新 Agent 草稿配置' : name;
}

export default function AgentBuilderWizardPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<BuilderDraft>({});
  const [selectedPluginIds, setSelectedPluginIds] = useState<number[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<number[]>([]);
  const [input, setInput] = useState('');
  const att = useAttachments();
  const [generating, setGenerating] = useState(false);
  const [resetting, setResetting] = useState(false);

  const abortRef = useRef<AbortController>();
  const composingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string>();

  // 已生成草稿（名称/人设/描述任一有内容）→ 视为已进入工作区，即使对话被清空也保留右侧预览
  const hasDraft = !!(
    draft.name?.trim() ||
    draft.systemPrompt?.trim() ||
    draft.description?.trim()
  );
  const started = messages.length > 0 || hasDraft;

  useEffect(() => {
    builderApi
      .startSession()
      .then((r) => {
        setConversationId(String(r.conversationId));
        if (r.draft) setDraft(r.draft);
      })
      .catch((e) => message.error(e?.message ?? '开会话失败'));
    return () => abortRef.current?.abort();
  }, [message]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /**
   * 重置对话：只清空对话内容（聊天记录/输入/附件），并开一个全新会话回到落地页。
   * 注意：保留右侧已生成的 Agent 草稿（draft / 已选插件 / 已选知识库），不做重置。
   */
  const resetConversation = async () => {
    abortRef.current?.abort();
    activeIdRef.current = undefined;
    setGenerating(false);
    setMessages([]);
    setInput('');
    att.reset();
    setConversationId(undefined);
    setResetting(true);
    try {
      const r = await builderApi.startSession();
      setConversationId(String(r.conversationId));
      // 故意不调用 setDraft：新会话草稿为空，会覆盖掉用户已生成的草稿。
      message.success('已清空对话');
    } catch (e) {
      message.error((e as Error)?.message ?? '重置失败');
    } finally {
      setResetting(false);
    }
  };

  const applyDraft = (d: BuilderDraft) => {
    setDraft(d);
    if (d.recommendedPluginIds) setSelectedPluginIds(d.recommendedPluginIds.map(Number));
    if (d.recommendedKbIds) setSelectedKbIds(d.recommendedKbIds.map(Number));
  };

  const patchActive = (fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((list) => list.map((m) => (m.id === activeIdRef.current ? fn(m) : m)));
  };

  const appendDelta = (t: string) =>
    patchActive((m) => {
      const segs: MessageSegment[] = [...(m.segments ?? [])];
      const last = segs[segs.length - 1];
      if (last && last.type === 'text')
        segs[segs.length - 1] = { type: 'text', text: last.text + t };
      else segs.push({ type: 'text', text: t });
      return { ...m, content: m.content + t, segments: segs };
    });

  const upsertTool = (calls: BuilderToolCall[], finalize: boolean) =>
    patchActive((m) => {
      const segs: MessageSegment[] = [...(m.segments ?? [])];
      for (const c of calls) {
        const idx = segs.findIndex((s) => s.type === 'tool' && s.call.id === c.id);
        const call = {
          id: c.id,
          name: c.name,
          desc: toolDesc(c.name),
          input: c.input,
          status: finalize ? (c.status ?? 'success') : (c.status ?? 'running'),
          // output 仅接受字符串（draft_agent 结果是对象，会让 stepKind 的 .trim 崩溃）。
          output: typeof c.output === 'string' ? c.output : undefined,
        };
        if (idx >= 0 && segs[idx].type === 'tool')
          segs[idx] = {
            type: 'tool',
            call: { ...(segs[idx] as { call: typeof call }).call, ...call },
          };
        else segs.push({ type: 'tool', call });
      }
      return { ...m, segments: segs };
    });

  /** 发起一轮生成（hero「开始生成」、场景卡片、工作区输入框共用）。附件由调用方传入。 */
  const startTurn = async (query: string, attachments: ChatAttachment[] = []) => {
    if (!conversationId || !query.trim() || generating) return;

    // fileId 是 19 位雪花 Long，后端以字符串下发；必须以字符串传回，Number() 会丢精度→「文件不存在」。
    const fileIds = attachments.map((a) => String(a.fileId));

    const userMsg: ChatMessage = {
      ...newMessage('user', query),
      attachments: attachments.length ? attachments : undefined,
    };
    const aiMsg = newMessage('assistant', '');
    activeIdRef.current = aiMsg.id;
    setMessages((m) => [...m, userMsg, aiMsg]);
    setInput('');
    att.reset();
    setGenerating(true);

    let resp;
    try {
      resp = await builderApi.turn(conversationId, {
        query,
        fileIds: fileIds.length ? fileIds : undefined,
        attachments: attachments.length ? attachments : undefined,
      });
    } catch (e) {
      setGenerating(false);
      patchActive((m) => ({
        ...m,
        status: 'error',
        errorMessage: (e as Error)?.message ?? '发送失败',
      }));
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    await consumeBuilderRun(
      resp.runId,
      {
        onDelta: appendDelta,
        onToolCall: (calls) => upsertTool(calls, false),
        onToolResult: (results) => upsertTool(results, true),
        onDraftUpdate: applyDraft,
        onError: (err) =>
          patchActive((m) => ({ ...m, status: 'error', errorMessage: err.message })),
        onDone: () => {
          setGenerating(false);
          patchActive((m) => ({ ...m, status: 'done' }));
        },
      },
      ac.signal,
    );
  };

  /** 落地页「开始生成」与回车：带上当前已上传完成的附件。 */
  const send = () => {
    const ready = att.attached.filter((a) => !a.uploading);
    void startTurn(input.trim(), ready);
  };

  const createMut = useMutation({
    mutationFn: () =>
      builderApi.finalize(conversationId!, {
        draft,
        pluginIds: selectedPluginIds,
        kbIds: selectedKbIds,
      }),
    onSuccess: (r) => {
      message.success('已创建草稿 Agent');
      qc.invalidateQueries({ queryKey: ['agent', 'list'] });
      navigate(`/console/agents/${r.agentId}`);
    },
    onError: (e) => message.error((e as Error)?.message ?? '创建失败'),
  });

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}
    >
      <Space>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/console/agents')}
        >
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          AI 对话生成 Agent
        </Title>
      </Space>
      {started && (
        <Popconfirm
          title="重置对话"
          description="将清空当前对话内容并开始新会话；右侧已生成的 Agent 草稿会保留。"
          okText="清空对话"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={resetConversation}
        >
          <Button icon={<ReloadOutlined />} loading={resetting}>
            重置对话
          </Button>
        </Popconfirm>
      )}
    </div>
  );

  // ============ 落地页（未开始）============
  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {header}
        <div className="builder-hero">
          <SparkleIcon />
          <h1 className="builder-hero__title">用一句话，生成一个 Agent</h1>
          <p className="builder-hero__sub">
            描述你要解决的问题，AI 会帮你配好 Prompt、知识库、工具与模型，边问边生成。
          </p>

          <div className="builder-hero__inputwrap">
            {att.attached.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 10,
                  padding: '0 2px',
                }}
              >
                {att.attached.map((a, i) => (
                  <AttachmentThumb
                    key={`${a.fileId}-${i}`}
                    item={a}
                    onRemove={() => att.removeAt(i)}
                  />
                ))}
              </div>
            )}
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              variant="borderless"
              placeholder="例如：做一个电商售后客服 Agent，能处理退换货、物流查询和投诉工单…（可粘贴或上传图片/资料）"
              style={{ padding: 0, fontSize: 15 }}
              onPaste={att.handlePaste}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !composingRef.current &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 8,
              }}
            >
              <Upload customRequest={att.uploadFile} showUploadList={false} multiple>
                <Button type="text" icon={<PaperClipOutlined />} title="上传图片 / 资料" />
              </Upload>
              <Button
                type="primary"
                size="large"
                icon={generating ? <LoadingOutlined /> : <ThunderboltOutlined />}
                disabled={!input.trim() || !conversationId || att.isUploading}
                loading={generating}
                onClick={send}
              >
                开始生成
              </Button>
            </div>
          </div>

          <div className="builder-hero__divider">或从场景起手</div>
          <div className="builder-scene-grid">
            {SCENES.map((s) => (
              <div
                key={s.title}
                className="builder-scene-card"
                onClick={() => !generating && conversationId && void startTurn(s.seed)}
              >
                <div className="builder-scene-card__emoji">{s.emoji}</div>
                <div className="builder-scene-card__title">{s.title}</div>
                <div className="builder-scene-card__desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ============ 工作区（已开始）============
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* 左：聊天 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} agentName="Agent 构建器" />
              ))}
            </div>
          </div>

          <div style={{ padding: '12px 16px 16px' }}>
            <MessageComposer
              value={input}
              onChange={setInput}
              onSubmit={(text, files) => startTurn(text, files)}
              attachments={att}
              busy={generating}
              placeholder="和 Agent 构建器说点什么…（可粘贴或上传图片/资料）"
              uploadTitle="上传图片 / 资料"
              maxRows={6}
            />
          </div>
        </div>

        {/* 右：实时预览 */}
        <div style={{ width: 420, minWidth: 360 }}>
          <AgentPreviewCard
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            selectedPluginIds={selectedPluginIds}
            selectedKbIds={selectedKbIds}
            onPluginToggle={setSelectedPluginIds}
            onKbToggle={setSelectedKbIds}
            onCreate={() => createMut.mutate()}
            creating={createMut.isPending}
          />
        </div>
      </div>
    </div>
  );
}
