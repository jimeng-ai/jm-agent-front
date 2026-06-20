# Skill Builder Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conversational Skill Builder page that mirrors the agent-builder UX — left chat pane + right live SkillDraft preview — wired to the backend `/data/tenant/skills/builder` endpoints.

**Architecture:** Two tasks: (1) `src/features/skill/builderApi.ts` encapsulates all HTTP + SSE for the builder endpoints; (2) `src/pages/console/skill/SkillBuilderPage.tsx` is the UI, reusing `consumeBuilderRun`-style reconnect logic ported as `consumeSkillBuilderRun`, and the existing `MessageBubble` / `newMessage` / `newMessage` helpers from `chat-admin`. Routes in `src/router/index.tsx` swap the `StubPage` for the real page. No new shared hooks needed — the SSE reconnect logic is self-contained in the builder API file, exactly like `features/agent-builder/api.ts` does it.

**Tech Stack:** React 18, TypeScript (strict, `noUnusedLocals/Params`), Vite 5, Ant Design 5, TanStack Query v5, React Router v6, `@/api/client` (`get`/`post`/`upload`), `@/api/sse` (`streamSse`), `@/api/agentFiles` (`uploadAgentFile`).

---

## File Map

| File                                           | Create / Modify | Responsibility                                                   |
| ---------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `src/features/skill/builderApi.ts`             | **Create**      | Types + API functions + SSE reconnect consumer for skill builder |
| `src/pages/console/skill/SkillBuilderPage.tsx` | **Create**      | Two-pane builder UI (chat left, live preview right)              |
| `src/router/index.tsx`                         | **Modify**      | Replace StubPage with lazy `SkillBuilderPage`                    |

---

## Task 1: `src/features/skill/builderApi.ts`

**Files:**

- Create: `src/features/skill/builderApi.ts`

### Background

The agent-builder API (`src/features/agent-builder/api.ts`) defines:

- Interfaces: `BuilderDraft`, `StartSessionResponse`, `TurnStartResponse`, `FinalizeResponse`
- HTTP helpers using `get`/`post` from `@/api/client`
- `consumeBuilderRun(runId, handlers, signal, fromId)` — reconnecting SSE consumer using `streamSse` from `@/api/sse`

We do the same, but for skills. Key differences in the backend contract:

- Base path: `/tenant/skills/builder` (not `/admin/agent-builder`)
- `SkillDraft` fields: `name`, `description`, `body` (SKILL.md text), `skillType` (`'PROMPT'|'DOER'`), `files` (`Record<string,string>` — path→content, only for DOER)
- `startSession` → `POST /sessions` → `{ conversationId, draft: SkillDraft }`
- `startTurn` → `POST /sessions/{conversationId}/turns` body `{ text: string }` → `{ runId, userMessageId, assistantMessageId }`
- stream URL: `/tenant/skills/builder/runs/{runId}/stream?from={lastId}` (GET, same reconnect semantics as agent-builder)
- `getDraft` → `GET /sessions/{conversationId}/draft` → `SkillDraft`
- `testRun` → `POST /sessions/{conversationId}/test-run?sampleFileId={id}` → SSE (used for DOER dry-runs)
- `finalize` → `POST /sessions/{conversationId}/finalize` → `{ skillId, name, status }`

The SSE event protocol for the builder run stream:

- `draft-update` — full `SkillDraft` JSON (right pane live update)
- `claude-delta` — `{ type:'content_block_delta', delta:{ type:'text_delta', text:string } }` (assistant typing)
- `message` — `{ delta?:string, text?:string }` (legacy fallback)
- `error` — `{ message?:string }`
- (done: stream ends normally)

No `progress`/`tool_result` events needed for skill builder (simpler than agent-builder).

- [ ] **Step 1: Create `src/features/skill/builderApi.ts`**

