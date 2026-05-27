import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Input, Space, Tag, Typography } from 'antd';
import { SendOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons';
import MessageBubble from './MessageBubble';
import { useSSE } from '@/features/chat-admin/hooks/useSSE';
import { newMessage, type ChatMessage } from '@/features/chat-admin/types';
import type { ChatCitation, ChatMessageHistoryItem } from '@/api/types';

interface Props {
  agentId?: string;
  kbId?: string;
  topK?: number;
  rerank?: boolean;
  simple?: boolean;
  placeholder?: string;
}

export default function ChatPanel({ agentId, kbId, topK, rerank, simple, placeholder }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [citationOpen, setCitationOpen] = useState<ChatCitation | null>(null);
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
      (finalText, citations) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: finalText, citations, status: 'done' }
              : m,
          ),
        );
      },
    );
  };

  useEffect(() => {
    if (sse.status === 'streaming' || sse.status === 'done') {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return prev.map((m) =>
          m.id === last.id ? { ...m, content: sse.text, citations: sse.citations } : m,
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
  }, [sse.status, sse.text, sse.citations, sse.error]);

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
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onCitationClick={(idx) => {
                const c = m.citations?.find((x) => x.index === idx);
                if (c) setCitationOpen(c);
              }}
            />
          ))
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

      <Drawer
        open={!!citationOpen}
        onClose={() => setCitationOpen(null)}
        title={citationOpen ? `引用 [${citationOpen.index}]` : ''}
        width={480}
      >
        {citationOpen && (
          <div>
            <Typography.Title level={5}>{citationOpen.docTitle ?? '未知文档'}</Typography.Title>
            <Typography.Paragraph>{citationOpen.content}</Typography.Paragraph>
          </div>
        )}
      </Drawer>
    </div>
  );
}
