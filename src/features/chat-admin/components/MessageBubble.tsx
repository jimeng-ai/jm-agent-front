import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  StopOutlined,
  FileSearchOutlined,
  LinkOutlined,
  ApiOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { App } from 'antd';
import dayjs from 'dayjs';
import Markdown from '@/components/Markdown';
import CitationReferences from './CitationReferences';
import AttachmentThumb from './AttachmentThumb';
import { downloadArtifact, fetchArtifactBlob } from '@/api/agentFiles';
import { glyphColor } from '@/utils/glyph';
import {
  inferStepKind,
  kindLabel,
  stepTitle,
  formatStepInput,
  summarizeResult,
  type StepKind,
} from '@/features/chat-admin/utils/stepKind';
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

/** 分类 → 左侧图标。kb 检索 / tool 通用 / plugin 外联 / skill 技能。 */
function kindIcon(kind: StepKind) {
  switch (kind) {
    case 'kb':
      return <FileSearchOutlined />;
    case 'plugin':
      return <ApiOutlined />;
    case 'skill':
      return <ExperimentOutlined />;
    default:
      return <LinkOutlined />;
  }
}

/** 步骤状态图标：进行中转圈 / 成功绿勾 / 失败红叉。 */
function statusIcon(status: ToolCallView['status']) {
  if (status === 'running') return <LoadingOutlined spin />;
  if (status === 'success') return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
}

/**
 * 单个工具调用卡片：左侧彩色图标块 + 标题(+分类标签) + 入参副标题 + 右侧结果摘要/状态。
 * 原始入参/输出不丢，折进「查看详情」，展开仍是深色 pre。分类由前端启发式推断，推不准回退通用「工具」。
 */