```typescript
import { get, post } from '@/api/client';
import { streamSse } from '@/api/sse';

/** SkillDraft: 与后端 SkillDraft DTO 对齐。files 仅 DOER 类型有值。 */
export interface SkillDraft {
  name?: string;
  description?: string;
  body?: string;
  skillType?: 'PROMPT' | 'DOER';
  files?: Record<string, string>;
}

export interface StartSkillSessionResponse {
  conversationId: number | string;
  draft: SkillDraft;
}

export interface SkillTurnStartResponse {
  runId: string;
  userMessageId: number | string;
  assistantMessageId: number | string;
}

export interface SkillFinalizeResponse {
  skillId: number | string;
  name: string;
  status: string;
}

const BASE = '/tenant/skills/builder';

export const skillBuilderApi = {
  startSession: () => post<StartSkillSessionResponse>(`${BASE}/sessions`, {}),

  startTurn: (conversationId: string, text: string) =>
    post<SkillTurnStartResponse>(`${BASE}/sessions/${conversationId}/turns`, { text }),

  getDraft: (conversationId: string) => get<SkillDraft>(`${BASE}/sessions/${conversationId}/draft`),

  /** testRun: SSE endpoint for DOER dry-run. Returns the SSE URL so caller can streamSse. */
  testRunUrl: (conversationId: string, sampleFileId: string) =>
    `${BASE}/sessions/${conversationId}/test-run?sampleFileId=${encodeURIComponent(sampleFileId)}`,

  finalize: (conversationId: string) =>
    post<SkillFinalizeResponse>(`${BASE}/sessions/${conversationId}/finalize`, {}),
};

export interface SkillRunHandlers {
  onDelta?: (text: string) => void;
  onDraftUpdate?: (draft: SkillDraft) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function dispatchSkill(event: string, data: string, h: SkillRunHandlers) {
  try {
    switch (event) {
      case 'draft-update':
        h.onDraftUpdate?.(JSON.parse(data) as SkillDraft);
        break;
      case 'claude-delta': {
        const p = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
        if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta' && p.delta.text) {
          h.onDelta?.(p.delta.text);
        }
        break;
      }
      case 'message': {
        const p = JSON.parse(data) as { delta?: string; text?: string };
        const t = p.delta ?? p.text ?? '';
        if (t) h.onDelta?.(t);
        break;
      }
      case 'error': {
        const p = JSON.parse(data) as { message?: string };
        h.onError?.(new Error(p.message ?? 'SSE 错误'));
        break;
      }
      default:
        break;
    }
  } catch {
    /* 忽略畸形帧 */
  }
}

/** 消费/重连技能构建器生成流（与 agent-builder consumeBuilderRun 同语义）。 */
export async function consumeSkillBuilderRun(
  runId: string,
  handlers: SkillRunHandlers,
  signal?: AbortSignal,
  fromId = '0',
): Promise<void> {
  let lastId = fromId || '0';
  let attempts = 0;
  for (;;) {
    if (signal?.aborted) return;
    let errored = false;
    let ended = false;
    await streamSse(
      `/tenant/skills/builder/runs/${runId}/stream?from=${encodeURIComponent(lastId)}`,
      null,
      {
        method: 'GET',
        signal,
        onEvent: (event, data, id) => {
          if (id) lastId = id;
          attempts = 0;
          dispatchSkill(event, data, handlers);
        },
        onError: () => {
          errored = true;
        },
        onDone: () => {
          ended = true;
        },
      },
    );
    if (signal?.aborted) return;
    if (errored && !ended) {
      if (++attempts > MAX_RECONNECTS) {
        handlers.onError?.(new Error('生成流重连失败，请刷新'));
        return;
      }
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }
    break;
  }
  handlers.onDone?.();
}

/** testRun SSE consumer for DOER dry-run results. Streams progress/artifact/summary events. */
export interface TestRunHandlers {
  onEvent?: (event: string, data: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export async function consumeTestRun(
  conversationId: string,
  sampleFileId: string,
  handlers: TestRunHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await streamSse(skillBuilderApi.testRunUrl(conversationId, sampleFileId), null, {
    method: 'POST',
    signal,
    onEvent: (event, data) => {
      handlers.onEvent?.(event, data);
    },
    onError: (err) => handlers.onError?.(err),
    onDone: () => handlers.onDone?.(),
  });
}
```

