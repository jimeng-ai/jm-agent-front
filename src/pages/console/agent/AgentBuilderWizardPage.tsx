import { useEffect, useRef, useState } from 'react';
import { App, Button, Input, Space, Spin, Typography, Upload } from 'antd';
import { ArrowLeftOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { upload } from '@/api/client';
import { builderApi, consumeBuilderRun, type BuilderDraft } from '@/features/agent-builder/api';
import AgentPreviewCard from '@/features/agent-builder/components/AgentPreviewCard';

const { Text } = Typography;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}
interface PendingFile {
  id: number;
  name: string;
}

export default function AgentBuilderWizardPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState<BuilderDraft>({});
  const [selectedPluginIds, setSelectedPluginIds] = useState<number[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<number[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController>();

  // 开会话
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

  // 收到新草稿时，把推荐项默认勾上（用户可改）。
  const applyDraft = (d: BuilderDraft) => {
    setDraft(d);
    if (d.recommendedPluginIds) setSelectedPluginIds(d.recommendedPluginIds.map(Number));
    if (d.recommendedKbIds) setSelectedKbIds(d.recommendedKbIds.map(Number));
  };

  const send = async () => {
    if (!conversationId || !input.trim() || generating) return;
    const query = input.trim();
    const fileIds = files.map((f) => f.id);
    setMessages((m) => [
      ...m,
      { role: 'user', content: query },
      { role: 'assistant', content: '' },
    ]);
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
      message.error((e as Error)?.message ?? '发送失败');
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    await consumeBuilderRun(
      resp.runId,
      {
        onDelta: (t) =>
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = {
              role: 'assistant',
              content: next[next.length - 1].content + t,
            };
            return next;
          }),
        onDraftUpdate: applyDraft,
        onError: (err) => message.error(err.message),
        onDone: () => setGenerating(false),
      },
      ac.signal,
    );
  };

  const uploadFile = async (file: File) => {
    try {
      const r = await upload<{ id: number; filename: string }>('/agent/files', file);
      setFiles((f) => [...f, { id: Number(r.id), name: r.filename ?? file.name }]);
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/console/agents')}>
          返回
        </Button>
        <Text strong>AI 对话生成 Agent</Text>
      </Space>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* 左：聊天 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 12,
              background: '#fafafa',
              borderRadius: 8,
            }}
          >
            {messages.length === 0 && (
              <Text type="secondary">
                描述你想要的 Agent，比如「做一个处理售后退货的客服助手，语气友好专业」。
              </Text>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{ marginBottom: 12, textAlign: m.role === 'user' ? 'right' : 'left' }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    maxWidth: '80%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    whiteSpace: 'pre-wrap',
                    background: m.role === 'user' ? '#1677ff' : '#fff',
                    color: m.role === 'user' ? '#fff' : undefined,
                    border: m.role === 'assistant' ? '1px solid #eee' : undefined,
                  }}
                >
                  {m.content ||
                    (generating && i === messages.length - 1 ? <Spin size="small" /> : '')}
                </div>
              </div>
            ))}
          </div>

          {!!files.length && (
            <Space wrap style={{ margin: '8px 0' }}>
              {files.map((f) => (
                <Text key={f.id} code>
                  📎 {f.name}
                </Text>
              ))}
            </Space>
          )}

          <Space.Compact style={{ marginTop: 8 }}>
            <Upload beforeUpload={uploadFile} showUploadList={false} multiple>
              <Button icon={<PaperClipOutlined />} />
            </Upload>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="输入消息，Enter 发送"
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={generating}
              onClick={() => void send()}
            >
              发送
            </Button>
          </Space.Compact>
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
