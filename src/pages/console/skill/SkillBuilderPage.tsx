import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  consumeSkillBuilderRun,
  skillBuilderApi,
  toFileViews,
  type BuilderDraft,
  type BuilderMessageView,
  type BuilderSession,
  type ReviewMeta,
  type SkillRunHandlers,
  type SkillType,
  type ToolCallEvent,
} from '@/features/skill/builderApi';
import ReviewFrame from '@/features/skill/components/ReviewFrame';
import Markdown from '@/components/Markdown';
import AttachmentThumb from '@/features/chat-admin/components/AttachmentThumb';
import MessageBubble from '@/features/chat-admin/components/MessageBubble';
import MessageComposer from '@/features/chat-admin/components/MessageComposer';
import { useAttachments } from '@/features/chat-admin/hooks/useAttachments';
import {
  newMessage,
  type ChatAttachment,
  type ChatMessage,
  type MessageSegment,
} from '@/features/chat-admin/types';
import FileTabsViewer from './components/FileTabsViewer';
import './skill.css';

const { Title, Text } = Typography;

const TYPE_LABEL: Record<SkillType, string> = { PROMPT: '对话内注入', DOER: '沙箱执行' };
const TYPE_COLOR: Record<SkillType, string> = { PROMPT: 'purple', DOER: 'orange' };

type PaneKey = 'draft' | 'review' | 'report';

