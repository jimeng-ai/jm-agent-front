import { memo, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { RelationFlowEdge } from '../flow';

const MARK_OFFSET_X = 14;
const MARK_OFFSET_Y = 9;

const at = (x: number, y: number): CSSProperties => ({
  transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
});

// 实线 = 已确认，虚线 = 推断；端点写 N / 1，线中段写起点列的客户注释。
function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
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
  const edgeClass = [
    'dg-edge',
    data?.tier === 'INFERRED' ? 'is-inferred' : 'is-confirmed',
    dimmed ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const overlayClass = (base: string) => (dimmed ? `${base} is-dimmed` : base);
  return (
    <>
      <BaseEdge id={id} path={path} className={edgeClass} />
      <EdgeLabelRenderer>
        {data?.fromMark ? (
          <div
            className={overlayClass('dg-edge-mark')}
            style={at(sourceX + MARK_OFFSET_X, sourceY - MARK_OFFSET_Y)}
          >
            {data.fromMark}
          </div>
        ) : null}
        {data?.toMark ? (
          <div
            className={overlayClass('dg-edge-mark')}
            style={at(targetX - MARK_OFFSET_X, targetY - MARK_OFFSET_Y)}
          >
            {data.toMark}
          </div>
        ) : null}
        {data?.label ? (
          <div className={overlayClass('dg-edge-label')} style={at(labelX, labelY)}>
            {data.label}
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(RelationEdge);
