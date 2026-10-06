import type { Relation, SelfReference, SemanticStatus } from './types';

interface Named {
  name: string;
  displayName: string | null;
}

/** 没有领域的对象归到这一类（设计文档 §6.3）。 */
export const UNCLASSIFIED = '未分类';

/** 标题：业务名 → 像名称的表注释（后端已按这个顺序给出 displayName）→ 表名。 */
export const tableTitle = (table: Named): string => table.displayName ?? table.name;

export const domainLabel = (domain: string | null): string => domain ?? UNCLASSIFIED;

/**
 * 关系说成一句话（设计文档附录 E）。句子里只用业务名和角色名，不出现表名、列名。
 * 角色名和终点对象的业务名一样时不重复写「作为」。
 */
export function relationSentence(relation: Relation, titleOf: (table: string) => string): string {
  const from = titleOf(relation.fromTable);
  const to = titleOf(relation.toTable);
  let sentence: string;
  if (relation.cardinality === 'MANY_TO_ONE') {
    sentence =
      relation.role && relation.role !== to
        ? `每条「${from}」对应一个「${to}」（作为${relation.role}）`
        : `每条「${from}」对应一个「${to}」`;
  } else if (relation.cardinality === 'ONE_TO_ONE') {
    sentence = `「${from}」与「${to}」一一对应`;
  } else {
    sentence = `「${from}」与「${to}」有关联`;
  }
  return relation.discriminatorColumn ? `${sentence}（只对部分类型成立）` : sentence;
}

/** 自关联：「{A}」内部有关联（{角色}）；没有角色名时去掉括号。 */
export const selfReferenceSentence = (title: string, ref: SelfReference): string =>
  ref.role ? `「${title}」内部有关联（${ref.role}）` : `「${title}」内部有关联`;

/** 这条关系是怎么来的（沿用 v2 的说法）。 */
export function relationSource(relation: { tier: Relation['tier']; confirmedBy: Relation['confirmedBy'] }): string {
  if (relation.tier === 'INFERRED') return '按表结构推断，尚未核对';
  return relation.confirmedBy === 'BUSINESS' ? '业务方确认' : '数据核对通过';
}

/** 技术信息区的一行：字段对应 + 核对状态。 */
export const technicalLine = (relation: Relation): string =>
  `${relation.fromTable}.${relation.fromColumn} → ${relation.toTable}.${relation.toColumn} · ${relationSource(relation)}`;

/** 一条关系在线上、悬停提示里的叫法：角色名；没有角色名时说它对应哪个对象。 */
export const roleLabel = (relation: Relation, titleOf: (table: string) => string): string =>
  relation.role ?? `对应「${titleOf(relation.toTable)}」`;

/** 一根线上写的字：只有一条关系时写它的角色名（没有就不写）；多条时写「N 种关联」。 */
export const edgeLabel = (relations: Relation[]): string | null =>
  relations.length > 1 ? `${relations.length} 种关联` : (relations[0]?.role ?? null);

/**
 * 还没有关联时画布区和「关联清单」页签共用的一句话（设计文档 §8.4，v2 审查 #10）。
 * 语义层的状态只用来挑这句话，原文不上屏。
 */
export function emptyRelationsText(status: SemanticStatus): string {
  if (status === null) return '这个系统的业务对象还在整理中，完成后会自动出现。';
  if (status === 'RUNNING') return '正在整理，完成后刷新页面即可看到。';
  if (status === 'FAILED') return '整理没有成功，请到数据连接重新生成。';
  return '暂未发现可以确认的关联。';
}

export interface SentenceGroup {
  key: string;
  title: string;
  relations: Relation[];
}

/**
 * 关联清单：按对象两两分组，不分方向（客户、供应商互相引用的两条放在一组）。
 * 组的顺序按每组第一条关系在后端顺序里出现的位置；组名按第一条关系的起点、终点写。
 */
export function groupByPair(relations: Relation[], titleOf: (table: string) => string): SentenceGroup[] {
  const groups = new Map<string, SentenceGroup>();
  for (const relation of relations) {
    const key = [relation.fromTable, relation.toTable].sort().join('\u0000');
    const group = groups.get(key);
    if (group) {
      group.relations.push(relation);
    } else {
      groups.set(key, {
        key,
        title: `「${titleOf(relation.fromTable)}」与「${titleOf(relation.toTable)}」`,
        relations: [relation],
      });
    }
  }
  return [...groups.values()];
}

/** 单个对象的「和谁有关」：按另一端的对象分组，组名是那个对象的业务名。 */
export function groupByCounterpart(
  relations: Relation[],
  table: string,
  titleOf: (table: string) => string,
): SentenceGroup[] {
  const groups = new Map<string, SentenceGroup>();
  for (const relation of relations) {
    const other = relation.fromTable === table ? relation.toTable : relation.fromTable;
    const group = groups.get(other);
    if (group) {
      group.relations.push(relation);
    } else {
      groups.set(other, { key: other, title: titleOf(other), relations: [relation] });
    }
  }
  return [...groups.values()];
}
