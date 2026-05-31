import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Space, Tag, Typography } from 'antd';
import { SendOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons';
import MessageBubble from './MessageBubble';
import { useSSE } from '@/features/chat-admin/hooks/useSSE';
import { newMessage, type ChatMessage, type MessageSegment } from '@/features/chat-admin/types';
import type { ChatCitation, ChatMessageHistoryItem } from '@/api/types';

/** 助手回复完成时回传的元信息（用于持久化）。 */
export interface AssistantMessageMeta {
  citations?: ChatCitation[];
  /** 仅含工具调用的回复才有，用于刷新后还原过程 */
  segments?: MessageSegment[];
  elapsedMs?: number;
}

interface Props {
  agentId?: string;
  kbId?: string;
  topK?: number;
  rerank?: boolean;
  simple?: boolean;
  placeholder?: string;
  /** 初始消息（用于恢复已落库的会话历史）。 */
  initialMessages?: ChatMessage[];
  /** 每次用户发送消息时回调（用于持久化用户消息）。 */
  onSubmit?: (text: string) => void;
  /** assistant 回复完成时回调（用于持久化助手消息）。 */
  onAssistantMessage?: (text: string, meta: AssistantMessageMeta) => void;
}

export default function ChatPanel({
  agentId,
  kbId,
  topK,
  rerank,
  simple,
  placeholder,
  initialMessages,
  onSubmit,
  onAssistantMessage,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sse = useSSE();

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
    onSubmit?.(queryText);
    const userMsg = newMessage('user', queryText);
    const assistantMsg = newMessage('assistant', '');
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    sse.start(
      {
        agentId,
        kbId,
        query: queryText,
        topK,
        rerank,
        history,
      },
      ({ text: finalText, citations, segments, elapsedMs }) => {
        // 仅含工具调用的回复才落库 segments；纯文本回复刷新后回退渲染 content 即可。
        const hasTool = segments.some((s) => s.type === 'tool');
        const persistedSegments = hasTool ? segments : undefined;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: finalText, citations, segments, elapsedMs, status: 'done' }
              : m,
          ),
        );
        onAssistantMessage?.(finalText, { citations, segments: persistedSegments, elapsedMs });
      },
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
          m.id === last.id
            ? { ...m, status: 'error', errorMessage: sse.error ?? '未知错误' }
            : m,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 80 }}>
            <Typography.Text type="secondary">
              {placeholder || '试着提一个问题，开始对话吧'}
            </Typography.Text>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', padding: 12, background: '#fff' }}>
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
          </Space>
        )}
        <Space.Compact style={{ width: '100%' }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            autoSize={{ minRows: 1, maxRows: 6 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isStreaming) submit(input.trim());
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => input.trim() && !isStreaming && submit(input.trim())}
            disabled={!input.trim() || isStreaming}
          >
            发送
          </Button>
        </Space.Compact>
      </div>
    </div>
  );
}
