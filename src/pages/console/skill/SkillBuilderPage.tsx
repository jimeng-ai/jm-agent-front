import { useEffect, useRef, useState } from 'react';
import { App, Button, Collapse, Popconfirm, Space, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import {
  ArrowLeftOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  skillBuilderApi,
  consumeSkillBuilderRun,
  type SkillDraft,
} from '@/features/skill/builderApi';
import MessageBubble from '@/features/chat-admin/components/MessageBubble';
import { newMessage, type ChatMessage, type MessageSegment } from '@/features/chat-admin/types';

const { Title, Text } = Typography;

const SKILL_TYPE_COLOR: Record<string, string> = { PROMPT: 'purple', DOER: 'orange' };
const SKILL_TYPE_LABEL: Record<string, string> = { PROMPT: 'Prompt', DOER: 'Doer' };

/** Right pane: live preview of the current SkillDraft. */
function SkillDraftPreview({ draft }: { draft: SkillDraft }) {
  const fileEntries = Object.entries(draft.files ?? {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          {draft.name || <Text type="secondary">（名称待生成）</Text>}
        </Title>
        {draft.skillType && (
          <Tag color={SKILL_TYPE_COLOR[draft.skillType]} style={{ marginTop: 4 }}>
            {SKILL_TYPE_LABEL[draft.skillType] ?? draft.skillType}
          </Tag>
        )}
      </div>

      {draft.description && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {draft.description}
        </Text>
      )}

      {draft.body && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            SKILL.md
          </Text>
          <pre
            style={{
              background: '#f6f8fa',
              border: '1px solid #e8e8e8',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 12,
              marginTop: 6,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {draft.body}
          </pre>
        </div>
      )}

      {draft.skillType === 'DOER' && fileEntries.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            文件 ({fileEntries.length})
          </Text>
          <Collapse
            size="small"
            style={{ marginTop: 6 }}
            items={fileEntries.map(([path, content]) => ({
              key: path,
              label: <code style={{ fontSize: 12 }}>{path}</code>,
              children: (
                <pre
                  style={{
                    background: '#f6f8fa',
                    padding: '8px 12px',
                    fontSize: 11,
                    margin: 0,
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {content}
                </pre>
              ),
            }))}
          />
        </div>
      )}

      {!draft.name && !draft.body && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 200,
            color: '#bfbfbf',
            fontSize: 14,
          }}
        >
          <span>描述你要构建的 Skill，AI 会实时生成预览</span>
        </div>
      )}
    </div>
  );
}

