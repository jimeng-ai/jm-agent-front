import { memo, type KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TableFlowNode } from '../flow';

// 每一行左右各一个不可见的连接点：连线从起点列那一行出发，落到终点列那一行。
function TableCardNode({ data }: NodeProps<TableFlowNode>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      data.onSelect(data.name);
    }
  };
  const className = ['dg-card', data.selected ? 'is-selected' : '', data.dimmed ? 'is-dimmed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      aria-pressed={data.selected}
      aria-label={data.title === data.name ? data.name : `${data.title}（${data.name}）`}
      onKeyDown={onKeyDown}
      data-testid="dg-card"
      data-table={data.name}
    >
      <div className="dg-card__head">
        <div className="dg-card__title-row">
          <span className="dg-card__title" title={data.title}>
            {data.title}
          </span>
          {data.hasHierarchy ? <span className="dg-badge">有上下级</span> : null}
        </div>
        {data.subtitle ? (
          <div
            className={data.subtitleIsName ? 'dg-card__name' : 'dg-card__note'}
            title={data.subtitle}
          >
            {data.subtitle}
          </div>
        ) : null}
      </div>
      <ul className="dg-card__rows">
        {data.rows.map((row) => (
          <li key={row.name} className="dg-card__row">
            <Handle
              type="target"
              position={Position.Left}
              id={`in:${row.name}`}
              isConnectable={false}
              className="dg-card__handle"
            />
            <span className="dg-card__column">
              {row.isKey ? <span className="dg-card__key" title="唯一标识一行的列" /> : null}
              {row.name}
            </span>
            {row.comment ? (
              <span className="dg-card__comment" title={row.comment}>
                {row.comment}
              </span>
            ) : null}
            <Handle
              type="source"
              position={Position.Right}
              id={`out:${row.name}`}
              isConnectable={false}
              className="dg-card__handle"
            />
          </li>
        ))}
      </ul>
      <div className="dg-card__foot">共 {data.fieldCount} 个字段</div>
    </div>
  );
}

export default memo(TableCardNode);
