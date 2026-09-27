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
  const condition = care.condition;
  return (
    <div className="semantic-care-note">
      <div>{care.careReason ?? care.hint}</div>
      {care.careReasonWithheld && (
        <Typography.Text type="secondary">
          后端原话含具体取值，当前档位不提供给模型；原话仍在 Inspector 的留存区。
        </Typography.Text>
      )}
      {condition?.type === 'DISCRIMINATOR' && (
        <div className="semantic-condition-line">
          <span>join 时带类型条件：</span>
          <Typography.Text code>{condition.column}</Typography.Text>
          {condition.value !== null ? (
            <>
              <span>=</span>
              <Typography.Text code>{condition.value}</Typography.Text>
            </>
          ) : condition.withheldValue !== null ? (
            <span className="semantic-condition-warning">
              取值已留存，但「{tierText}」不向模型开放；模型会先查、拿不准就问人。
            </span>
          ) : condition.valuesAllowed ? (
            <span className="semantic-condition-warning">
              当前允许样本值，但尚未取得可安全使用的判别值。
            </span>
          ) : (
            <span className="semantic-muted">当前档位不提供具体取值。</span>
          )}
        </div>
      )}
      {condition?.type === 'COMPOSITE' && (
        <div className="semantic-condition-line">
          <span>{condition.target ? `目标表 ${condition.target}：` : '目标表：'}</span>
          {condition.columns.map((column, index) => (
            <span key={`${index}-${column}`}>
              {index > 0 && ' + '}
              <Typography.Text code>{column}</Typography.Text>
            </span>
          ))}
          <span>必须全部对上。</span>
        </div>
      )}
    </div>
  );
}

export function TableShapeSummary({ shape }: { shape: TableShapeView }) {
  if (shape.kind === 'LEGACY') {
    return (
      <Tooltip title="旧版自由描述不符合当前四种形态契约，给模型的工具不提供它。重新生成后机器推断行会重新判断。">
        <span className="semantic-shape-legacy">旧版形态：{shape.raw}（模型读不到）</span>
      </Tooltip>
    );
  }
  if (shape.kind === 'UNRECOGNIZED') {
    return (
      <Tooltip title="形态或来源不是当前契约里的值，工具会把这一行形态丢掉，模型读不到。">
        <span className="semantic-shape-legacy">
          未认出形态：{shape.raw}（{shape.source?.label ?? `来源 ${shape.sourceRaw}`}，模型读不到）
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
          模型原判 {shape.modelGuess}
          {shape.measured ? '（已被实测推翻）' : ''}
        </span>
      )}
    </span>
  );
}

export function KeyValueCare({ shape }: { shape: Extract<TableShapeView, { kind: 'SHAPE' }> }) {
  return (
    <div className="semantic-care-note">
      一行是一对「指标名 = 值」，不是一条记录。聚合前先按
      <Typography.Text code>{shape.kvNameColumn ?? '指标名列'}</Typography.Text>
      筛出一个指标，再对
      <Typography.Text code>{shape.kvValueColumn ?? '值列'}</Typography.Text>
      求和或计数。
    </div>
  );
}
