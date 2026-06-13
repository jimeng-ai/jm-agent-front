import { useState, type ReactNode } from 'react';
import { Button, Collapse, Drawer, Empty, Modal, Spin, Tag, Tooltip, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { traceApi } from '../api';
import type { TraceReplayStep, TraceReplayTurn } from '../types';
import { formatDuration, formatTime, formatTokens, num } from '../utils';
import { TraceStatusTag } from './TraceVisuals';
import { ChunksView, TextBlock, ValueView } from './ReplayValue';
import Markdown from '@/components/Markdown';

/** 展示的模型参数（顺序固定）；温度/Top P 无值时显示「默认」。 */
const PARAM_ROWS: { key: string; label: string }[] = [
  { key: 'model', label: '模型' },
  { key: 'temperature', label: '温度' },
  { key: 'top_p', label: 'Top P' },
];

/** 安全取对象（非对象返回 undefined）。 */
function asObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

const { Text } = Typography;

interface Props {
  traceId?: string;
  open: boolean;
  onClose: () => void;
}

/** 调用日志「可视化回放」：只读重现一条 trace 的执行过程，逐单元看输入/输出，便于调优。 */
export default function TraceReplayDrawer({ traceId, open, onClose }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const replayQ = useQuery({
    queryKey: ['trace', 'replay', traceId],
    queryFn: () => traceApi.replay(traceId as string),
    enabled: open && !!traceId,
  });
  const data = replayQ.data;
  const history = data?.history ?? [];

  return (
    <Drawer
      title={
        <span>
          回放{' '}
          <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 13 }}>
            {traceId}
          </Text>
        </span>
      }
      placement="right"
      width="min(1100px, 92vw)"
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {replayQ.isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin />
        </div>
      ) : !data ? (
        <Empty description="无回放数据" />
      ) : (
        <div>
          {/* 头部：Agent / 状态 / 汇总 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Text strong>{data.agentName || '—'}</Text>
            <TraceStatusTag status={data.status} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatTime(data.startTime)}
            </Text>
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              icon={<HistoryOutlined />}
              disabled={history.length === 0}
              onClick={() => setHistoryOpen(true)}
            >
              查看历史
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {num(data.stepCount)} 步 · {formatDuration(data.totalLatencyMs)} ·{' '}
              {formatTokens(data.totalTokens)} tok
            </Text>
          </div>

          <HistoryModal
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            history={history}
          />

          {/* 步骤耗时条：一眼看哪步慢 */}
          {data.steps.length > 0 && <LatencyStrip steps={data.steps} />}

          {/* 模型调用参数：模型 / 温度 / Top P（仅显示该次调用实际下发的值，无则不显示） */}
          {data.params && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {PARAM_ROWS.map(({ key, label }) => {
                const v = data.params?.[key];
                if (v == null) return null;
                return (
                  <Tag key={key} style={{ marginInlineEnd: 0 }}>
                    {label + ' '}
                    <Text strong style={{ fontFamily: 'monospace' }}>
                      {String(v)}
                    </Text>
                  </Tag>
                );
              })}
            </div>
          )}

          {/* System 提示（折叠一次） */}
          {data.system && (
            <Collapse
              ghost
              style={{ marginBottom: 8 }}
              items={[
                {
                  key: 'sys',
                  label: <Text type="secondary">System 提示</Text>,
                  children: <TextBlock text={data.system} clamp={999} />,
                },
              ]}
            />
          )}

          {/* 执行叙事 */}
          {data.conversation.length === 0 ? (
            <Empty description="无可还原的执行内容" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
              {data.conversation.map((turn, i) => (
                <TurnCard key={i} turn={turn} />
              ))}
            </div>
          )}

          {/* 用户主动停止：时间线末尾给一条中性提示，说明为何没有后续输出（非错误） */}
          {data.status === 'CANCELLED' && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                borderRadius: 8,
                background: '#f1f5f9',
                color: '#475569',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>⏸</span>
              <span>用户主动停止了本次生成，输出可能不完整。</span>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** 对话历史弹框：左右气泡（用户右、助手左）展示当前问题之前的来回。 */
function HistoryModal({
  open,
  onClose,
  history,
}: {
  open: boolean;
  onClose: () => void;
  history: TraceReplayTurn[];
}) {
  return (
    <Modal title="对话历史" open={open} onCancel={onClose} footer={null} width={720}>
      {history.length === 0 ? (
        <Empty description="无更早的对话历史" />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxHeight: '60vh',
            overflow: 'auto',
          }}
        >
          {history.map((t, i) => {
            const isUser = t.kind === 'user';
            return (
              <div
                key={i}
                style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}
              >
                <div
                  style={{
                    maxWidth: '78%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    wordBreak: 'break-word',
                    background: isUser ? '#3b82f6' : 'var(--bg-2, #f1f5f9)',
                    color: isUser ? '#fff' : 'inherit',
                  }}
                >
                  {isUser ? (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>
                  ) : (
                    <Markdown content={t.text || ''} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/** 顶部步骤耗时条：按步骤宽度反映耗时占比，hover 看明细。 */
function LatencyStrip({ steps }: { steps: TraceReplayStep[] }) {
  const total = steps.reduce((s, x) => s + num(x.durationMs), 0) || 1;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
        {steps.map((s, i) => (
          <Tooltip
            key={i}
            title={`${s.title || s.stepType} · ${formatDuration(s.durationMs)}${
              num(s.totalTokens) > 0 ? ` · ${formatTokens(s.totalTokens)} tok` : ''
            }`}
          >
            <div
              style={{
                width: `${Math.max(2, (num(s.durationMs) / total) * 100)}%`,
                background: STEP_BAR_COLOR[s.stepType] || '#cbd5e1',
                opacity: s.status === 'ERROR' ? 0.55 : 1,
              }}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

const STEP_BAR_COLOR: Record<string, string> = {
  LLM: '#6366f1',
  KB_SEARCH: '#10b981',
  RERANK: '#14b8a6',
  TOOL_CALL: '#f59e0b',
  PLUGIN_TRIGGER: '#f97316',
};

function MetricBadge({ turn }: { turn: TraceReplayTurn }) {
  const dur = num(turn.durationMs);
  const tok = num(turn.tokens);
  if (dur <= 0 && tok <= 0) return null;
  return (
    <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      {dur > 0 ? formatDuration(turn.durationMs) : ''}
      {dur > 0 && tok > 0 ? ' · ' : ''}
      {tok > 0 ? `${formatTokens(turn.tokens)} tok` : ''}
    </Text>
  );
}

function TurnCard({ turn }: { turn: TraceReplayTurn }) {
  if (turn.kind === 'tool') {
    return <ToolCard turn={turn} />;
  }
  const meta = TEXT_KIND[turn.kind] ?? { label: turn.kind, color: undefined, accent: '#e5e7eb' };
  return (
    <Card accent={meta.accent}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Tag color={meta.color}>{meta.label}</Tag>
        <span style={{ flex: 1 }} />
        <MetricBadge turn={turn} />
      </div>
      <TextBlock text={turn.text || ''} clamp={turn.kind === 'answer' ? 999 : 8} />
    </Card>
  );
}

const TEXT_KIND: Record<string, { label: string; color?: string; accent: string }> = {
  user: { label: '🧑 用户提问', color: 'blue', accent: '#3b82f6' },
  assistant: { label: '🤖 模型输出', color: 'default', accent: '#a5b4fc' },
  answer: { label: '✅ 最终回答', color: 'green', accent: '#22c55e' },
};

const TOOL_KIND: Record<
  string,
  { label: string; color: string; accent: string; inLabel: string; outLabel: string }
> = {
  kb: {
    label: '📚 知识库检索',
    color: 'green',
    accent: '#10b981',
    inLabel: '输入问题',
    outLabel: '召回片段',
  },
  skill: {
    label: '✨ 技能激活',
    color: 'purple',
    accent: '#a78bfa',
    inLabel: '输入',
    outLabel: '结果',
  },
  plugin: {
    label: '🔌 插件调用',
    color: 'orange',
    accent: '#f59e0b',
    inLabel: '输入参数',
    outLabel: '输出结果',
  },
  tool: {
    label: '🛠 工具调用',
    color: 'gold',
    accent: '#f59e0b',
    inLabel: '输入参数',
    outLabel: '输出结果',
  },
};

function ToolCard({ turn }: { turn: TraceReplayTurn }) {
  const meta = TOOL_KIND[turn.toolType || 'tool'] ?? TOOL_KIND.tool;
  const isKb = turn.toolType === 'kb';
  const inObj = asObject(turn.input);
  const outObj = asObject(turn.output);
  const query = isKb ? (inObj?.query as string | undefined) : undefined;
  const topK = isKb ? (inObj?.top_k ?? inObj?.topK) : undefined;
  const results = isKb ? outObj?.results : undefined;
  const recallCount = isKb && Array.isArray(results) ? results.length : undefined;
  const rerank = isKb ? asObject(turn.rerank) : undefined;

  return (
    <Card accent={meta.accent}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Tag color={meta.color}>{meta.label}</Tag>
        {turn.toolName && (
          <Text style={{ fontFamily: 'monospace', fontSize: 13 }}>{turn.toolName}</Text>
        )}
        <span style={{ flex: 1 }} />
        <MetricBadge turn={turn} />
      </div>

      {isKb ? (
        <>
          <Field label="检索词">
            {query ? (
              <span
                style={{
                  display: 'inline-block',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  borderRadius: 6,
                  padding: '2px 10px',
                  fontWeight: 500,
                }}
              >
                {query}
                {topK != null && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    TopK {String(topK)}
                  </Text>
                )}
              </span>
            ) : (
              <ValueView value={turn.input} />
            )}
          </Field>
          <Field label="重排 Rerank">
            {rerank ? (
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
              >
                <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                  已重排
                </Tag>
                {rerank.model != null && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    模型 <Text style={{ fontFamily: 'monospace' }}>{String(rerank.model)}</Text>
                  </Text>
                )}
                {rerank.kept != null && rerank.candidates != null && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    保留 {String(rerank.kept)} / {String(rerank.candidates)} 个分片（按分数排序）
                  </Text>
                )}
              </span>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                未重排
              </Text>
            )}
          </Field>
          <Field label={`召回片段${recallCount != null ? `（${recallCount}）` : ''}`}>
            {results != null ? (
              <ChunksView results={results} />
            ) : turn.output != null ? (
              <ValueView value={turn.output} />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                （无输出记录）
              </Text>
            )}
          </Field>
        </>
      ) : (
        <>
          {turn.input != null && (
            <Field label={meta.inLabel}>
              <ValueView value={turn.input} />
            </Field>
          )}
          <Field label={meta.outLabel}>
            {turn.output != null ? (
              <ValueView value={turn.output} />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                （无输出记录）
              </Text>
            )}
          </Field>
        </>
      )}
    </Card>
  );
}

function Card({ accent, children }: { accent?: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--divider, #f1f5f9)',
        borderLeft: `3px solid ${accent || '#e5e7eb'}`,
        borderRadius: 8,
        padding: '10px 12px',
        background: '#fff',
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {label}
      </Text>
      {children}
    </div>
  );
}
