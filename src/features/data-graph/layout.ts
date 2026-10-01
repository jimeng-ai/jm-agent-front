import { Graph, layout } from '@dagrejs/dagre';
import type { Relation, TableCard } from './types';

// 与 data-graph.css 里 .dg-card 的宽高一致：布局按这个算，DOM 也按这个画。所有卡片一样大（设计文档 §8.2）。
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 96;

// 「整图一屏看得清」的判据：按一块 800×620 的名义画布算，整图缩放到能放下时比例不低于 0.55
// （卡片标题约 8px 以上）。只看数据不看窗口大小，所以同一份数据永远是同一种显示方式。
const NOMINAL_CANVAS_WIDTH = 800;
const NOMINAL_CANVAS_HEIGHT = 620;
const READABLE_ZOOM = 0.55;
/** 整图看不清时，打开就放大到关联最多的那个对象附近，用这个比例。 */
export const EXPLORE_ZOOM = 0.9;

/** dagre 算不出来时的兜底：按对象顺序排成固定列数的网格。 */
const FALLBACK_COLUMNS = 6;
const FALLBACK_GAP_X = 100;
const FALLBACK_GAP_Y = 40;

export interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画布上的一根线：同一方向（起点对象 → 终点对象）上的全部关系。 */
export interface EdgeGroup {
  id: string;
  fromTable: string;
  toTable: string;
  relations: Relation[];
}

/**
 * 按「起点对象 → 终点对象」把关系合并成线（设计文档 §8.2）。A→B 和 B→A 是两根。
 * 顺序按每一组第一条关系在后端顺序里出现的位置，保证同一份数据永远是同一组线。
 */
export function groupRelations(relations: Relation[]): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>();
  for (const relation of relations) {
    const id = `${relation.fromTable}→${relation.toTable}`;
    const group = groups.get(id);
    if (group) {
      group.relations.push(relation);
    } else {
      groups.set(id, { id, fromTable: relation.fromTable, toTable: relation.toTable, relations: [relation] });
    }
  }
  return [...groups.values()];
}

/**
 * dagre 分层布局，rankdir=LR：引用方在左，被引用的主数据在右。返回卡片左上角坐标。
 *
 * <p>每个方向只喂一条边：dagre 3.1.1 遇到同一方向的平行边（multigraph）会抛
 * 「Not possible to find intersection inside of the rectangle」，整页跟着崩——一张凭证行表有五条指向科目表的关系是常态。
 * 节点和边按后端给的顺序喂入，同一份数据永远得到同一组坐标；dagre 仍然算不出来时按网格兜底，页面不崩。
 */
export function layoutTables(tables: TableCard[], groups: EdgeGroup[]): Map<string, CardBox> {
  try {
    const graph = new Graph();
    graph.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 120, marginx: 24, marginy: 24 });
    graph.setDefaultEdgeLabel(() => ({}));
    tables.forEach((table) => graph.setNode(table.name, { width: CARD_WIDTH, height: CARD_HEIGHT }));
    groups.forEach((group) => graph.setEdge(group.fromTable, group.toTable));
    layout(graph);
    const boxes = new Map<string, CardBox>();
    tables.forEach((table) => {
      const node = graph.node(table.name) as CardBox;
      boxes.set(table.name, {
        x: node.x - CARD_WIDTH / 2,
        y: node.y - CARD_HEIGHT / 2,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
    });
    return boxes;
  } catch {
    return gridLayout(tables);
  }
}

function gridLayout(tables: TableCard[]): Map<string, CardBox> {
  const boxes = new Map<string, CardBox>();
  tables.forEach((table, index) => {
    boxes.set(table.name, {
      x: 24 + (index % FALLBACK_COLUMNS) * (CARD_WIDTH + FALLBACK_GAP_X),
      y: 24 + Math.floor(index / FALLBACK_COLUMNS) * (CARD_HEIGHT + FALLBACK_GAP_Y),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
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

/** 关联最多的对象（按关系条数，起点、终点都算）；并列取后端顺序里靠前的。没有对象时为 null。 */
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
