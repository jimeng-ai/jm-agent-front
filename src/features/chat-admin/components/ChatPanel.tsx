import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { App, Button, Input, Space, Tag, Typography, Upload, type UploadProps } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import {
  SendOutlined,
  ReloadOutlined,
  PaperClipOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  ReadOutlined,
} from '@ant-design/icons';
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
import { glyphColor } from '@/utils/glyph';
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
  /** 对话为空时的引导信息（对话端传入；调试台不传，仍用 placeholder）。 */
  agentName?: string;
  agentDescription?: string;
  agentAvatar?: string;
  /** 空状态能力胶囊：当前模型。 */
  agentModel?: string;
  /** 空状态能力胶囊：已绑定知识库数量（0 则不展示该胶囊）。 */
  kbCount?: number;
  /** 空状态能力胶囊：已绑定工具数量（0 则不展示该胶囊）。 */
  toolCount?: number;
  presetQuestions?: string[];
  /** 初始消息（用于恢复已落库的会话历史）。 */
  initialMessages?: ChatMessage[];
  /** 每次用户发送消息时回调（用于持久化用户消息 + 其附件）。仅旧直连模式用。 */
  onSubmit?: (text: string, attachments?: ChatAttachment[]) => void;
  /** assistant 回复完成时回调（用于持久化助手消息）。仅旧直连模式用。 */
  onAssistantMessage?: (text: string, meta: AssistantMessageMeta) => void;
  /**
   * 提供则进入「服务端自持久化 + 可重连」模式（对话端）：发送走 /turns（服务端落库 user+assistant 并生成），
   * 不再前端 appendMessage。回调懒创建会话并返回会话 id。缺省=旧直连模式（调试台）。
   */
  onEnsureConversation?: (firstText: string) => Promise<string>;
  /** 进入会话时若最后一条助手消息仍在生成，传其 runId → 挂载即重连续播。 */
  resumeRunId?: string | null;
  /** 一轮开始/结束时回调（对话端用于刷新会话列表，清掉「正在回复」标志）。 */
  onTurnChange?: () => void;
}