function ToolStepCard({ tc }: { tc: ToolCallView }) {
  const [showDetail, setShowDetail] = useState(false);

  // generate_image 工具：输出为图片 URL 列表，渲染为图片画廊卡片（不走普通折叠详情）
  const imgOut =
    tc.name === 'generate_image' && tc.output && typeof tc.output === 'object'
      ? (tc.output as { urls?: string[] })
      : null;
  if (imgOut && Array.isArray(imgOut.urls) && imgOut.urls.length > 0) {
    return (
      <div className="chat-step chat-step--tool">
        <div className="chat-step__body">
          <div className="chat-step__title">生成图片（{imgOut.urls.length}）</div>
          <Image.PreviewGroup>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 8,
                marginTop: 8,
              }}
            >
              {imgOut.urls.map((url, i) => (
                <Image key={i} src={url} width="100%" style={{ borderRadius: 8 }} />
              ))}
            </div>
          </Image.PreviewGroup>
        </div>
      </div>
    );
  }

  const kind = inferStepKind(tc);
  const title = stepTitle(tc);
  const sub = formatStepInput(tc.input);
  const summary = summarizeResult(tc, kind);
  const outputString = typeof tc.output === 'string' ? tc.output : undefined;
  const hasDetail = tc.input != null || !!outputString;
  const inputPretty =
    tc.input == null
      ? ''
      : typeof tc.input === 'string'
        ? tc.input
        : JSON.stringify(tc.input, null, 2);
  const outputText = outputString
    ? outputString.length > 4000
      ? `${outputString.slice(0, 4000)}\n…（已截断）`
      : outputString
    : '';

  return (
    <div className={`chat-step chat-step--${kind}`}>
      <div className="chat-step__icon">{kindIcon(kind)}</div>
      <div className="chat-step__body">
        <div className="chat-step__title">
          <span className={title.mono ? 'chat-step__title--mono' : undefined}>{title.text}</span>
          <span className="chat-step__tag">{kindLabel(kind)}</span>
        </div>
        {sub ? <div className="chat-step__sub">{sub}</div> : null}
        {hasDetail && (
          <>
            <button className="chat-step__detail-toggle" onClick={() => setShowDetail((s) => !s)}>
              {showDetail ? <DownOutlined /> : <RightOutlined />}
              {showDetail ? '收起详情' : '查看详情'}
            </button>
            {showDetail && (
              <>
                {inputPretty ? <pre className="chat-step__pre">{inputPretty}</pre> : null}
                {outputText ? <pre className="chat-step__pre">{outputText}</pre> : null}
              </>
            )}
          </>
        )}
      </div>
      <div className="chat-step__result">
        {summary ? <span>{summary}</span> : null}
        {statusIcon(tc.status)}
      </div>
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

/**
 * 「处理过程」面板：把一轮里「最后一次工具调用之前」的所有段（叙述 + 工具卡片）收进一个可折叠块，
 * 叙述与卡片按真实顺序交错。流式中默认展开（看实时进度），完成/历史默认收起。
 */
function ToolProcessGroup({
  children,
  stepCount,
  running,
  elapsedMs,
  streaming,
}: {
  children: ReactNode;
  stepCount: number;
  running: boolean;
  elapsedMs?: number;
  streaming: boolean;
}) {
  // 流式中默认展开（看实时进度），完成/历史默认收起。
  const [open, setOpen] = useState(streaming);
  // 流式结束（streaming: true → false）时自动收起，即使用户中途手动展开过。
  const prevStreaming = useRef(streaming);
  useEffect(() => {
    if (prevStreaming.current && !streaming) setOpen(false);
    prevStreaming.current = streaming;
  }, [streaming]);
  return (
    <div className="chat-proc">
      <button className="chat-proc__head" onClick={() => setOpen((o) => !o)}>
        {open ? (
          <DownOutlined style={{ fontSize: 11, color: 'var(--text-3)' }} />
        ) : (
          <RightOutlined style={{ fontSize: 11, color: 'var(--text-3)' }} />
        )}
        <span className="chat-proc__title">处理过程</span>
        {running ? (
          <LoadingOutlined spin style={{ color: 'var(--text-3)' }} />
        ) : elapsedMs != null ? (
          <span className="chat-proc__elapsed">{formatElapsed(elapsedMs)}</span>
        ) : (
          <span className="chat-proc__elapsed">· {stepCount} 步</span>
        )}
        <span className="chat-proc__toggle">{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className="chat-proc__body">{children}</div>}
    </div>
  );
}

/** 面板内的单段：工具→卡片，叙述→无气泡纯文本，产物→卡片。 */
function ProcessItem({ seg }: { seg: MessageSegment }) {
  if (seg.type === 'tool') return <ToolStepCard tc={seg.call} />;
  if (seg.type === 'artifact') {
    return isImageArtifact(seg.artifact) ? (
      <ArtifactImageGrid artifacts={[seg.artifact]} />
    ) : (
      <ArtifactCard artifact={seg.artifact} />
    );
  }
  return (
    <div className="chat-proc__narration">
      <Markdown content={stripRefMarkers(seg.text)} />
    </div>
  );
}

/** 线性渲染答案区（无工具时即整条消息）：叙述气泡 + 连续图片合并网格 + 普通产物卡片。 */
function renderLinear(
  segs: MessageSegment[],
  status: ChatStatus | undefined,
  keyBase: number,
): ReactNode[] {
  const out: ReactNode[] = [];
  let imgRun: ArtifactRef[] = [];
  const flushImgs = () => {
    if (imgRun.length) {
      out.push(
        <ArtifactImageGrid key={`ig-${keyBase}-${imgRun[0].artifactId}`} artifacts={imgRun} />,
      );
      imgRun = [];
    }
  };
  segs.forEach((seg, i) => {
    if (seg.type === 'artifact') {
      if (isImageArtifact(seg.artifact)) {
        imgRun.push(seg.artifact);
      } else {
        flushImgs();
        out.push(
          <div key={`a${keyBase}-${i}`} style={{ marginBottom: 8 }}>
            <ArtifactCard artifact={seg.artifact} />
          </div>,
        );
      }
    } else if (seg.type === 'tool') {
      // 答案区理论上不再有工具；兜底渲染为卡片，绝不丢数据。
      flushImgs();
      out.push(
        <div key={`t${keyBase}-${i}`} style={{ marginBottom: 8 }}>
          <ToolStepCard tc={seg.call} />
        </div>,
      );
    } else {
      flushImgs();
      const isLast = i === segs.length - 1;
      out.push(
        <div key={`s${keyBase}-${i}`} className="chat-bubble-assistant" style={{ marginBottom: 8 }}>
          <Markdown content={stripRefMarkers(seg.text)} cursor={isLast && status === 'streaming'} />
        </div>,
      );
    }
  });
  flushImgs();
  return out;
}

/**
 * 按真实顺序渲染助手片段：
 * - 无工具调用：整条消息线性渲染（叙述气泡 + 产物）。
 * - 有工具调用：「最后一次工具调用（含）之前」的段全部收进「处理过程」面板（叙述与卡片交错），
 *   之后的段作为最终答案落在面板下方。
 */
function renderSegments(
  segments: MessageSegment[],
  status?: ChatStatus,
  elapsedMs?: number,
): ReactNode[] {
  let lastToolIdx = -1;
  segments.forEach((s, i) => {
    if (s.type === 'tool') lastToolIdx = i;
  });
  if (lastToolIdx === -1) return renderLinear(segments, status, 0);

  const procSegs = segments.slice(0, lastToolIdx + 1);
  const answerSegs = segments.slice(lastToolIdx + 1);
  const stepCount = procSegs.filter((s) => s.type === 'tool').length;
  const running = procSegs.some((s) => s.type === 'tool' && s.call.status === 'running');

  const out: ReactNode[] = [
    <ToolProcessGroup
      key="proc"
      stepCount={stepCount}
      running={running}
      elapsedMs={status === 'streaming' ? undefined : elapsedMs}
      streaming={status === 'streaming'}
    >
      {procSegs.map((seg, i) => (
        <ProcessItem key={`p${i}`} seg={seg} />
      ))}
    </ToolProcessGroup>,
  ];
  out.push(...renderLinear(answerSegs, status, lastToolIdx + 1));
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
              // 有序片段：叙述 + 工具卡片收进「处理过程」面板，最终答案落在下方，按真实顺序渲染
              renderSegments(message.segments, message.status, message.elapsedMs)
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
