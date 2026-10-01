import type { Edge, Node } from '@xyflow/react';
import { cardRows, type CardBox, type CardRow } from './layout';
import { tableTitle } from './text';
import type { Relation, RelationTier, TableCard } from './types';

export interface TableNodeData extends Record<string, unknown> {
  name: string;
  title: string;
  /** 有中文名时是物理名；否则是表注释（说明句）或空。 */
  subtitle: string | null;
  subtitleIsName: boolean;
  rows: CardRow[];
  fieldCount: number;
  hasHierarchy: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: (name: string) => void;
}

export type TableFlowNode = Node<TableNodeData, 'table'>;

export interface RelationEdgeData extends Record<string, unknown> {
  tier: RelationTier;
  label: string | null;
  fromMark: string | null;
  toMark: string | null;
  dimmed: boolean;
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

/** 搜索或点击清单时请求画布把某张表挪到视野中央；seq 让「同一张表再点一次」也能生效。 */
export interface FocusRequest {
  name: string;
  seq: number;
}

/**
 * 把接口数据和布局结果变成 React Flow 的节点与边。坐标只来自 boxes，选中与否只改样式——点表不会让布局动。
 * 选中的表不在画布上（未发现关联的表）时不做任何变暗。
 */
export function buildFlow(
  tables: TableCard[],
  relations: Relation[],
  boxes: Map<string, CardBox>,
  selected: string | null,
  onSelect: (name: string) => void,
): { nodes: TableFlowNode[]; edges: RelationFlowEdge[] } {
  const active = selected && boxes.has(selected) ? selected : null;
  const neighbours = new Set<string>();
  if (active) {
    neighbours.add(active);
    relations.forEach((relation) => {
      if (relation.fromTable === active) neighbours.add(relation.toTable);
      if (relation.toTable === active) neighbours.add(relation.fromTable);
    });
  }
  const nodes: TableFlowNode[] = [];
  tables.forEach((table) => {
    const box = boxes.get(table.name);
    if (!box) return;
    nodes.push({
      id: table.name,
      type: 'table',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      draggable: false,
      selectable: false,
      data: {
        name: table.name,
        title: tableTitle(table),
        subtitle: table.displayName ? table.name : table.comment,
        subtitleIsName: Boolean(table.displayName),
        rows: cardRows(table),
        fieldCount: table.fieldCount,
        hasHierarchy: table.selfReferences.length > 0,
        selected: table.name === active,
        dimmed: active !== null && !neighbours.has(table.name),
        onSelect,
      },
    });
  });
  const edges: RelationFlowEdge[] = relations.map((relation) => ({
    id: relation.id,
    type: 'relation',
    source: relation.fromTable,
    target: relation.toTable,
    sourceHandle: `out:${relation.fromColumn}`,
    targetHandle: `in:${relation.toColumn}`,
    selectable: false,
    focusable: false,
    data: {
      tier: relation.tier,
      label: relation.role,
      fromMark:
        relation.cardinality === 'MANY_TO_ONE'
          ? 'N'
          : relation.cardinality === 'ONE_TO_ONE'
            ? '1'
            : null,
      toMark: relation.cardinality ? '1' : null,
      dimmed: active !== null && relation.fromTable !== active && relation.toTable !== active,
    },
  }));
  return { nodes, edges };
}
