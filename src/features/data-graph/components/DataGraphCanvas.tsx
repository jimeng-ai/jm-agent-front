import { useCallback, useEffect, useMemo } from 'react';
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
import ObjectCardNode from './ObjectCardNode';
import RelationEdge from './RelationEdge';
import type { DomainOption } from '../domains';
import { buildFlow, type FocusRequest, type ObjectFlowNode, type RelationFlowEdge } from '../flow';
import {
  EXPLORE_ZOOM,
  fitsOnOneScreen,
  groupRelations,
  hubTable,
  layoutTables,
  type CardBox,
} from '../layout';
import type { SystemGraph } from '../types';

interface DataGraphCanvasProps {
  graph: SystemGraph;
  domains: DomainOption[];
  selected: string | null;
  domainFilter: string | null;
  focus: FocusRequest | null;
  titleOf: (table: string) => string;
  onSelect: (name: string | null) => void;
}

const nodeTypes = { object: ObjectCardNode };
const edgeTypes = { relation: RelationEdge };
// 画布按钮、小地图的悬停提示和读屏标签（React Flow 默认是英文）。
const ARIA_LABELS = {
  'controls.ariaLabel': '画布缩放',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '显示全图',
  'minimap.ariaLabel': '小地图',
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const centerOf = (box: CardBox) => [box.x + box.width / 2, box.y + box.height / 2] as const;

function CanvasInner({ graph, domains, selected, domainFilter, focus, titleOf, onSelect }: DataGraphCanvasProps) {
  const related = useMemo(() => graph.tables.filter((table) => table.related), [graph.tables]);
  const groups = useMemo(() => groupRelations(graph.relations), [graph.relations]);
  // 布局只依赖对象和线；选中、领域筛选、搜索都不会触发重新布局。
  const boxes = useMemo(() => layoutTables(related, groups), [related, groups]);
  // 整图一屏看得清就整图显示；看不清就放大到关联最多的对象附近，配小地图（布局本身不变）。
  const overview = useMemo(() => fitsOnOneScreen(boxes), [boxes]);
  const hub = useMemo(() => hubTable(related, graph.relations), [related, graph.relations]);
  const hubTitle = hub ? titleOf(hub) : null;
  const { setCenter, getZoom } = useReactFlow();

  // 键盘聚焦跟随：直接跳过去、缩放不变。带动画的远距离平移会先缩小再放大（d3 的平滑缩放），一路 Tab 过去会晃得看不清。
  const onFocusCard = useCallback(
    (name: string, visible: boolean) => {
      const box = boxes.get(name);
      if (visible || !box) return;
      const [x, y] = centerOf(box);
      void setCenter(x, y, { zoom: getZoom(), duration: 0 });
    },
    [boxes, getZoom, setCenter],
  );
  const select = useCallback((name: string) => onSelect(name), [onSelect]);
  const { nodes, edges } = useMemo(
    () => buildFlow(related, groups, boxes, domains, selected, domainFilter, titleOf, select, onFocusCard),
    [related, groups, boxes, domains, selected, domainFilter, titleOf, select, onFocusCard],
  );

  const onInit = (instance: ReactFlowInstance<ObjectFlowNode, RelationFlowEdge>) => {
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
      <ReactFlow<ObjectFlowNode, RelationFlowEdge>
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
        ariaLabelConfig={ARIA_LABELS}
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
          对象比较多，先显示「{hubTitle}」附近。拖动画布、滚轮缩放，或用搜索找对象。
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
