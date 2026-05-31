import { Avatar, Space, Tag, Tooltip, Button } from 'antd';
import {
  CopyOutlined,
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { App } from 'antd';
import dayjs from 'dayjs';
import Markdown from '@/components/Markdown';
import type { ChatMessage, ToolCallView } from '@/features/chat-admin/types';

interface Props {
  message: ChatMessage;
  onCitationClick?: (index: number) => void;
}

/** 消息时间：当天只显示时分秒，跨天补上日期 */
function formatClock(ts: number): string {
  const d = dayjs(ts);
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm:ss') : d.format('YYYY-MM-DD HH:mm');
}

/** 总耗时：毫秒 → 人类可读。先取整秒再拆分，避免分钟边界出现「X 分 60 秒」。 */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${Math.floor(total / 60)} 分 ${total % 60} 秒`;
}

function formatToolInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('，');
  }
  return typeof input === 'string' ? input : JSON.stringify(input);
}

function ToolCallPill({ tc }: { tc: ToolCallView }) {
  const icon =
    tc.status === 'running' ? (
      <LoadingOutlined spin />
    ) : tc.status === 'success' ? (
      <CheckCircleOutlined style={{ color: '#52c41a' }} />
    ) : (
      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
    );
  const verb = tc.status === 'running' ? '正在调用工具' : tc.status === 'success' ? '已调用工具' : '工具调用失败';
  const inputStr = formatToolInput(tc.input);
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: '#595959',
        background: '#f5f5f5',
        border: '1px solid #eee',
        borderRadius: 6,
        padding: '4px 10px',
        marginRight: 6,
        marginBottom: 6,
      }}
    >
      {icon}
      <span>
        {verb} <b>{tc.name}</b>
        {tc.desc ? <span style={{ color: '#8c8c8c' }}>（{tc.desc}）</span> : null}
        {inputStr ? <span style={{ color: '#8c8c8c' }}> · {inputStr}</span> : null}
      </span>
    </div>
  );
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
        {isUser ? (
          <div className="chat-bubble-user">
            <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
          </div>
        ) : message.segments && message.segments.length > 0 ? (
          // 有序片段：叙述文本 → 工具调用 → 答案，按真实发生顺序交错渲染
          message.segments.map((seg, i) => {
            if (seg.type === 'tool') {
              return (
                <div key={`t${i}`} style={{ marginBottom: 8 }}>
                  <ToolCallPill tc={seg.call} />
                </div>
              );
            }
            const isLast = i === message.segments!.length - 1;
            return (
              <div key={`s${i}`} className="chat-bubble-assistant" style={{ marginBottom: 8 }}>
                <Markdown content={seg.text} cursor={isLast && message.status === 'streaming'} />
              </div>
            );
          })
        ) : (
          <div className="chat-bubble-assistant">
            <Markdown
              content={message.content || (message.status === 'streaming' ? '…' : '')}
              cursor={message.status === 'streaming'}
            />
          </div>
        )}
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
        {message.status !== 'streaming' && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: '#bfbfbf',
              textAlign: isUser ? 'right' : 'left',
            }}
          >
            {formatClock(message.createdAt)}
            {!isUser && message.elapsedMs != null && (
              <span> · 总耗时 {formatElapsed(message.elapsedMs)}</span>
            )}
          </div>
        )}
      </div>
      {isUser && <Avatar icon={<UserOutlined />} style={{ marginLeft: 8 }} />}
    </div>
  );
}