- [ ] **Step 2: Run typecheck to verify the file is clean**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck 2>&1 | head -30
```

Expected: zero errors (or only pre-existing errors unrelated to this new file).

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front
git add src/features/skill/builderApi.ts
git commit -m "$(cat <<'EOF'
feat(skill-ui): add skill builder API layer with SSE reconnect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `src/pages/console/skill/SkillBuilderPage.tsx`

**Files:**

- Create: `src/pages/console/skill/SkillBuilderPage.tsx`

### Background

Mirror `AgentBuilderWizardPage`. Key structural differences:

- No `selectedPluginIds`/`selectedKbIds` — skills have no plugin/kb references.
- No file attachment in the chat input — the `text` turn payload is simpler (`{ text }` not `{ query, fileIds }`).
- Right pane: `SkillDraftPreview` (inline, not a separate component) shows:
  - `name` (Typography.Title level 4)
  - `description` (Text)
  - `skillType` tag (`PROMPT` → purple, `DOER` → orange)
  - `body` rendered in a `<pre>` (the SKILL.md content)
  - For `DOER` only: a file tree section showing `files` entries as collapsible `<pre>` code blocks
- DOER test-run: a disabled Upload button with Tooltip explaining "上传样例文件试跑（即将支持）" — the `testRun` SSE wiring is fully stubbed/disabled in v1 to keep scope contained. The button renders but stays disabled; no TODO comment needed beyond the Tooltip text.
- "完成并保存" button at the top-right of the right pane header → calls `finalize` → on success: `message.success('Skill 已创建')` + `navigate('/console/skills')` + `qc.invalidateQueries({ queryKey: ['skill','list'] })`.
- On mount: `startSession()` → sets `conversationId` + initial `draft`.
- Reset conversation: same pattern as agent-builder — clear messages/input, start new session, keep draft in right pane.
- `startTurn(text)` → `skillBuilderApi.startTurn(conversationId, text)` → `consumeSkillBuilderRun(runId, { onDelta, onDraftUpdate, onError, onDone }, signal)`.

### Important strict-mode notes

- `noUnusedLocals` + `noUnusedParameters` are enabled. Only import what you use.
- Prefer `type` imports where possible.
- All state updaters must type-annotate correctly; no implicit `any`.

- [ ] **Step 1: Create `src/pages/console/skill/SkillBuilderPage.tsx`**

```typescript
import { useEffect, useRef, useState } from 'react';
import { App, Button, Collapse, Popconfirm, Space, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import {
  ArrowLeftOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  skillBuilderApi,
  consumeSkillBuilderRun,
  type SkillDraft,
} from '@/features/skill/builderApi';
import MessageBubble from '@/features/chat-admin/components/MessageBubble';
import { newMessage, type ChatMessage, type MessageSegment } from '@/features/chat-admin/types';

const { Title, Text } = Typography;

const SKILL_TYPE_COLOR: Record<string, string> = { PROMPT: 'purple', DOER: 'orange' };
const SKILL_TYPE_LABEL: Record<string, string> = { PROMPT: 'Prompt', DOER: 'Doer' };

/** Right pane: live preview of the current SkillDraft. */
function SkillDraftPreview({ draft }: { draft: SkillDraft }) {
  const fileEntries = Object.entries(draft.files ?? {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          {draft.name || <Text type="secondary">（名称待生成）</Text>}
        </Title>
        {draft.skillType && (
          <Tag color={SKILL_TYPE_COLOR[draft.skillType]} style={{ marginTop: 4 }}>
            {SKILL_TYPE_LABEL[draft.skillType] ?? draft.skillType}
          </Tag>
        )}
      </div>

      {draft.description && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {draft.description}
        </Text>
      )}

      {draft.body && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            SKILL.md
          </Text>
          <pre
            style={{
              background: '#f6f8fa',
              border: '1px solid #e8e8e8',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 12,
              marginTop: 6,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {draft.body}
          </pre>
        </div>
      )}

      {draft.skillType === 'DOER' && fileEntries.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            文件 ({fileEntries.length})
          </Text>
          <Collapse
            size="small"
            style={{ marginTop: 6 }}
            items={fileEntries.map(([path, content]) => ({
              key: path,
              label: <code style={{ fontSize: 12 }}>{path}</code>,
              children: (
                <pre
                  style={{
                    background: '#f6f8fa',
                    padding: '8px 12px',
                    fontSize: 11,
                    margin: 0,
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {content}
                </pre>
              ),
            }))}
          />
        </div>
      )}

      {!draft.name && !draft.body && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 200,
            color: '#bfbfbf',
            fontSize: 14,
          }}
        >
          <span>描述你要构建的 Skill，AI 会实时生成预览</span>
        </div>
      )}
    </div>
  );
}

