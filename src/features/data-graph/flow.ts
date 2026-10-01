import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { colorOf, type DomainOption } from './domains';
import type { CardBox, EdgeGroup } from './layout';
import { domainLabel, edgeLabel, relationSentence, roleLabel, tableTitle } from './text';
import type { TableCard } from './types';

export interface ObjectNodeData extends Record<string, unknown> {
  name: string;
  title: string;
  summary: string | null;
  domain: string;
  domainColor: string;
  hasSelfReference: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: (name: string) => void;
  onFocusCard: (name: string, visible: boolean) => void;
}

export type ObjectFlowNode = Node<ObjectNodeData, 'object'>;

export interface RelationEdgeData extends Record<string, unknown> {
  confirmed: boolean;
  label: string | null;
  /** 悬停时列出的全部角色，按关系顺序。 */
  roles: string[];
  dimmed: boolean;
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

/** 搜索或点击清单时请求画布把某个对象挪到视野中央；seq 让「同一个对象再点一次」也能生效。 */
export interface FocusRequest {
  name: string;
  seq: number;
}

/**
 * 把接口数据和布局结果变成 React Flow 的节点与边。坐标只来自 boxes：选中、领域筛选只改样式，布局不动。
 *
 * <p>变暗有两个来源：选中了一个对象时，和它不相邻的对象、不连着它的线变暗；筛了一个领域时，别的领域的对象变暗，
 * 线只要有一端在这个领域里就不变暗。选中的对象不在画布上（暂未发现关联的对象）时不因选中而变暗。
 */
export function buildFlow(
  tables: TableCard[],
  groups: EdgeGroup[],
  boxes: Map<string, CardBox>,
  domains: DomainOption[],
  selected: string | null,
  domainFilter: string | null,
  titleOf: (table: string) => string,
  onSelect: (name: string) => void,
  onFocusCard: (name: string, visible: boolean) => void,
): { nodes: ObjectFlowNode[]; edges: RelationFlowEdge[] } {
  const active = selected && boxes.has(selected) ? selected : null;
  const neighbours = new Set<string>();
  if (active) {
    neighbours.add(active);
    groups.forEach((group) => {
      if (group.fromTable === active) neighbours.add(group.toTable);
      if (group.toTable === active) neighbours.add(group.fromTable);
    });
  }
  const outOfDomain = new Set<string>();
  const dimmed = new Set<string>();
  tables.forEach((table) => {
    if (domainFilter !== null && domainLabel(table.domain) !== domainFilter) outOfDomain.add(table.name);
    if ((active !== null && !neighbours.has(table.name)) || outOfDomain.has(table.name)) dimmed.add(table.name);
  });

  const nodes: ObjectFlowNode[] = [];
  tables.forEach((table) => {
    const box = boxes.get(table.name);
    if (!box) return;
    nodes.push({
      id: table.name,
      type: 'object',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      draggable: false,
      selectable: false,
      data: {
        name: table.name,
        title: tableTitle(table),
        summary: table.summary,
        domain: domainLabel(table.domain),
        domainColor: colorOf(domains, table.domain),
        hasSelfReference: table.selfReferences.length > 0,
        selected: table.name === active,
        dimmed: dimmed.has(table.name),
        onSelect,
        onFocusCard,
      },
    });
  });
  const edges: RelationFlowEdge[] = groups.map((group) => ({
    id: group.id,
    type: 'relation',
    source: group.fromTable,
    target: group.toTable,
    selectable: false,
    focusable: false,
    // 读屏软件念的是关系句子；不给的话 React Flow 默认念「Edge from 表名 to 表名」。
    ariaLabel: group.relations.map((relation) => relationSentence(relation, titleOf)).join('；'),
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#38bdf8' },
    data: {
      confirmed: group.relations.some((relation) => relation.tier === 'CONFIRMED'),
      label: edgeLabel(group.relations),
      roles: group.relations.map((relation) => roleLabel(relation, titleOf)),
      dimmed:
        (active !== null && group.fromTable !== active && group.toTable !== active) ||
        (outOfDomain.has(group.fromTable) && outOfDomain.has(group.toTable)),
    },
  }));
  return { nodes, edges };
}
