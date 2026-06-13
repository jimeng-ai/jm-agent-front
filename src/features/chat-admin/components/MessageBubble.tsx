import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, Image, Spin } from 'antd';
import {
  CopyOutlined,
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  FileOutlined,
  DownOutlined,
  RightOutlined,
  CodeOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { App } from 'antd';
import dayjs from 'dayjs';
import Markdown from '@/components/Markdown';
import CitationReferences from './CitationReferences';
import AttachmentThumb from './AttachmentThumb';
import { downloadArtifact, fetchArtifactBlob } from '@/api/agentFiles';
import { glyphColor } from '@/utils/glyph';
import type {
  ArtifactRef,
  ChatMessage,
  ChatStatus,
  MessageSegment,
  ToolCallView,
} from '@/features/chat-admin/types';

interface Props {
  message: ChatMessage;
  /** Agent 名称/头像：助手气泡用它显示真实 Agent 头像（缺省回退到机器人图标）。 */
  agentName?: string;
  agentAvatar?: string;
}

/** 去掉模型可能残留的引用标记（如 [chunk_id=123_0]）。新链路已禁止输出，这里兜底旧消息/越界情况。 */
function stripRefMarkers(text: string): string {
  return text.replace(/\s*\[chunk_id=[^\]]*\]/g, '');
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
  const verb =
    tc.status === 'running'
      ? '正在调用工具'
      : tc.status === 'success'
        ? '已调用工具'
        : '工具调用失败';
  const inputStr = formatToolInput(tc.input);
  return (
    <div>
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
      {tc.output ? (
        <pre
          style={{
            margin: '0 0 6px',
            padding: 8,
            background: '#0f172a',
            color: '#e2e8f0',
            borderRadius: 6,
            fontSize: 12,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {tc.output.length > 4000 ? `${tc.output.slice(0, 4000)}\n…（已截断）` : tc.output}
        </pre>
      ) : null}
    </div>
  );
}

/** 产物是否为图片：优先看 contentType，回退看扩展名。 */
function isImageArtifact(a: ArtifactRef): boolean {
  if (a.contentType?.toLowerCase().startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(a.filename);
}

/**
 * 代码执行 Agent 产物。
 * - 图片：内联预览缩略图（antd Image 自带点击放大 / 缩放工具栏）+ 文件名 + 下载。
 * - 其它：文件名 + 下载按钮。
 * 下载端点需鉴权头，预览用 fetchArtifactBlob 取 blob 转 objectURL（裸 <img src> 取不到）。
 */
/** 取产物图片 blob 并转 objectURL（下载端点需鉴权头，裸 <img src> 取不到）；组件卸载时回收。 */
function useArtifactBlobUrl(artifactId: string | number, enabled: boolean) {
  const [src, setSrc] = useState<string>();
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let url: string | undefined;
    fetchArtifactBlob(artifactId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => !cancelled && setErr(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artifactId, enabled]);
  return { src, err };
}

function ArtifactCard({ artifact }: { artifact: ArtifactRef }) {
  const { message: toast } = App.useApp();
  const [loading, setLoading] = useState(false);
  const isImage = isImageArtifact(artifact);
  const { src, err: previewErr } = useArtifactBlobUrl(artifact.artifactId, isImage);

  const onDownload = async () => {
    setLoading(true);
    try {
      await downloadArtifact(artifact.artifactId, artifact.filename);
    } catch (e) {
      toast.error(`下载失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const fileBar = (
    <div className="artifact-card__bar">
      <FileOutlined style={{ color: '#52c41a' }} />
      <span className="artifact-card__name">{artifact.filename}</span>
      <Button
        type="link"
        size="small"
        icon={<DownloadOutlined />}
        loading={loading}
        onClick={onDownload}
      >
        下载
      </Button>
    </div>
  );

  // 图片预览失败时退化为普通文件 chip，保证至少能下载。
  if (isImage && !previewErr) {
    // 图片预览成功时不再展示下方文件名/下载条：点击图片即可放大查看（antd Image 自带预览）。
    return (
      <div className="artifact-card artifact-card--image">
        {src ? (
          // antd Image 默认开启预览：点击即放大，带缩放/旋转工具栏
          <Image src={src} alt={artifact.filename} rootClassName="artifact-card__img" />
        ) : (
          <div className="artifact-card__img-loading">
            <Spin />
          </div>
        )}
      </div>
    );
  }

  return <div className="artifact-card">{fileBar}</div>;
}

/** 网格里的单张产物缩略图：固定高度、cover 裁切；点击由外层 Image.PreviewGroup 放大并可左右切换。 */
function GridImage({ artifact }: { artifact: ArtifactRef }) {
  const { src, err } = useArtifactBlobUrl(artifact.artifactId, true);
  // 预览失败时退化为可下载的文件 chip（ArtifactCard 自带 previewErr 兜底）。
  if (err) return <ArtifactCard artifact={artifact} />;
  return (
    <div
      style={{
        height: 132,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src ? (
        <Image
          src={src}
          alt={artifact.filename}
          width="100%"
          height={132}
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <Spin />
      )}
    </div>
  );
}

/** 多张图片产物：网格缩略图布局，避免每张占一整行把对话拉得太长；点任一张放大并可左右切换浏览整组。 */
function ArtifactImageGrid({ artifacts }: { artifacts: ArtifactRef[] }) {
  // 单张时退化为原来的内联预览，保持小批量场景观感不变。
  if (artifacts.length === 1) {
    return (
      <div style={{ marginBottom: 8 }}>
        <ArtifactCard artifact={artifacts[0]} />
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <Image.PreviewGroup>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 8,
          }}
        >
          {artifacts.map((a) => (
            <GridImage key={a.artifactId} artifact={a} />
          ))}
        </div>
      </Image.PreviewGroup>
    </div>
  );
}

/** 思考计时器：用户发消息后、模型尚未输出内容时，实时显示已用秒数（每 100ms 走动）。 */
function ThinkingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, (now - startedAt) / 1000);
  return (
    <span className="chat-thinking">
      <span className="chat-thinking-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="chat-thinking-text">思考中 {sec.toFixed(1)}s</span>
    </span>
  );
}

/** 把连续的工具步骤聚成一个可折叠块：流式中默认展开（看实时进度），完成/历史默认收起。 */
function ToolProcessGroup({
  calls,
  defaultOpen,
}: {
  calls: ToolCallView[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const running = calls.some((c) => c.status === 'running');
  return (
    <div
      style={{
        marginBottom: 8,
        border: '1px solid #eee',
        borderRadius: 8,
        background: '#fafafa',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 10px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 12,
          color: '#595959',
          textAlign: 'left',
        }}
      >
        {open ? (
          <DownOutlined style={{ fontSize: 10 }} />
        ) : (
          <RightOutlined style={{ fontSize: 10 }} />
        )}
        <CodeOutlined />
        <span>执行过程 · {calls.length} 步</span>
        {running && <LoadingOutlined spin style={{ marginLeft: 4 }} />}
        <span style={{ marginLeft: 'auto', color: '#bfbfbf' }}>{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div style={{ padding: '4px 10px 8px' }}>
          {calls.map((tc) => (
            <ToolCallPill key={tc.id} tc={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 按真实顺序渲染助手片段：连续 tool 片段折叠成「执行过程」块，text/artifact 原样穿插。 */
function renderSegments(segments: MessageSegment[], status?: ChatStatus): ReactNode[] {
  const out: ReactNode[] = [];
  let run: ToolCallView[] = [];
  let imgRun: ArtifactRef[] = [];
  const flush = () => {
    if (run.length) {
      out.push(
        <ToolProcessGroup
          key={`tg-${run[0].id}`}
          calls={run}
          defaultOpen={status === 'streaming'}
        />,
      );
      run = [];
    }
  };
  // 连续的图片产物合并成一个网格，避免每张各占一行把对话拉得过长。
  const flushImgs = () => {
    if (imgRun.length) {
      out.push(<ArtifactImageGrid key={`ig-${imgRun[0].artifactId}`} artifacts={imgRun} />);
      imgRun = [];
    }
  };
  segments.forEach((seg, i) => {
    if (seg.type === 'tool') {
      flushImgs();
      run.push(seg.call);
      return;
    }
    flush();
    if (seg.type === 'artifact') {
      if (isImageArtifact(seg.artifact)) {
        imgRun.push(seg.artifact);
      } else {
        flushImgs();
        out.push(
          <div key={`a${i}`} style={{ marginBottom: 8 }}>
            <ArtifactCard artifact={seg.artifact} />
          </div>,
        );
      }
    } else {
      flushImgs();
      const isLast = i === segments.length - 1;
      out.push(
        <div key={`s${i}`} className="chat-bubble-assistant" style={{ marginBottom: 8 }}>
          <Markdown content={stripRefMarkers(seg.text)} cursor={isLast && status === 'streaming'} />
        </div>,
      );
    }
  });
  flush();
  flushImgs();
  return out;
}

export default function MessageBubble({ message, agentName, agentAvatar }: Props) {
  const { message: toast } = App.useApp();
  const isUser = message.role === 'user';

  // 助手头像：优先真实 Agent 头像 → 名称首字 glyph（与顶栏/空状态一致）→ 兜底机器人图标。
  const assistantAvatar = agentAvatar ? (
    <Avatar src={agentAvatar} style={{ marginRight: 8, flexShrink: 0 }} />
  ) : agentName ? (
    <Avatar
      style={{
        marginRight: 8,
        flexShrink: 0,
        background: glyphColor(agentName).bg,
        color: glyphColor(agentName).fg,
        fontWeight: 600,
      }}
    >
      {agentName.slice(0, 1)}
    </Avatar>
  ) : (
    <Avatar icon={<RobotOutlined />} style={{ marginRight: 8, flexShrink: 0 }} />
  );

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
      }}
    >
      {!isUser && assistantAvatar}
      <div style={{ maxWidth: '80%' }}>
        {isUser ? (
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  justifyContent: 'flex-end',
                  marginBottom: 6,
                }}
              >
                {message.attachments.map((a, i) => (
                  <AttachmentThumb key={`${a.fileId}-${i}`} item={a} />
                ))}
              </div>
            )}
            {message.content && (
              <div className="chat-bubble-user">
                <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
              </div>
            )}
          </>
        ) : (
          <>
            {message.segments && message.segments.length > 0 ? (
              // 有序片段：叙述文本 → 「执行过程」折叠块 → 产物 → 答案，按真实发生顺序交错渲染
              renderSegments(message.segments, message.status)
            ) : message.content ? (
              <div className="chat-bubble-assistant">
                <Markdown
                  content={stripRefMarkers(message.content)}
                  cursor={message.status === 'streaming'}
                />
              </div>
            ) : null}
            {/* 只要还在流式（初始思考 / 步骤之间 / 生成文字中），常驻一个走动的计时器，
                让用户始终知道模型仍在运行。完成后由底部「总耗时」接管。 */}
            {message.status === 'streaming' && (
              <div style={{ marginTop: message.content || message.segments?.length ? 6 : 0 }}>
                <ThinkingTimer startedAt={message.createdAt} />
              </div>
            )}
          </>
        )}
        {!isUser && <CitationReferences citations={message.citations} />}
        {!isUser && message.status === 'cancelled' && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 6,
              fontSize: 12,
              color: 'var(--text-3)',
            }}
          >
            <StopOutlined style={{ fontSize: 12 }} />
            {message.content || message.segments?.length ? '已停止生成' : '已停止生成，未产生回复'}
          </div>
        )}
        {!isUser &&
          (message.status === 'done' || message.status === 'cancelled') &&
          message.content && (
            <div style={{ marginTop: 4 }}>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(stripRefMarkers(message.content));
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