export default function SkillBuilderPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<SkillDraft>({});
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const abortRef = useRef<AbortController>();
  const composingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string>();

  const hasDraft = !!(draft.name?.trim() || draft.body?.trim() || draft.description?.trim());
  const started = messages.length > 0 || hasDraft;

  useEffect(() => {
    skillBuilderApi
      .startSession()
      .then((r) => {
        setConversationId(String(r.conversationId));
        if (r.draft) setDraft(r.draft);
      })
      .catch((e: { message?: string }) => message.error(e?.message ?? '开会话失败'));
    return () => abortRef.current?.abort();
  }, [message]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const resetConversation = async () => {
    abortRef.current?.abort();
    activeIdRef.current = undefined;
    setGenerating(false);
    setMessages([]);
    setInput('');
    setConversationId(undefined);
    setResetting(true);
    try {
      const r = await skillBuilderApi.startSession();
      setConversationId(String(r.conversationId));
      message.success('已清空对话');
    } catch (e) {
      message.error((e as Error)?.message ?? '重置失败');
    } finally {
      setResetting(false);
    }
  };

  const patchActive = (fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((list) => list.map((m) => (m.id === activeIdRef.current ? fn(m) : m)));
  };

  const appendDelta = (t: string) =>
    patchActive((m) => {
      const segs: MessageSegment[] = [...(m.segments ?? [])];
      const last = segs[segs.length - 1];
      if (last && last.type === 'text')
        segs[segs.length - 1] = { type: 'text', text: last.text + t };
      else segs.push({ type: 'text', text: t });
      return { ...m, content: m.content + t, segments: segs };
    });

  const startTurn = async (query: string) => {
    if (!conversationId || !query.trim() || generating) return;

    const userMsg = newMessage('user', query);
    const aiMsg = newMessage('assistant', '');
    activeIdRef.current = aiMsg.id;
    setMessages((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setGenerating(true);

    let resp;
    try {
      resp = await skillBuilderApi.startTurn(conversationId, query);
    } catch (e) {
      setGenerating(false);
      patchActive((m) => ({
        ...m,
        status: 'error',
        errorMessage: (e as Error)?.message ?? '发送失败',
      }));
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    await consumeSkillBuilderRun(
      resp.runId,
      {
        onDelta: appendDelta,
        onDraftUpdate: (d) => setDraft(d),
        onError: (err) =>
          patchActive((m) => ({ ...m, status: 'error', errorMessage: err.message })),
        onDone: () => {
          setGenerating(false);
          patchActive((m) => ({ ...m, status: 'done' }));
        },
      },
      ac.signal,
    );
  };

  const send = () => void startTurn(input.trim());

  const finalizeMut = useMutation({
    mutationFn: () => skillBuilderApi.finalize(conversationId!),
    onSuccess: () => {
      message.success('Skill 已创建');
      qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      navigate('/console/skills');
    },
    onError: (e) => message.error((e as Error)?.message ?? '创建失败'),
  });

  // DOER test-run upload — stubbed in v1; wired visually but disabled.
  const testRunUploadProps: UploadProps = {
    beforeUpload: () => false, // prevent antd auto-upload
    showUploadList: false,
  };

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}
    >
      <Space>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/console/skills')}
        >
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          AI 对话生成 Skill
        </Title>
      </Space>
      {started && (
        <Popconfirm
          title="重置对话"
          description="将清空当前对话内容并开始新会话；右侧已生成的 Skill 草稿会保留。"
          okText="清空对话"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={resetConversation}
        >
          <Button icon={<ReloadOutlined />} loading={resetting}>
            重置对话
          </Button>
        </Popconfirm>
      )}
    </div>
  );

  // ============ 落地页（未开始）============
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
            用一句话，生成一个 Skill
          </Title>
          <Text type="secondary" style={{ fontSize: 15, textAlign: 'center' }}>
            描述你想封装的技能，AI 会帮你生成 SKILL.md 主体与文件结构，边问边生成。
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
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              variant="borderless"
              placeholder="例如：做一个能调用天气 API、返回格式化天气摘要的 Doer Skill…"
              style={{ padding: 0, fontSize: 15 }}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !composingRef.current &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Button
                type="primary"
                size="large"
                icon={generating ? <LoadingOutlined /> : <SendOutlined />}
                disabled={!input.trim() || !conversationId}
                loading={generating}
                onClick={send}
              >
                开始生成
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ 工作区（已开始）============
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* 左：聊天 */}
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
            <div
              style={{
                background: '#fff',
                border: `1px solid ${inputFocused ? '#4096ff' : '#d9d9d9'}`,
                borderRadius: 16,
                padding: '12px 16px 8px',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxShadow: inputFocused ? '0 0 0 3px rgba(64,150,255,0.12)' : 'none',
              }}
            >
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 6 }}
                variant="borderless"
                placeholder="和 Skill 构建器说点什么…"
                style={{ padding: 0, fontSize: 14, resize: 'none' }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onCompositionStart={() => (composingRef.current = true)}
                onCompositionEnd={() => (composingRef.current = false)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !composingRef.current &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  marginTop: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#bfbfbf' }}>Enter 发送</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<SendOutlined />}
                    loading={generating}
                    disabled={!input.trim()}
                    onClick={send}
                    style={{ color: input.trim() ? '#4096ff' : undefined }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右：实时预览 */}
        <div
          style={{
            width: 420,
            minWidth: 360,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* 右侧顶栏 */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text strong>Skill 草稿预览</Text>
            <Space>
              {draft.skillType === 'DOER' && (
                <Tooltip title="上传样例文件试跑（即将支持）">
                  <Upload {...testRunUploadProps}>
                    <Button
                      size="small"
                      icon={<UploadOutlined />}
                      disabled
                    >
                      上传样例并试跑
                    </Button>
                  </Upload>
                </Tooltip>
              )}
              <Button
                type="primary"
                size="small"
                loading={finalizeMut.isPending}
                disabled={!hasDraft || !conversationId}
                onClick={() => finalizeMut.mutate()}
              >
                完成并保存
              </Button>
            </Space>
          </div>

          {/* 右侧内容 */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <SkillDraftPreview draft={draft} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck 2>&1
```

Expected: zero errors. If `noUnusedLocals` complains about any import, remove it. Common issues to watch for:

- `testRunUploadProps` must be used (it is, via `{...testRunUploadProps}`)
- All catch block variable types must be handled (use `(e as Error)?.message` pattern)

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front
git add src/pages/console/skill/SkillBuilderPage.tsx
git commit -m "$(cat <<'EOF'
feat(skill-ui): conversational skill builder page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire routes in `src/router/index.tsx`

**Files:**

- Modify: `src/router/index.tsx` (lines 22 and 122-125)

### Background

Current state of `src/router/index.tsx`:

- Line 22: `const SkillListPage = lazy(() => import('@/pages/console/skill/SkillListPage'));`
- Lines 121-125:
  ```tsx
  <Route path="skills" element={<SkillListPage />} />
  <Route
    path="skill/builder"
    element={<StubPage title="AI 生成 Skill" hint="Skill Builder 开发中" />}
  />
  ```

We need to:

1. Add a lazy import for `SkillBuilderPage` after the `SkillListPage` import.
2. Replace the `StubPage` route with `<SkillBuilderPage />`.

- [ ] **Step 1: Add the lazy import**

In `src/router/index.tsx`, after line 22 (`const SkillListPage = ...`), add:

```typescript
const SkillBuilderPage = lazy(() => import('@/pages/console/skill/SkillBuilderPage'));
```

- [ ] **Step 2: Replace the StubPage route**

Replace:

```tsx
<Route
  path="skill/builder"
  element={<StubPage title="AI 生成 Skill" hint="Skill Builder 开发中" />}
/>
```

With:

```tsx
<Route path="skill/builder" element={<SkillBuilderPage />} />
```

- [ ] **Step 3: Remove unused StubPage import if no longer needed**

Check if `StubPage` is still used elsewhere in the router file. If after the replacement `StubPage` has zero remaining uses, remove the import on line 8:

```typescript
import StubPage from '@/components/StubPage';
```

To check: `grep -n "StubPage" src/router/index.tsx`

If it shows only the import line and zero usage lines → remove the import. If other routes still use it → keep it.

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck 2>&1
```

Expected: zero errors.

- [ ] **Step 5: Run lint**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front && npm run lint 2>&1
```

Expected: zero warnings (CI-strict: `--max-warnings 0`).

- [ ] **Step 6: Commit**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front
git add src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(skill-ui): wire skill builder route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

- `POST /sessions` → `startSession()` ✓
- `POST /sessions/{id}/turns` body `{ text }` → `startTurn(conversationId, text)` ✓
- `GET /runs/{runId}/stream` with `from` param + reconnect → `consumeSkillBuilderRun` ✓
- `GET /sessions/{id}/draft` → `getDraft()` ✓ (defined, available for callers who want to poll)
- `POST /sessions/{id}/test-run` → `consumeTestRun()` ✓ (defined in API; UI renders disabled Upload button with Tooltip)
- `POST /sessions/{id}/finalize` → `finalize()` ✓
- Left chat pane: message list + input + send ✓
- SSE `draft-update` events → right pane updates ✓
- SSE tokens → assistant bubble builds up ✓
- Right pane: name, description, skillType tag, body `<pre>`, DOER files collapsible ✓
- "上传样例并试跑" for DOER: rendered but disabled with Tooltip ✓
- "完成并保存" → `finalize` → navigate + invalidate ✓
- On mount `startSession()` ✓
- Routes: `StubPage` replaced with lazy `SkillBuilderPage` ✓
- `npm run typecheck` clean: enforced via step-level verification ✓

**Placeholder scan:** No TBDs, no "implement later", no vague "add validation" steps. Every step has exact code.

**Type consistency:**

- `SkillDraft` used consistently in `builderApi.ts` and `SkillBuilderPage.tsx`
- `skillBuilderApi.startTurn(conversationId, text)` ↔ called as `skillBuilderApi.startTurn(conversationId, query)` ✓ (string args)
- `consumeSkillBuilderRun(resp.runId, handlers, ac.signal)` — `resp.runId` is `string` ✓
- `finalizeMut` calls `skillBuilderApi.finalize(conversationId!)` — `conversationId` is `string | undefined`, non-null asserted, guarded by `disabled={!conversationId}` ✓
- `testRunUploadProps: UploadProps` — typed import from antd ✓
