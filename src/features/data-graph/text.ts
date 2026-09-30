import type { Relation, SelfReference } from './types';

interface Named {
  name: string;
  displayName: string | null;
}

/** 标题：像名称的客户表注释，否则物理名（data-service 设计文档 §5.4）。 */
export const tableTitle = (table: Named): string => table.displayName ?? table.name;

/** 关系说成一句话（设计文档 §6.4）；表名一律用标题。 */
export function relationSentence(relation: Relation, titleOf: (table: string) => string): string {
  const from = titleOf(relation.fromTable);
  const to = titleOf(relation.toTable);
  const columns = `${relation.fromColumn} → ${relation.toColumn}`;
  let sentence: string;
  if (relation.cardinality === 'MANY_TO_ONE') {
    sentence = `每条「${from}」对应一条「${to}」（${columns}）`;
  } else if (relation.cardinality === 'ONE_TO_ONE') {
    sentence = `「${from}」与「${to}」一一对应（${columns}）`;
  } else {
    sentence = `「${from}」的 ${relation.fromColumn} 关联「${to}」的 ${relation.toColumn}`;
  }
  return relation.discriminatorColumn
    ? `${sentence}，按 ${relation.discriminatorColumn} 区分类型`
    : sentence;
}

export const selfReferenceSentence = (title: string, ref: SelfReference): string =>
  `「${title}」内部有上下级（${ref.fromColumn} → ${ref.toColumn}）`;

export function relationSource(relation: Relation): string {
  if (relation.tier === 'INFERRED') return '按表结构推断，尚未核对';
  return relation.confirmedBy === 'BUSINESS' ? '业务方确认' : '数据核对通过';
}
