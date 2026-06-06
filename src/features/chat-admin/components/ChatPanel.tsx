import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Space, Tag, Typography, Upload, type UploadProps } from 'antd';
import { SendOutlined, StopOutlined, ReloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import MessageBubble from './MessageBubble';
import AttachmentThumb from './AttachmentThumb';
import { useSSE } from '@/features/chat-admin/hooks/useSSE';
import {
  newMessage,
  type ChatAttachment,
  type ChatMessage,
  type MessageSegment,
} from '@/features/chat-admin/types';
import { uploadAgentFile } from '@/api/agentFiles';
import type { ChatCitation, ChatMessageHistoryItem } from '@/api/types';

/** 助手回复完成时回传的元信息（用于持久化）。 */
export interface AssistantMessageMeta {
  citations?: ChatCitation[];
  /** 含工具调用 / 产物的回复才有，用于刷新后还原过程 */
  segments?: MessageSegment[];
  elapsedMs?: number;
}

interface Props {
  agentId?: string;
  kbId?: string;
  topK?: number;
  rerank?: boolean;
  simple?: boolean;
  /** true=调试台：用 Agent 实时草稿配置；缺省=对话端，只读已发布快照（未发布则后端拒绝对话）。 */
  preview?: boolean;
  placeholder?: string;
  /** 初始消息（用于恢复已落库的会话历史）。 */
  initialMessages?: ChatMessage[];
  /** 每次用户发送消息时回调（用于持久化用户消息 + 其附件）。 */
  onSubmit?: (text: string, attachments?: ChatAttachment[]) => void;
  /** assistant 回复完成时回调（用于持久化助手消息）。 */
  onAssistantMessage?: (text: string, meta: AssistantMessageMeta) => void;
}

export default function ChatPanel({
  agentId,
  kbId,
  topK,
  rerank,
  simple,
  preview,
  placeholder,
  initialMessages,
  onSubmit,
  onAssistantMessage,
}: Props) {
  const { message: toast } = App.useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sse = useSSE();
  // 有附件仍在上传中：禁用发送，避免把临时占位 id 当作 fileId 发出去
  const isUploading = attached.some((a) => a.uploading);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sse.text]);

  const history: ChatMessageHistoryItem[] = useMemo(
    () =>
      messages
        .filter((m) => m.status !== 'error')
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const submit = (queryText: string) => {
    // 路由策略：本会话只要出现过附件，后续轮次也持续走沙箱(exec)——否则掉回 RAG 链路会
    // 丢掉文件上下文与生图工具（生图能力只在沙箱链路有）。做法：把本会话累积的所有附件
    // fileId（含刷新后从 initialMessages 恢复的历史消息）连同本轮新附件去重后一起带给 exec，
    // 沙箱据此把早先发的图也铺进 /work，多轮即可记住图 + 继续生图。
    const newFileIds = attached.filter((a) => !a.uploading).map((a) => String(a.fileId));
    const priorFileIds = messages.flatMap((m) =>
      (m.attachments ?? []).map((a) => String(a.fileId)),
    );
    const fileIds = Array.from(new Set([...priorFileIds, ...newFileIds]));
    const mode: 'rag' | 'exec' = fileIds.length > 0 ? 'exec' : 'rag';

    const userMsg = newMessage('user', queryText);
    // 把附件挂到用户消息上，便于气泡里显示缩略图/可预览（会话内有效）
    if (attached.length > 0) userMsg.attachments = attached;
    onSubmit?.(queryText, userMsg.attachments);
    const assistantMsg = newMessage('assistant', '');
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setAttached([]);

    sse.start(
      { agentId, kbId, query: queryText, topK, rerank, history, fileIds, preview },
      ({ text: finalText, citations, segments, elapsedMs }) => {
        // 含工具调用 / 产物的回复才落库 segments；纯文本回复刷新后回退渲染 content 即可。
        const rich = segments.some((s) => s.type === 'tool' || s.type === 'artifact');
        const persistedSegments = rich ? segments : undefined;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: finalText, citations, segments, elapsedMs, status: 'done' }
              : m,
          ),
        );
        onAssistantMessage?.(finalText, { citations, segments: persistedSegments, elapsedMs });
      },
      { mode },
    );
  };

  useEffect(() => {
    if (sse.status === 'streaming' || sse.status === 'done') {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return prev.map((m) =>
          m.id === last.id
            ? { ...m, content: sse.text, citations: sse.citations, segments: sse.segments }
            : m,
        );
      });
    }
    if (sse.status === 'error') {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return prev.map((m) =>
          m.id === last.id ? { ...m, status: 'error', errorMessage: sse.error ?? '未知错误' } : m,
        );
      });
    }
  }, [sse.status, sse.text, sse.citations, sse.segments, sse.error]);

  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((prev) => {
      const lastIdx = prev.length - 1;
      if (prev[lastIdx]?.role === 'assistant') {
        return prev.slice(0, lastIdx);
      }
      return prev;
    });
    submit(lastUser.content);
  };

  const isStreaming = sse.status === 'streaming';

  const uploadFile: UploadProps['customRequest'] = async (options) => {
    const file = options.file as File;
    // 本地预览 URL（会话内有效）：图片放大、文档新标签预览都用它
    const localUrl = URL.createObjectURL(file);
    // 临时占位 id：上传一开始就把缩略图（带 loading 态）显示出来，避免上传期间界面无反馈，
    // 用户感觉「选完图片半天才冒出来」。上传完成后据此换成真实 fileId，失败则据此移除。
    const tempId = `uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAttached((prev) => [
      ...prev,
      {
        fileId: tempId,
        filename: file.name,
        contentType: file.type,
        url: localUrl,
        uploading: true,
      },
    ]);
    try {
      const res = await uploadAgentFile(file);
      // 上传成功：把占位项替换为真实 fileId 并清除 loading 态（保留同一个本地预览 url）
      setAttached((prev) =>
        prev.map((a) =>
          a.fileId === tempId
            ? {
                fileId: res.fileId,
                filename: res.filename,
                contentType: res.contentType ?? file.type,
                url: localUrl,
              }
            : a,
        ),
      );
      options.onSuccess?.(res);
    } catch (e) {
      // 上传失败：移除占位项并回收本地 URL
      setAttached((prev) => prev.filter((a) => a.fileId !== tempId));
      URL.revokeObjectURL(localUrl);
      options.onError?.(e as Error);
      toast.error(`文件上传失败：${(e as Error).message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 80 }}>
            <Typography.Text type="secondary">
              {placeholder || '试着提一个问题，或上传文件让 Agent 处理'}
            </Typography.Text>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      <div style={{ padding: '8px 0 14px', background: '#fff' }}>
        {!simple && messages.length > 0 && (
          <Space style={{ marginBottom: 8 }}>
            {isStreaming ? (
              <Button size="small" icon={<StopOutlined />} onClick={sse.abort}>
                停止
              </Button>
            ) : (
              <Button size="small" icon={<ReloadOutlined />} onClick={regenerate}>
                重新生成
              </Button>
            )}
            {kbId && <Tag color="blue">已挂载知识库</Tag>}
            {attached.length > 0 && <Tag color="purple">文件处理模式</Tag>}
          </Space>
        )}
        {attached.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 10,
              padding: '0 2px',
            }}
          >
            {attached.map((a, i) => (
              <AttachmentThumb
                key={`${a.fileId}-${i}`}
                item={a}
                onRemove={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
        {/* 卡片式输入：文本框在上，底部一行只放「上传文件」和「发送」两个按钮 */}
        <div className="chat-input-box">
          <Input.TextArea
            variant="borderless"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            autoSize={{ minRows: 1, maxRows: 8 }}
            style={{ padding: 0, fontSize: 14, resize: 'none' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isStreaming && !isUploading) submit(input.trim());
              }
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
            <Upload
              customRequest={uploadFile}
              showUploadList={false}
              multiple
              disabled={isStreaming}
            >
              <Button
                type="text"
                icon={<PaperClipOutlined />}
                disabled={isStreaming}
                title="上传文件交给 Agent 处理"
              />
            </Upload>
            <div style={{ flex: 1 }} />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => input.trim() && !isStreaming && !isUploading && submit(input.trim())}
              disabled={!input.trim() || isStreaming || isUploading}
            >
              发送
            </Button>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          Agent 可能调用工具或检索知识库，回答可能不准确，重要决策请二次确认
        </div>
      </div>
    </div>
  );
}
