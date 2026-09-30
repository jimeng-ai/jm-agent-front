import { Graph, layout } from '@dagrejs/dagre';
import type { ColumnRef, Relation, TableCard } from './types';

// 与 data-graph.css 里 .dg-card 的宽度和头部、行、底部高度一致：布局按这个算，DOM 也按这个画。
export const CARD_WIDTH = 240;
export const CARD_HEADER_HEIGHT = 58;
export const CARD_ROW_HEIGHT = 26;
export const CARD_FOOTER_HEIGHT = 28;

// 「整图一屏看得清」的判据：按一块 800×620 的名义画布算，整图缩放到能放下时比例不低于 0.55
// （卡片标题约 8px 以上）。只看数据不看窗口大小，所以同一份数据永远是同一种显示方式。
const NOMINAL_CANVAS_WIDTH = 800;
const NOMINAL_CANVAS_HEIGHT = 620;
const READABLE_ZOOM = 0.55;
/** 整图看不清时，打开就放大到关联最多的那张表附近，用这个比例。 */
export const EXPLORE_ZOOM = 0.9;

export interface CardRow extends ColumnRef {
  /** 主键列（没有主键时为最小的唯一键列）。 */
  isKey: boolean;
}

export interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 卡片上的行：键列在前，再是参与关系的列；去重，保持后端给的顺序。 */
export function cardRows(table: TableCard): CardRow[] {
  const keys = new Set(table.keyColumns.map((column) => column.name));
  const seen = new Set<string>();
  const rows: CardRow[] = [];
  for (const column of [...table.keyColumns, ...table.relationColumns]) {
    if (seen.has(column.name)) continue;
    seen.add(column.name);
    rows.push({ ...column, isKey: keys.has(column.name) });
  }
  return rows;
}

export const cardHeight = (table: TableCard): number =>
  CARD_HEADER_HEIGHT + cardRows(table).length * CARD_ROW_HEIGHT + CARD_FOOTER_HEIGHT;

/**
 * dagre 分层布局，rankdir=LR：引用方在左，被引用的主数据在右。
 * 节点和边按后端给的顺序喂入（设计文档 §5.5），同一份数据永远得到同一组坐标。返回卡片左上角坐标。
 */
export function layoutTables(tables: TableCard[], relations: Relation[]): Map<string, CardBox> {
  const graph = new Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 100, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  tables.forEach((table) =>
    graph.setNode(table.name, { width: CARD_WIDTH, height: cardHeight(table) }),
  );
  relations.forEach((relation) =>
    graph.setEdge(relation.fromTable, relation.toTable, {}, relation.id),
  );
  layout(graph);
  const boxes = new Map<string, CardBox>();
  tables.forEach((table) => {
    const node = graph.node(table.name) as CardBox;
    boxes.set(table.name, {
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
      width: node.width,
      height: node.height,
    });
  });
  return boxes;
}

/** 整图能否在名义画布里以不低于 READABLE_ZOOM 的比例一屏放下。 */
export function fitsOnOneScreen(boxes: Map<string, CardBox>): boolean {
  let width = 0;
  let height = 0;
  boxes.forEach((box) => {
    width = Math.max(width, box.x + box.width);
    height = Math.max(height, box.y + box.height);
  });
  return (
    width * READABLE_ZOOM <= NOMINAL_CANVAS_WIDTH && height * READABLE_ZOOM <= NOMINAL_CANVAS_HEIGHT
  );
}

/** 关联最多的表（起点、终点都算）；并列取后端顺序里靠前的。没有表时为 null。 */
export function hubTable(tables: TableCard[], relations: Relation[]): string | null {
  const degree = new Map<string, number>();
  relations.forEach((relation) => {
    degree.set(relation.fromTable, (degree.get(relation.fromTable) ?? 0) + 1);
    degree.set(relation.toTable, (degree.get(relation.toTable) ?? 0) + 1);
  });
  let best: string | null = null;
  let bestDegree = -1;
  for (const table of tables) {
    const d = degree.get(table.name) ?? 0;
    if (d > bestDegree) {
      best = table.name;
      bestDegree = d;
    }
  }
  return best;
}
