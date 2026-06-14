import { useEffect, useRef, useState } from 'react';
import { App, Button, Input, Space, Tag, Typography, Upload } from 'antd';
import {
  ArrowLeftOutlined,
  PaperClipOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { upload } from '@/api/client';
import {
  builderApi,
  consumeBuilderRun,
  type BuilderDraft,
  type BuilderToolCall,
} from '@/features/agent-builder/api';
import AgentPreviewCard from '@/features/agent-builder/components/AgentPreviewCard';
import MessageBubble from '@/features/chat-admin/components/MessageBubble';
import { newMessage, type ChatMessage, type MessageSegment } from '@/features/chat-admin/types';

const { Text, Title } = Typography;

interface PendingFile {
  id: number;
  name: string;
  url: string;
  contentType: string;
}

/** 把工具调用映射成对话页的 MessageSegment（draft_agent 展示成"更新草稿"步骤）。 */
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
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController>();
  const composingRef = useRef(false); // 输入法组词中：回车不发送
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string>(); // 当前流式中的 assistant 消息 id

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

  // 新内容到达时滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const applyDraft = (d: BuilderDraft) => {
    setDraft(d);
    if (d.recommendedPluginIds) setSelectedPluginIds(d.recommendedPluginIds.map(Number));
    if (d.recommendedKbIds) setSelectedKbIds(d.recommendedKbIds.map(Number));
  };

  /** 不可变地更新当前流式 assistant 消息 */
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
          output: c.output,
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

  const send = async () => {
    if (!conversationId || !input.trim() || generating) return;
    const query = input.trim();
    const fileIds = files.map((f) => f.id);

    const userMsg: ChatMessage = {
      ...newMessage('user', query),
      attachments: files.map((f) => ({
        fileId: f.id,
        filename: f.name,
        url: f.url,
        contentType: f.contentType,
      })),
    };
    const aiMsg = newMessage('assistant', '');
    activeIdRef.current = aiMsg.id;
    setMessages((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setFiles([]);
    setGenerating(true);

    let resp;
    try {
      resp = await builderApi.turn(conversationId, {
        query,
        fileIds: fileIds.length ? fileIds : undefined,
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

  const uploadFile = async (file: File) => {
    try {
      // 后端 AgentFileView 的主键字段名是 fileId（不是 id）。
      const r = await upload<{ fileId: number; filename: string }>('/agent/files', file);
      setFiles((f) => [
        ...f,
        {
          id: Number(r.fileId),
          name: r.filename ?? file.name,
          url: URL.createObjectURL(file),
          contentType: file.type,
        },
      ]);
    } catch (e) {
      message.error((e as Error)?.message ?? '上传失败');
    }
    return false; // 阻止 antd 默认上传
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
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
            {messages.length === 0 ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  color: '#8c8c8c',
                }}
              >
                <RobotOutlined style={{ fontSize: 40, color: '#bfbfbf' }} />
                <Text type="secondary" style={{ fontSize: 15 }}>
                  描述你想要的 Agent，我来帮你设计
                </Text>
                <Space direction="vertical" align="center" size={4}>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    例如：「做一个处理售后退货的客服助手，语气友好专业」
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    或：「帮我写一个能查天气、给穿衣建议的生活助手」
                  </Text>
                </Space>
              </div>
            ) : (
              <div style={{ maxWidth: 760, margin: '0 auto' }}>
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} agentName="Agent 构建器" />
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #f0f0f0', padding: 12, background: '#fafafa' }}>
            {!!files.length && (
              <Space wrap style={{ marginBottom: 8 }}>
                {files.map((f) => (
                  <Tag
                    key={f.id}
                    closable
                    onClose={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                  >
                    📎 {f.name}
                  </Tag>
                ))}
              </Space>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Upload beforeUpload={uploadFile} showUploadList={false} multiple>
                <Button icon={<PaperClipOutlined />} />
              </Upload>
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 5 }}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                style={{ borderRadius: 8 }}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onKeyDown={(e) => {
                  // 输入法组词中的回车（中文选词）不发送；Shift+Enter 换行。
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !composingRef.current &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={generating}
                disabled={!input.trim()}
                onClick={() => void send()}
              >
                发送
              </Button>
            </div>
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
