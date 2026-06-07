import { Button, Empty, Spin, Tooltip, Typography } from 'antd';
import type { TraceLog, TraceStep } from '../types';
import { durationDistribution, formatDuration, formatTime, formatTokens, num } from '../utils';
import { StepGlyph, TraceStatusTag } from './TraceVisuals';

const { Text } = Typography;

interface Props {
  trace?: TraceLog;
  loading?: boolean;
}

export default function TraceDetail({ trace, loading }: Props) {
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }
  if (!trace) {
    return <Empty description="选择左侧一条 trace 查看详情" style={{ marginTop: 64 }} />;
  }

  const steps = trace.steps ?? [];
  const slices = durationDistribution(steps);

  return (
    <div>
      {/* 头部：trace_id + 状态 + 回放（v1 禁用） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Text strong style={{ fontSize: 15, fontFamily: 'monospace' }}>
          {trace.traceId}
        </Text>
        <TraceStatusTag status={trace.status} />
        <Tooltip title="回放功能即将上线">
          <Button size="small" disabled>
            回放
          </Button>
        </Tooltip>
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {trace.agentName || '—'} · {formatTime(trace.startTime)}
      </Text>

      {/* 汇总：步骤数 / 总耗时 / 总 Token（v1 不展示积分） */}
      <div style={{ display: 'flex', gap: 32, margin: '20px 0' }}>
        <Summary label="步骤" value={String(num(trace.stepCount))} />
        <Summary label="总耗时" value={formatDuration(trace.totalLatencyMs)} />
        <Summary label="总 Token" value={formatTokens(trace.totalTokens)} />
      </div>

      {/* 步骤时间线（对齐设计稿 .trace-row：色块图标 | 名称/副标题 | 耗时 | token/时间） */}
      {steps.length === 0 ? (
        <Empty description="无步骤记录" />
      ) : (
        <div>
          {steps.map((s) => (
            <StepRow key={String(s.id)} step={s} />
          ))}
        </div>
      )}

      {/* 耗时分布 */}
      {slices.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Text strong>耗时分布</Text>
          <div
            style={{
              display: 'flex',
              height: 8,
              borderRadius: 99,
              overflow: 'hidden',
              margin: '10px 0',
            }}
          >
            {slices.map((s) => (
              <div key={s.key} style={{ width: `${s.percent}%`, background: s.color }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {slices.map((s) => (
              <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                <Text type="secondary">
                  {s.label} {s.percent}%
                </Text>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <Text type="secondary">{label}</Text>
    </div>
  );
}

function StepRow({ step }: { step: TraceStep }) {
  const tokens = num(step.totalTokens);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '22px 1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '10px 4px',
        borderBottom: '1px solid var(--divider, #f1f5f9)',
      }}
    >
      <StepGlyph type={step.stepType} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>
          {step.title}
          {step.status === 'ERROR' && (
            <span style={{ marginLeft: 8 }}>
              <TraceStatusTag status="ERROR" />
            </span>
          )}
        </div>
        {step.subTitle && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {step.subTitle}
          </Text>
        )}
        {step.errorMsg && (
          <div>
            <Text type="danger" style={{ fontSize: 12 }}>
              {step.errorMsg}
            </Text>
          </div>
        )}
      </div>
      <div style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        <div style={{ fontVariantNumeric: 'tabular-nums' }}>
          <Text type="secondary">{formatDuration(step.durationMs)}</Text>
          {tokens > 0 && (
            <Text type="secondary" style={{ marginLeft: 8 }}>
              {formatTokens(tokens)} tok
            </Text>
          )}
        </div>
        {step.stepTime && (
          <Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(step.stepTime, 'HH:mm:ss')}
          </Text>
        )}
      </div>
    </div>
  );
}
