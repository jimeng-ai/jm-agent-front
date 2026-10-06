import { Tag, Tooltip, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { JoinCare, TableShapeView, TagMeta } from '@/features/connector/semantic';

export function SemanticTag({ meta, icon }: { meta: TagMeta; icon?: React.ReactNode }) {
  return (
    <Tooltip title={meta.hint}>
      {meta.color ? (
        <Tag color={meta.color} icon={icon}>
          {meta.label}
        </Tag>
      ) : (
        <Tag icon={icon}>{meta.label}</Tag>
      )}
    </Tooltip>
  );
}

/** 多态 / 复合键关系的使用约束。只展示 joinCare 已判定为模型当前能读到的部分。 */
export function JoinCareSummary({ care, tierText }: { care: JoinCare; tierText: string }) {
  return (
    <div className="semantic-care-note">
      <div>{care.careReason}</div>
      {care.careReasonWithheld && (
        <Typography.Text type="secondary">
          原提醒含具体取值，「{tierText}」下 AI 看不到。
        </Typography.Text>
      )}
      <div className="semantic-condition-line">{care.conditionSummary}</div>
    </div>
  );
}

export function TableShapeSummary({ shape }: { shape: TableShapeView }) {
  if (shape.kind === 'LEGACY') {
    return (
      <Tooltip title="旧版描述，AI 看不到。重新生成后会更新。">
        <span className="semantic-shape-legacy">旧版形态：{shape.raw}（AI 看不到）</span>
      </Tooltip>
    );
  }
  if (shape.kind === 'UNRECOGNIZED') {
    return (
      <Tooltip title="无法识别的形态，AI 看不到。">
        <span className="semantic-shape-legacy">
          未识别形态：{shape.raw}（{shape.source?.label ?? `来源 ${shape.sourceRaw}`}，AI 看不到）
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="semantic-shape-tags">
      <Tooltip title={shape.shape.hint}>
        <Tag color={shape.shape.color} icon={shape.keyValue ? <WarningOutlined /> : undefined}>
          {shape.shape.label}
        </Tag>
      </Tooltip>
      <Tooltip title={shape.source.hint}>
        {shape.source.color ? (
          <Tag color={shape.source.color}>{shape.source.label}</Tag>
        ) : (
          <span className="semantic-muted">{shape.source.label}</span>
        )}
      </Tooltip>
      {shape.modelGuess && (
        <span className="semantic-muted">
          AI 原判 {shape.modelGuess}
          {shape.measured ? '（已按实测更正）' : ''}
        </span>
      )}
    </span>
  );
}

export function KeyValueCare({ shape }: { shape: Extract<TableShapeView, { kind: 'SHAPE' }> }) {
  return (
    <div className="semantic-care-note">
      一行是一个指标（指标名 = 值），不是一条记录。统计前先按
      <Typography.Text code>{shape.kvNameColumn ?? '指标名列'}</Typography.Text>
      选定指标，再对
      <Typography.Text code>{shape.kvValueColumn ?? '值列'}</Typography.Text>
      汇总。
    </div>
  );
}