export default function SkillBuilderPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<SkillDraft>({});
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const abortRef = useRef<AbortController>();
  const composingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string>();

  const hasDraft = !!(draft.name?.trim() || draft.body?.trim() || draft.description?.trim());
  const started = messages.length > 0 || hasDraft;

  useEffect(() => {
    skillBuilderApi
      .startSession()
      .then((r) => {
        setConversationId(String(r.conversationId));
        if (r.draft) setDraft(r.draft);
      })
      .catch((e: { message?: string }) => message.error(e?.message ?? '开会话失败'));
    return () => abortRef.current?.abort();
  }, [message]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const resetConversation = async () => {
    abortRef.current?.abort();
    activeIdRef.current = undefined;
    setGenerating(false);
    setMessages([]);
    setInput('');
    setConversationId(undefined);
    setResetting(true);
    try {
      const r = await skillBuilderApi.startSession();
      setConversationId(String(r.conversationId));
      message.success('已清空对话');
    } catch (e) {
      message.error((e as Error)?.message ?? '重置失败');
    } finally {
      setResetting(false);
    }
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

  const startTurn = async (query: string) => {
    if (!conversationId || !query.trim() || generating) return;

    const userMsg = newMessage('user', query);
    const aiMsg = newMessage('assistant', '');
    activeIdRef.current = aiMsg.id;
    setMessages((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setGenerating(true);

    let resp;
    try {
      resp = await skillBuilderApi.startTurn(conversationId, query);
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
    await consumeSkillBuilderRun(
      resp.runId,
      {
        onDelta: appendDelta,
        onDraftUpdate: (d) => setDraft(d),
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

  const send = () => void startTurn(input.trim());

  const finalizeMut = useMutation({
    mutationFn: () => skillBuilderApi.finalize(conversationId!),
    onSuccess: () => {
      message.success('Skill 已创建');
      qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      navigate('/console/skills');
    },
    onError: (e) => message.error((e as Error)?.message ?? '创建失败'),
  });

  // DOER test-run upload — stubbed in v1; wired visually but disabled.
  const testRunUploadProps: UploadProps = {
    beforeUpload: () => false, // prevent antd auto-upload
    showUploadList: false,
  };

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
          onClick={() => navigate('/console/skills')}
        >
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          AI 对话生成 Skill
        </Title>
      </Space>
      {started && (
        <Popconfirm
          title="重置对话"
          description="将清空当前对话内容并开始新会话；右侧已生成的 Skill 草稿会保留。"
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
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            padding: '0 40px',
          }}
        >
          <Title level={2} style={{ margin: 0 }}>
            用一句话，生成一个 Skill
          </Title>
          <Text type="secondary" style={{ fontSize: 15, textAlign: 'center' }}>
            描述你想封装的技能，AI 会帮你生成 SKILL.md 主体与文件结构，边问边生成。
          </Text>
          <div
            style={{
              width: '100%',
              maxWidth: 640,
              background: '#fff',
              border: '1px solid #e8e8e8',
              borderRadius: 16,
              padding: '16px 20px 10px',
            }}
          >
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              variant="borderless"
              placeholder="例如：做一个能调用天气 API、返回格式化天气摘要的 Doer Skill…"
              style={{ padding: 0, fontSize: 15 }}
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Button
                type="primary"
                size="large"
                icon={generating ? <LoadingOutlined /> : <SendOutlined />}
                disabled={!input.trim() || !conversationId}
                loading={generating}
                onClick={send}
              >
                开始生成
              </Button>
            </div>
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
                <MessageBubble key={m.id} message={m} agentName="Skill 构建器" />
              ))}
            </div>
          </div>

          <div style={{ padding: '12px 16px 16px' }}>
            <div
              style={{
                background: '#fff',
                border: `1px solid ${inputFocused ? '#4096ff' : '#d9d9d9'}`,
                borderRadius: 16,
                padding: '12px 16px 8px',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxShadow: inputFocused ? '0 0 0 3px rgba(64,150,255,0.12)' : 'none',
              }}
            >
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 6 }}
                variant="borderless"
                placeholder="和 Skill 构建器说点什么…"
                style={{ padding: 0, fontSize: 14, resize: 'none' }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
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
                  justifyContent: 'flex-end',
                  marginTop: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#bfbfbf' }}>Enter 发送</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<SendOutlined />}
                    loading={generating}
                    disabled={!input.trim()}
                    onClick={send}
                    style={{ color: input.trim() ? '#4096ff' : undefined }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右：实时预览 */}
        <div
          style={{
            width: 420,
            minWidth: 360,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* 右侧顶栏 */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text strong>Skill 草稿预览</Text>
            <Space>
              {draft.skillType === 'DOER' && (
                <Tooltip title="上传样例文件试跑（即将支持）">
                  <Upload {...testRunUploadProps}>
                    <Button size="small" icon={<UploadOutlined />} disabled>
                      上传样例并试跑
                    </Button>
                  </Upload>
                </Tooltip>
              )}
              <Button
                type="primary"
                size="small"
                loading={finalizeMut.isPending}
                disabled={!hasDraft || !conversationId}
                onClick={() => finalizeMut.mutate()}
              >
                完成并保存
              </Button>
            </Space>
          </div>

          {/* 右侧内容 */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <SkillDraftPreview draft={draft} />
          </div>
        </div>
      </div>
    </div>
  );
}
