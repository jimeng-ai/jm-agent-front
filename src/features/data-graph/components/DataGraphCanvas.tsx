import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import RelationEdge from './RelationEdge';
import TableCardNode from './TableCardNode';
import { buildFlow, type FocusRequest, type RelationFlowEdge, type TableFlowNode } from '../flow';
import { EXPLORE_ZOOM, fitsOnOneScreen, hubTable, layoutTables, type CardBox } from '../layout';
import type { SystemGraph } from '../types';

interface DataGraphCanvasProps {
  graph: SystemGraph;
  selected: string | null;
  focus: FocusRequest | null;
  onSelect: (name: string | null) => void;
}

const nodeTypes = { table: TableCardNode };
const edgeTypes = { relation: RelationEdge };

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const centerOf = (box: CardBox) => [box.x + box.width / 2, box.y + box.height / 2] as const;

function CanvasInner({ graph, selected, focus, onSelect }: DataGraphCanvasProps) {
  const related = useMemo(() => graph.tables.filter((table) => table.related), [graph.tables]);
  // 布局只依赖表和关系；选中、搜索都不会触发重新布局。
  const boxes = useMemo(() => layoutTables(related, graph.relations), [related, graph.relations]);
  const { nodes, edges } = useMemo(
    () => buildFlow(related, graph.relations, boxes, selected, onSelect),
    [related, graph.relations, boxes, selected, onSelect],
  );
  // 整图一屏看得清就整图显示；看不清就放大到关联最多的表附近，配小地图（布局本身不变）。
  const overview = useMemo(() => fitsOnOneScreen(boxes), [boxes]);
  const hub = useMemo(() => hubTable(related, graph.relations), [related, graph.relations]);
  const hubTitle = related.find((table) => table.name === hub)?.displayName ?? hub;
  const { setCenter } = useReactFlow();

  const onInit = (instance: ReactFlowInstance<TableFlowNode, RelationFlowEdge>) => {
    if (overview || !hub) return;
    const box = boxes.get(hub);
    if (!box) return;
    const [x, y] = centerOf(box);
    void instance.setCenter(x, y, { zoom: EXPLORE_ZOOM, duration: 0 });
  };

  useEffect(() => {
    if (!focus) return;
    const box = boxes.get(focus.name);
    if (!box) return;
    const [x, y] = centerOf(box);
    void setCenter(x, y, { zoom: 1, duration: prefersReducedMotion() ? 0 : 300 });
  }, [boxes, focus, setCenter]);

  return (
    <>
      <ReactFlow<TableFlowNode, RelationFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onInit={onInit}
        fitView={overview}
        fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
        minZoom={0.05}
        maxZoom={1.6}
        colorMode="dark"
      >
        <Background gap={32} size={1} color="rgba(56, 189, 248, 0.14)" bgColor="transparent" />
        <Controls position="top-right" showInteractive={false} />
        {overview ? null : (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor="#1d6f91"
            maskColor="rgba(6, 17, 31, 0.72)"
            bgColor="#081625"
          />
        )}
      </ReactFlow>
      {overview || !hubTitle ? null : (
        <div className="data-graph-hint" data-testid="dg-explore-hint">
          表比较多，先显示「{hubTitle}」附近。拖动画布、滚轮缩放，或用搜索找表。
        </div>
      )}
    </>
  );
}

export default function DataGraphCanvas(props: DataGraphCanvasProps) {
  return (
    <div className="dg-canvas" data-testid="data-graph-canvas">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
