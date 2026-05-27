import { Avatar, Space, Tag, Tooltip, Button } from 'antd';
import { CopyOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { App } from 'antd';
import Markdown from '@/components/Markdown';
import type { ChatMessage } from '@/features/chat-admin/types';

interface Props {
  message: ChatMessage;
  onCitationClick?: (index: number) => void;
}

export default function MessageBubble({ message, onCitationClick }: Props) {
  const { message: toast } = App.useApp();
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
      }}
    >
      {!isUser && <Avatar icon={<RobotOutlined />} style={{ marginRight: 8 }} />}
      <div style={{ maxWidth: '80%' }}>
        <div className={isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}>
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
          ) : (
            <Markdown
              content={message.content || (message.status === 'streaming' ? '…' : '')}
              cursor={message.status === 'streaming'}
            />
          )}
        </div>
        {!isUser && message.citations && message.citations.length > 0 && (
          <Space size={[4, 4]} wrap style={{ marginTop: 6 }}>
            {message.citations.map((c) => (
              <Tooltip
                key={c.index}
                title={
                  <div style={{ maxWidth: 360 }}>
                    <div style={{ fontWeight: 600 }}>{c.docTitle ?? '引用片段'}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>{c.content}</div>
                  </div>
                }
              >
                <Tag color="blue" style={{ cursor: 'pointer' }} onClick={() => onCitationClick?.(c.index)}>
                  [{c.index}] {c.docTitle ?? '片段'}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        )}
        {!isUser && message.status === 'done' && message.content && (
          <div style={{ marginTop: 4 }}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(message.content);
                toast.success('已复制');
              }}
            >
              复制
            </Button>
          </div>
        )}
        {message.status === 'error' && message.errorMessage && (
          <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
            错误：{message.errorMessage}
          </div>
        )}
      </div>
      {isUser && <Avatar icon={<UserOutlined />} style={{ marginLeft: 8 }} />}
    </div>
  );
}