/** 工具调用在聊天里的一句话说明。子 agent（Agent 工具）用它自己的 description。 */
function describeCall(c: ToolCallEvent): string | undefined {
  const input = (c.input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (c.name) {
    case 'Agent':
    case 'Task':
      return s('description') ? `子任务：${s('description')}` : '子任务';
    case 'Skill':
      return `加载 ${s('skill') ?? s('command') ?? 'skill'}`;
    case 'Bash':
      return s('description') ?? (s('command') ? s('command')!.slice(0, 80) : undefined);
    case 'Read':
    case 'Write':
    case 'Edit':
      return s('file_path')?.replace(/^\/work\//, '');
    default:
      return undefined;
  }
}

/** 后端消息 → 聊天气泡（恢复会话用）。 */
function toChatMessage(m: BuilderMessageView): ChatMessage {
  const failed = m.status === 'FAILED' || m.status === 'CANCELLED';
  return {
    id: String(m.id),
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content ?? '',
    segments: Array.isArray(m.segments) ? (m.segments as MessageSegment[]) : undefined,
    attachments: Array.isArray(m.attachments) ? (m.attachments as ChatAttachment[]) : undefined,
    status: m.status === 'GENERATING' ? 'streaming' : failed ? 'error' : 'done',
    createdAt: m.createTime ? Date.parse(m.createTime) : Date.now(),
  };
}

function DraftPane({
  draft,
  override,
  onTypeChange,
  disabled,
}: {
  draft: BuilderDraft | null;
  override: SkillType | null;
  onTypeChange: (t: SkillType | null) => void;
  disabled: boolean;
}) {
  if (!draft) {
    return (
      <Empty
        style={{ marginTop: 60 }}
        description="还没有草稿。和构建器聊聊你想做的 skill，它会在工作区里写出 SKILL.md。"
      />
    );
  }
  const others = draft.files.filter((f) => f.path !== 'SKILL.md');
  const frontmatter = draft.skillMd.slice(0, draft.skillMd.length - draft.body.length).trim();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          {draft.name || draft.dirName}
        </Title>
        <Space size={6} style={{ marginTop: 6 }} wrap>
          <Tag color={TYPE_COLOR[draft.effectiveType]}>{TYPE_LABEL[draft.effectiveType]}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已跑 {draft.iterations} 轮测试
          </Text>
        </Space>
      </div>
      {draft.description && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {draft.description}
        </Text>
      )}
      <div>
        <Text strong style={{ fontSize: 13 }}>
          运行方式
        </Text>
        <Select
          size="small"
          style={{ width: '100%', marginTop: 6 }}
          disabled={disabled}
          value={override ?? 'AUTO'}
          onChange={(v: string) => onTypeChange(v === 'AUTO' ? null : (v as SkillType))}
          options={[
            { value: 'AUTO', label: `自动（按附带文件推断：${TYPE_LABEL[draft.inferredType]}）` },
            { value: 'PROMPT', label: '对话内注入 —— 只用 SKILL.md，不能跑脚本' },
            { value: 'DOER', label: '沙箱执行 —— 可以跑脚本、读附带文件' },
          ]}
        />
      </div>
      {draft.validationErrors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="还不能发布：SKILL.md 不符合 skill-creator 的校验规则"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {draft.validationErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          }
        />
      )}
      {draft.otherSkillDirs.length > 0 && (
        <Alert
          type="info"
          showIcon
          message={`工作区里还有别的 skill 目录（${draft.otherSkillDirs.join('、')}），这里显示并将发布的是「${draft.dirName}」`}
        />
      )}
      <div>
        <Text strong style={{ fontSize: 13 }}>
          SKILL.md
        </Text>
        {frontmatter && <pre className="skill-frontmatter">{frontmatter}</pre>}
        <div className="skill-md-body">
          <Markdown content={draft.body} />
        </div>
      </div>
      {others.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            附带文件（{others.length}）
          </Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            根目录 evals/ 是测试用例，只存档、不会下发给运行
          </Text>
          <div style={{ marginTop: 6 }}>
            <FileTabsViewer files={toFileViews(others)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SkillBuilderPage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [session, setSession] = useState<BuilderSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [review, setReview] = useState<ReviewMeta | null>(null);
  const [hasReport, setHasReport] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [pane, setPane] = useState<PaneKey>('draft');
  const [reviewDoc, setReviewDoc] = useState<{
    iteration: number;
    updatedAt: string | null;
    html: string | null;
    saved: unknown;
    tooLarge: boolean;
  } | null>(null);
  const [reportDoc, setReportDoc] = useState<{ html: string | null; tooLarge: boolean } | null>(null);
  const [workspaceNote, setWorkspaceNote] = useState<string>();
  const [input, setInput] = useState('');
  const att = useAttachments();
  const [publishing, setPublishing] = useState(false);
  const [sending, setSending] = useState(false);

  const abortRef = useRef<AbortController>();
  const composingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string>();
  const segsRef = useRef<MessageSegment[]>([]);
  const subCountsRef = useRef<Map<string, number>>(new Map());
  const flushRef = useRef<number>();
  const reviewIterRef = useRef<number | null>(null);
  const turnInFlightRef = useRef(false);

  const running = !!runId;
  const busy = sending || running;
  const sessionId = session?.sessionId;
  const readOnly = !!session && session.status !== 'ACTIVE';
  const started = messages.length > 0 || !!draft;

  // ---------------------------------------------------------------- 流 → 聊天片段

  const commit = useCallback(() => {
    if (flushRef.current) return;
    flushRef.current = requestAnimationFrame(() => {
      flushRef.current = undefined;
      const segs = [...segsRef.current];
      const text = segs.map((s) => (s.type === 'text' ? s.text : '')).join('');
      setMessages((list) =>
        list.map((m) => (m.id === activeIdRef.current ? { ...m, segments: segs, content: text } : m)),
      );
    });
  }, []);

  const patchActive = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((list) => list.map((m) => (m.id === activeIdRef.current ? fn(m) : m)));
  }, []);

  const applyDraftUpdate = useCallback((d: BuilderDraft | null, r: ReviewMeta | null, report: boolean) => {
    setDraft(d);
    setReview(r);
    setHasReport(report);
    // 出现新一轮评审页且还没交反馈：切过去——skill-creator 这时会让用户「去右侧评审页看看」。
    if (r && r.iteration !== reviewIterRef.current && !r.feedbackSubmitted) setPane('review');
    reviewIterRef.current = r?.iteration ?? null;
  }, []);

  const handlers = useCallback(
    (): SkillRunHandlers => ({
      onDelta: (t) => {
        const segs = segsRef.current;
        const last = segs[segs.length - 1];
        if (last && last.type === 'text') segs[segs.length - 1] = { type: 'text', text: last.text + t };
        else segs.push({ type: 'text', text: t });
        commit();
      },
      onToolCalls: (calls) => {
        for (const c of calls) {
          if (c.parent) {
            // 子 agent 的调用不各占一行：计数挂到发起它的那个 Agent 调用上，聊天里只看到「子任务 … 已调用 N 个工具」。
            const n = (subCountsRef.current.get(c.parent) ?? 0) + 1;
            subCountsRef.current.set(c.parent, n);
            const idx = segsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === c.parent);
            const seg = segsRef.current[idx];
            if (seg && seg.type === 'tool') {
              const base = (seg.call.desc ?? '子任务').replace(/（已调用 \d+ 个工具.*）$/, '');
              segsRef.current[idx] = { type: 'tool', call: { ...seg.call, desc: `${base}（已调用 ${n} 个工具，最近：${c.name}）` } };
            }
            continue;
          }
          const seg: MessageSegment = {
            type: 'tool',
            call: { id: c.id, name: c.name, input: c.input, desc: describeCall(c), status: 'running' },
          };
          const idx = segsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === c.id);
          if (idx >= 0) segsRef.current[idx] = seg;
          else segsRef.current.push(seg);
        }
        commit();
      },
      onToolResults: (results) => {
        for (const r of results) {
          if (r.parent) continue;
          const idx = segsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === r.id);
          const seg = segsRef.current[idx];
          if (seg && seg.type === 'tool') segsRef.current[idx] = { type: 'tool', call: { ...seg.call, status: r.status } };
        }
        commit();
      },
      onCodeOutput: (e) => {
        if (e.parent) return;
        const idx = segsRef.current.findIndex((s) => s.type === 'tool' && s.call.id === e.id);
        const seg = segsRef.current[idx];
        if (seg && seg.type === 'tool') segsRef.current[idx] = { type: 'tool', call: { ...seg.call, output: e.output } };
        commit();
      },
      onWorkspace: (e) => {
        if (e.phase === 'restored') setWorkspaceNote(`已恢复工作区（${e.files ?? 0} 个文件）`);
        else if (e.phase === 'persisted')
          setWorkspaceNote(e.failed && e.failed.length ? '工作区保存不完整，部分文件未写回' : '工作区已保存');
        else if (e.phase === 'persist_failed') setWorkspaceNote('工作区保存失败：这一轮的改动可能没有留下');
      },
      onDraftUpdate: (e) => applyDraftUpdate(e.draft, e.review, e.hasOptimizationReport),
      onSummary: (s) => {
        if (s.status === 'failed' && s.errorMessage) {
          patchActive((m) => ({ ...m, status: 'error', errorMessage: s.errorMessage ?? undefined }));
        }
      },
      onError: (err) => patchActive((m) => ({ ...m, status: 'error', errorMessage: err.message })),
      onDone: () => {
        patchActive((m) => (m.status === 'error' ? m : { ...m, status: 'done' }));
        setRunId(undefined);
        qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      },
    }),
    [applyDraftUpdate, commit, patchActive, qc],
  );

  const follow = useCallback(
    async (rid: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      segsRef.current = [];
      subCountsRef.current = new Map();
      setRunId(rid);
      await consumeSkillBuilderRun(rid, handlers(), ac.signal);
    },
    [handlers],
  );

  // ---------------------------------------------------------------- 会话

  const loadSession = useCallback(
    (s: BuilderSession) => {
      setSession(s);
      const msgs = (s.messages ?? []).map(toChatMessage);
      setMessages(msgs);
      reviewIterRef.current = s.review?.iteration ?? null;
      applyDraftUpdate(s.draft, s.review, s.hasOptimizationReport);
      if (s.review && !s.review.feedbackSubmitted) setPane('review');
      if (s.activeRunId) {
        // 刷新时有一轮还在跑：把最后那条助手消息清空，从头续播（Redis Stream 里有这轮的全部事件）。
        const last = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (last) {
          activeIdRef.current = last.id;
          setMessages(msgs.map((m) => (m.id === last.id ? { ...m, content: '', segments: [], status: 'streaming' } : m)));
        }
        void follow(s.activeRunId);
      }
    },
    [applyDraftUpdate, follow],
  );

  const sessionParam = params.get('session');
  const skillIdParam = params.get('skillId');
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (sessionParam) {
        if (session?.sessionId === sessionParam) return;
        setLoading(true);
        try {
          const s = await skillBuilderApi.getSession(sessionParam);
          if (!cancelled) loadSession(s);
        } catch (e) {
          message.error((e as Error)?.message ?? '打开会话失败');
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else if (!skillIdParam && session) {
        // 点了「新会话」：清空上一个会话的一切，回到落地页（新会话在第一句话发出时才创建）。
        abortRef.current?.abort();
        activeIdRef.current = undefined;
        reviewIterRef.current = null;
        setSession(null);
        setMessages([]);
        setDraft(null);
        setReview(null);
        setHasReport(false);
        setRunId(undefined);
        setReviewDoc(null);
        setReportDoc(null);
        setPane('draft');
        setWorkspaceNote(undefined);
      } else if (skillIdParam) {
        setLoading(true);
        try {
          const s = await skillBuilderApi.createSession(skillIdParam);
          if (!cancelled) {
            loadSession(s);
            setParams({ session: s.sessionId }, { replace: true });
          }
        } catch (e) {
          message.error((e as Error)?.message ?? '打开改进会话失败');
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // session 只用来防重复加载，不作为依赖（加载完它就变了）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam, skillIdParam, loadSession, message, setParams]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // 评审页 / 触发优化报告：切到对应标签、或有新一轮时再取（页面可能很大，不跟着草稿每次都拉）。
  useEffect(() => {
    if (!sessionId || pane !== 'review' || !review) return;
    // 同一轮的评审页会被重新生成（打完分后再跑一次 generate_review）：轮次与更新时间都没变才不重取，
    // 否则提交反馈后也会重取、把 iframe 里正在填的内容冲掉。
    if (reviewDoc && reviewDoc.iteration === review.iteration && reviewDoc.updatedAt === review.updatedAt) return;
    let cancelled = false;
    skillBuilderApi
      .getReview(sessionId)
      .then((r) => {
        if (!cancelled && r)
          setReviewDoc({ iteration: r.iteration, updatedAt: review.updatedAt, html: r.html, saved: r.feedback, tooLarge: r.tooLarge });
      })
      .catch((e: Error) => message.error(e?.message ?? '读取评审页失败'));
    return () => {
      cancelled = true;
    };
  }, [sessionId, pane, review, reviewDoc, message]);

  useEffect(() => {
    if (!sessionId || pane !== 'report' || !hasReport || reportDoc) return;
    skillBuilderApi
      .getOptimizationReport(sessionId)
      .then((r) => r && setReportDoc({ html: r.html, tooLarge: r.tooLarge }))
      .catch((e: Error) => message.error(e?.message ?? '读取触发优化报告失败'));
  }, [sessionId, pane, hasReport, reportDoc, message]);

  // 一轮结束后报告可能更新了：下次切过去重新取。
  useEffect(() => {
    if (!running) setReportDoc(null);
  }, [running]);

  // ---------------------------------------------------------------- 发送

  const startTurn = async (query: string, attachments: ChatAttachment[] = []) => {
    if (!query.trim() || turnInFlightRef.current || running || readOnly) return;
    turnInFlightRef.current = true;
    setSending(true);
    try {
      let sid = sessionId;
      if (!sid) {
        try {
          const s = await skillBuilderApi.createSession();
          setSession(s);
          sid = s.sessionId;
          setParams({ session: sid }, { replace: true });
        } catch (e) {
          message.error((e as Error)?.message ?? '开会话失败');
          return;
        }
      }
      // fileId 是 19 位雪花 Long，后端以字符串下发；必须以字符串传回，Number() 会丢精度→「文件不存在」。
      const fileIds = attachments.map((a) => String(a.fileId));
      const userMsg: ChatMessage = { ...newMessage('user', query), attachments: attachments.length ? attachments : undefined };
      const aiMsg = newMessage('assistant', '');
      activeIdRef.current = aiMsg.id;
      setMessages((m) => [...m, userMsg, aiMsg]);
      setInput('');
      att.reset();
      setWorkspaceNote(undefined);
      let resp;
      try {
        resp = await skillBuilderApi.startTurn(sid, {
          query,
          fileIds: fileIds.length ? fileIds : undefined,
          attachments: attachments.length ? attachments : undefined,
        });
      } catch (e) {
        patchActive((m) => ({ ...m, status: 'error', errorMessage: (e as Error)?.message ?? '发送失败' }));
        return;
      }
      await follow(resp.runId);
    } finally {
      turnInFlightRef.current = false;
      setSending(false);
    }
  };

  const send = () => {
    const ready = att.attached.filter((a) => !a.uploading);
    void startTurn(input.trim(), ready);
  };

  const stop = async () => {
    if (!runId) return;
    try {
      await skillBuilderApi.cancelRun(runId);
      message.info('已请求停止；这一轮已完成的部分会保存在工作区里');
    } catch (e) {
      message.error((e as Error)?.message ?? '停止失败');
    }
  };

  const changeType = async (t: SkillType | null) => {
    if (!sessionId) return;
    try {
      await skillBuilderApi.setSkillType(sessionId, t);
      setSession((s) => (s ? { ...s, skillTypeOverride: t } : s));
      setDraft((d) => (d ? { ...d, effectiveType: t ?? d.inferredType } : d));
    } catch (e) {
      message.error((e as Error)?.message ?? '设置失败');
    }
  };

  const publish = () => {
    if (!sessionId || !draft) return;
    const improving = !!session?.baseSkillId;
    modal.confirm({
      title: improving ? `发布「${draft.name}」的新版本？` : `发布「${draft.name}」？`,
      content: (
        <div style={{ fontSize: 13 }}>
          <div>运行方式：{TYPE_LABEL[draft.effectiveType]}</div>
          <div>已跑测试：{draft.iterations} 轮</div>
          <div style={{ marginTop: 6, color: '#8c8c8c' }}>
            {improving
              ? `发布后成为 v${(session?.baseVersion ?? 0) + 1}，旧版本保留可追溯。`
              : '发布后出现在技能列表里（仅自己可见，可再共享给团队），可以绑定到 Agent。'}
          </div>
        </div>
      ),
      okText: '发布',
      cancelText: '再看看',
      onOk: async () => {
        setPublishing(true);
        try {
          const r = await skillBuilderApi.publish(sessionId);
          qc.invalidateQueries({ queryKey: ['skill'] });
          setSession((s) => (s ? { ...s, status: 'PUBLISHED' } : s));
          modal.success({
            title: `已发布「${r.name}」v${r.version}`,
            content: r.warnings.length ? (
              <div>
                <div style={{ marginBottom: 6 }}>值得留意：</div>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {r.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : undefined,
            okText: '查看 skill',
            onOk: () => navigate(`/console/skills?skillId=${r.skillId}`),
          });
        } catch (e) {
          message.error((e as Error)?.message ?? '发布失败');
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  // ---------------------------------------------------------------- 视图

  const title = session?.baseSkillName ? `用 AI 改进「${session.baseSkillName}」` : 'AI 生成 Skill';
  const canPublish = !!draft && draft.validationErrors.length === 0 && !busy && !readOnly;
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <Space>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/console/skills')}>
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {title}
        </Title>
        {session?.status === 'PUBLISHED' && <Tag color="green">已发布</Tag>}
        {busy && (
          <Tag icon={<LoadingOutlined />} color="processing">
            {running ? '构建器工作中' : '正在发送'}
          </Tag>
        )}
        {workspaceNote && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {workspaceNote}
          </Text>
        )}
      </Space>
      <Space>
        {started && (
          <Button icon={<PlusOutlined />} onClick={() => navigate('/console/skill/builder')} disabled={busy}>
            新会话
          </Button>
        )}
        {started && (
          <Tooltip title={draft?.validationErrors.length ? '先修好草稿里的校验问题' : undefined}>
            <Button type="primary" icon={<CloudUploadOutlined />} disabled={!canPublish} loading={publishing} onClick={publish}>
              {session?.baseSkillId ? '发布新版本' : '发布'}
            </Button>
          </Tooltip>
        )}
      </Space>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {header}
        <Spin style={{ marginTop: 120 }} />
      </div>
    );
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {header}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            padding: '0 40px',
          }}
        >
          <Title level={2} style={{ margin: 0 }}>
            说说你想封装的技能
          </Title>
          <Text type="secondary" style={{ fontSize: 15, textAlign: 'center', maxWidth: 680 }}>
            构建器按 Anthropic skill-creator 的方法工作：先问清楚用途与边界，写出 SKILL.md 草稿，再用真实的测试用例
            对照「用 skill / 不用 skill」跑一遍，请你在评审页逐条看结果、写反馈，然后据此改进。可以附上样例文件。
          </Text>
          <div
            style={{
              width: '100%',
              maxWidth: 640,
              background: '#fff',
              border: '1px solid #e8e8e8',
              borderRadius: 16,
              padding: '16px 20px 10px',
            }}
          >
            {att.attached.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, padding: '0 2px' }}>
                {att.attached.map((a, i) => (
                  <AttachmentThumb key={`${a.fileId}-${i}`} item={a} onRemove={() => att.removeAt(i)} />
                ))}
              </div>
            )}
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              variant="borderless"
              placeholder="例如：做一个把销售 csv 汇总成 Excel 周报的 skill，金额列要能直接求和、按区域出小计…（可粘贴或上传样例文件）"
              style={{ padding: 0, fontSize: 15 }}
              onPaste={att.handlePaste}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <Upload customRequest={att.uploadFile} showUploadList={false} multiple disabled={busy}>
                <Button type="text" icon={<PaperClipOutlined />} title="上传样例文件 / 资料" disabled={busy} />
              </Upload>
              <Button
                type="primary"
                size="large"
                icon={<SendOutlined />}
                disabled={!input.trim() || att.isUploading || busy}
                loading={sending}
                onClick={send}
              >
                开始
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const reviewPane = !review ? (
    <Empty
      style={{ marginTop: 60 }}
      description="还没有评审结果。构建器跑完一轮「用 skill / 不用 skill」的对照测试后，这里会出现结果，你可以逐条写反馈。"
    />
  ) : !reviewDoc ? (
    <Spin style={{ marginTop: 60, width: '100%' }} />
  ) : reviewDoc.tooLarge || !reviewDoc.html ? (
    <Alert type="warning" showIcon message="这一轮的评审页太大，无法在这里展示" />
  ) : (
    <ReviewFrame
      key={reviewDoc.iteration}
      html={reviewDoc.html}
      saved={reviewDoc.saved}
      readOnly={readOnly}
      onSave={async (fb) => {
        const iteration = reviewDoc.iteration;
        await skillBuilderApi.saveFeedback(sessionId!, iteration, fb);
        setReviewDoc((current) =>
          current && current.iteration === iteration ? { ...current, saved: fb } : current,
        );
        if (fb.status === 'complete') setReview((r) => (r ? { ...r, feedbackSubmitted: true } : r));
      }}
      onSubmitted={() => {
        message.success('反馈已保存。回到左边告诉构建器你看完了，它会据此改进');
        if (!input.trim()) setInput('我看完评审页了，反馈已经提交，请根据反馈改进 skill。');
      }}
    />
  );

  const reportPane = !hasReport ? (
    <Empty
      style={{ marginTop: 60 }}
      description="还没有做 description 触发优化。skill 定稿后可以让构建器做：它会生成一批「该用 / 不该用」的说法，反复测试并改写 description。"
    />
  ) : !reportDoc ? (
    <Spin style={{ marginTop: 60, width: '100%' }} />
  ) : reportDoc.tooLarge || !reportDoc.html ? (
    <Alert type="warning" showIcon message="报告太大，无法在这里展示" />
  ) : (
    <ReviewFrame html={reportDoc.html} saved={null} readOnly onSave={async () => undefined} title="触发优化报告" />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      {readOnly && (
        <Alert
          style={{ marginBottom: 12 }}
          type="success"
          showIcon
          message="这个会话已经发布。要继续改，请到技能详情里点「用 AI 改进」开一个新会话。"
        />
      )}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
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
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} agentName="Skill 构建器" />
              ))}
            </div>
          </div>
          <div style={{ padding: '12px 16px 16px' }}>
            <MessageComposer
              value={input}
              onChange={setInput}
              onSubmit={(text, files) => startTurn(text, files)}
              attachments={att}
              busy={busy}
              onStop={runId ? stop : undefined}
              disabled={readOnly}
              placeholder={readOnly ? '会话已发布' : '和构建器说点什么…（可粘贴或上传样例文件）'}
              uploadTitle="上传样例文件 / 资料"
              maxRows={6}
            />
          </div>
        </div>

        <div
          style={{
            width: '46%',
            minWidth: 420,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <Tabs
            activeKey={pane}
            onChange={(k) => setPane(k as PaneKey)}
            style={{ padding: '0 16px' }}
            items={[
              { key: 'draft', label: '草稿' },
              {
                key: 'review',
                label: review ? (
                  <span>
                    评审 · 第 {review.iteration} 轮
                    {!review.feedbackSubmitted && <Tag color="gold" style={{ marginLeft: 6 }}>待反馈</Tag>}
                  </span>
                ) : (
                  '评审'
                ),
              },
              { key: 'report', label: '触发优化' },
            ]}
          />
          <div style={{ flex: 1, minHeight: 0, overflow: pane === 'draft' ? 'auto' : 'hidden', padding: pane === 'draft' ? 16 : 0 }}>
            {pane === 'draft' && (
              <DraftPane draft={draft} override={session?.skillTypeOverride ?? null} onTypeChange={changeType} disabled={busy || readOnly} />
            )}
            {pane === 'review' && reviewPane}
            {pane === 'report' && reportPane}
          </div>
        </div>
      </div>
    </div>
  );
}
