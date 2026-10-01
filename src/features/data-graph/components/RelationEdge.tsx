import { memo, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { RelationFlowEdge } from '../flow';

const at = (x: number, y: number): CSSProperties => ({
  transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
});

// 两个对象之间同一方向的全部关系合成一根线（设计文档 §8.2）：箭头指向被引用的对象；
// 任一条已核对画实线，否则画虚线；线上写角色名或「N 种关联」，悬停列出全部角色。
function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<RelationFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const dimmed = data?.dimmed ?? false;
  const edgeClass = ['dg-edge', data?.confirmed ? 'is-confirmed' : 'is-inferred', dimmed ? 'is-dimmed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <BaseEdge id={id} path={path} className={edgeClass} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        {data?.label ? (
          <div
            className={`dg-edge-label nodrag nopan${dimmed ? ' is-dimmed' : ''}`}
            style={at(labelX, labelY)}
            title={data.roles.join('、')}
            data-testid="dg-edge-label"
            data-edge={id}
          >
            {data.label}
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(RelationEdge);