export default function ChatPanel({
  agentId,
  kbId,
  topK,
  rerank,
  simple,
  preview,
  placeholder,
  agentName,
  agentDescription,
  agentAvatar,
  agentModel,
  kbCount,
  toolCount,
  presetQuestions,
  initialMessages,
  onSubmit,
  onAssistantMessage,
  onEnsureConversation,
  resumeRunId,
  onTurnChange,
}: Props) {
  const { message: toast } = App.useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<TextAreaRef>(null);
  // 本轮是否由用户主动停止：用于在收尾时把状态标成 cancelled（气泡显示「已停止生成」）。
  const stoppedRef = useRef(false);
  const sse = useSSE();
  // 提供懒创建会话回调 = 对话端：服务端自持久化 + 可重连模式。
  const resilient = !!onEnsureConversation;
  // 有附件仍在上传中：禁用发送，避免把临时占位 id 当作 fileId 发出去
  const isUploading = attached.some((a) => a.uploading);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sse.text]);

  // 发出首条消息后布局由「空状态 hero」切到「底部常驻」，输入框会在新位置重挂导致焦点丢失，
  // 用户得再点一次才能继续输入。这里在空/非空切换（及挂载）后把焦点拨回输入框，连续发送不断焦。
  const hasMessages = messages.length > 0;
  useEffect(() => {
    inputRef.current?.focus({ cursor: 'end' });
  }, [hasMessages]);

  const history: ChatMessageHistoryItem[] = useMemo(
    () =>
      messages
        .filter((m) => m.status !== 'error')
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const submit = async (queryText: string) => {
    stoppedRef.current = false; // 新一轮开始，清掉上一轮的「已停止」标记
    // 路由策略：本会话只要出现过附件，后续轮次也持续走沙箱(exec)——否则掉回 RAG 链路会
    // 丢掉文件上下文与生图工具（生图能力只在沙箱链路有）。做法：把本会话累积的所有附件
    // fileId（含刷新后从 initialMessages 恢复的历史消息）连同本轮新附件去重后一起带过去，
    // 沙箱据此把早先发的图也铺进 /work，多轮即可记住图 + 继续生图。对话端由服务端据此裁决 rag/exec。
    const newFileIds = attached.filter((a) => !a.uploading).map((a) => String(a.fileId));
    const priorFileIds = messages.flatMap((m) =>
      (m.attachments ?? []).map((a) => String(a.fileId)),
    );
    const fileIds = Array.from(new Set([...priorFileIds, ...newFileIds]));
    const mode: 'rag' | 'exec' = fileIds.length > 0 ? 'exec' : 'rag';

    const userMsg = newMessage('user', queryText);
    // 把附件挂到用户消息上，便于气泡里显示缩略图/可预览（会话内有效）
    if (attached.length > 0) userMsg.attachments = attached;
    const assistantMsg = newMessage('assistant', '');
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setAttached([]);

    if (resilient) {
      // 对话端：服务端落库 user+assistant 并生成；前端只发起 + 续播，断连/切走/刷新都不丢。
      const persistedAttachments = userMsg.attachments?.map((a) => ({
        fileId: a.fileId,
        filename: a.filename,
        contentType: a.contentType,
      }));
      try {
        const convId = await onEnsureConversation!(queryText);
        onTurnChange?.(); // 新会话先出现在列表
        await sse.startTurn(
          convId,
          {
            agentId: agentId as string,
            query: queryText,
            history,
            fileIds,
            attachments: persistedAttachments,
            kbId: kbId ? Number(kbId) : undefined,
            topK,
            rerank,
            preview,
          },
          () => onTurnChange?.(), // 完成后刷新（清掉「正在回复」）
          () => onTurnChange?.(), // 占位落库后刷新（亮起「正在回复」）
        );
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, status: 'error', errorMessage: (e as Error)?.message ?? '发送失败' }
              : m,
          ),
        );
      }
      return;
    }

    // 旧直连模式（调试台 Playground）：前端落库。
    onSubmit?.(queryText, userMsg.attachments);
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

  // 进入会话时若最后一条助手消息仍在生成 → 挂载即重连续播（切走再回来 / 刷新 / 多窗口）。
  useEffect(() => {
    if (resilient && resumeRunId) {
      sse.consume(resumeRunId, () => onTurnChange?.(), '0');
    }
    // 仅挂载时执行一次；resumeRunId 随 panelKey（会话切换）重建组件而变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sse.status === 'streaming' || sse.status === 'done') {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const done = sse.status === 'done';
        // 用户主动停止时，cancelled 终止帧也走 done 收尾——这里据 stoppedRef 标成 cancelled。
        const finalStatus = stoppedRef.current ? ('cancelled' as const) : ('done' as const);
        return prev.map((m) =>
          m.id === last.id
            ? {
                ...m,
                content: sse.text,
                citations: sse.citations,
                segments: sse.segments,
                ...(done ? { status: finalStatus, elapsedMs: sse.elapsedMs } : {}),
              }
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
  }, [sse.status, sse.text, sse.citations, sse.segments, sse.error, sse.elapsedMs]);

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

  // 上传单个文件的核心流程：临时占位缩略图 → 上传 → 替换真实 fileId / 失败移除。
  // 回形针按钮（customRequest）与「粘贴图片」（onPaste）共用同一条链路，保证两条入口行为一致。
  const uploadOne = async (file: File) => {
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
      return res;
    } catch (e) {
      // 上传失败：移除占位项并回收本地 URL
      setAttached((prev) => prev.filter((a) => a.fileId !== tempId));
      URL.revokeObjectURL(localUrl);
      toast.error(`文件上传失败：${(e as Error).message}`);
      throw e;
    }
  };

  const uploadFile: UploadProps['customRequest'] = async (options) => {
    try {
      const res = await uploadOne(options.file as File);
      options.onSuccess?.(res);
    } catch (e) {
      options.onError?.(e as Error);
    }
  };

  // 粘贴图片：从剪贴板里捞出图片项（截图 / 复制的图）直接走上传，纯文本粘贴照常进输入框。
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (isStreaming) return;
    const images = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (images.length === 0) return; // 没有图片：让默认粘贴把文本填进输入框
    e.preventDefault(); // 有图片：阻止把图片 blob 当乱码塞进文本框
    images.forEach((f) => void uploadOne(f));
  };

  const isEmpty = messages.length === 0;

  // 头像节点：空状态 hero 复用（有图用图，无图用首字 glyph）。
  const avatarNode =
    agentName &&
    (agentAvatar ? (
      <img className="chat-empty-avatar" src={agentAvatar} alt={agentName} />
    ) : (
      <div
        className="chat-empty-avatar glyph"
        style={{ background: glyphColor(agentName).bg, color: glyphColor(agentName).fg }}
      >
        {agentName.slice(0, 1)}
      </div>
    ));

  // 输入框卡片：hero（空状态居中）与底部常驻共用同一段，保证发送行为一致。
  const composer = (
    <>
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
          ref={inputRef}
          variant="borderless"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isEmpty && agentName
              ? `和 ${agentName} 说点什么…`
              : '输入消息，Enter 发送，Shift+Enter 换行'
          }
          autoSize={{ minRows: 1, maxRows: 8 }}
          style={{ padding: 0, fontSize: 14, resize: 'none' }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            // 中文/日文等输入法组词期间按回车是用来选词/上屏（keyCode 229 / isComposing），
            // 不能当成发送，否则会把还没确认的内容直接发出去。
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && !isStreaming && !isUploading) submit(input.trim());
            }
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
          <Upload customRequest={uploadFile} showUploadList={false} multiple disabled={isStreaming}>
            <Button
              type="text"
              icon={<PaperClipOutlined />}
              disabled={isStreaming}
              title="上传文件交给 Agent 处理"
            />
          </Upload>
          <div style={{ flex: 1 }} />
          {isStreaming ? (
            // 生成中：发送位变「停止」——深色圆 + 白色方块，标准停止语义，省掉上方那颗突兀的浮动按钮
            <Button
              shape="circle"
              className="chat-stop-btn"
              icon={<span className="chat-stop-square" />}
              title="停止生成"
              onClick={() => {
                stoppedRef.current = true; // 标记本轮为主动停止 → 收尾时显示「已停止生成」
                // 对话端 stop=真取消服务端生成；调试台 abort=仅断开本地直连流。
                if (resilient) sse.stop();
                else sse.abort();
              }}
            />
          ) : (
            <>
              <span className="chat-send-hint">Enter 发送</span>
              <Button
                type="text"
                shape="circle"
                className="chat-send-btn"
                icon={<SendOutlined />}
                title="发送"
                onClick={() => input.trim() && !isUploading && submit(input.trim())}
                disabled={!input.trim() || isUploading}
              />
            </>
          )}
        </div>
      </div>
    </>
  );

  // 空状态 hero：头像 / 自我介绍 / 能力胶囊 / 预设问题胶囊 / 居中输入框，整体垂直居中。
  if (isEmpty && agentName) {
    const hasChips = !!agentModel || !!kbCount || !!toolCount;
    return (
      <div className="chat-hero-wrap">
        <div className="chat-hero">
          {avatarNode}
          <h2 className="chat-empty-title">我是{agentName}</h2>
          {agentDescription && <p className="chat-empty-desc">{agentDescription}</p>}
          {hasChips && (
            <div className="chat-hero-chips">
              {agentModel && (
                <span className="chat-chip">
                  <ThunderboltOutlined />
                  {agentModel}
                </span>
              )}
              {!!kbCount && (
                <span className="chat-chip">
                  <ReadOutlined />
                  已绑定 {kbCount} 个知识库
                </span>
              )}
              {!!toolCount && (
                <span className="chat-chip">
                  <ApiOutlined />
                  {toolCount} 个工具
                </span>
              )}
            </div>
          )}
          {presetQuestions && presetQuestions.length > 0 && (
            <div className="chat-hero-pills">
              {presetQuestions.slice(0, 4).map((q, i) => (
                <button
                  key={i}
                  type="button"
                  className="chat-hero-pill"
                  disabled={isStreaming || isUploading}
                  onClick={() => submit(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="chat-hero-composer">{composer}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {isEmpty ? (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 80 }}>
            <Typography.Text type="secondary">
              {placeholder || '试着提一个问题，或上传文件让 Agent 处理'}
            </Typography.Text>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} agentName={agentName} agentAvatar={agentAvatar} />
          ))
        )}
      </div>

      <div style={{ padding: '8px 0 14px', background: '#fff' }}>
        {/* 停止已合并进输入框的发送位（生成中变停止）。这里只留调试台的「重新生成」+ 状态标签。 */}
        {!isStreaming && !simple && messages.length > 0 && (
          <Space style={{ marginBottom: 8 }}>
            <Button size="small" icon={<ReloadOutlined />} onClick={regenerate}>
              重新生成
            </Button>
            {kbId && <Tag color="blue">已挂载知识库</Tag>}
            {attached.length > 0 && <Tag color="purple">文件处理模式</Tag>}
          </Space>
        )}
        {composer}
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          Agent 可能调用工具或检索知识库，回答可能不准确，重要决策请二次确认
        </div>
      </div>
    </div>
  );
}
