// 数据星图接口的形状（data-service 设计文档 §7.2）。
// spring.jackson.write_numbers_as_strings=true：数字到前端都是字符串，api.ts 负责转成 number。

export type SemanticStatus = 'READY' | 'RUNNING' | 'FAILED' | null;
/**
 * 业务文字的整理状态：正在整理（在跑，或从没跑完过但补全链会来跑）/ 上次成功 / 上次失败 /
 * 没人会来整理（补全链关着、语义层没生成成功）。只用来决定要不要挂提示，不上屏。
 */
export type ViewStatus = 'RUNNING' | 'READY' | 'FAILED' | null;
export type RelationTier = 'CONFIRMED' | 'INFERRED';
export type RelationCardinality = 'MANY_TO_ONE' | 'ONE_TO_ONE' | null;
export type ConfirmedBy = 'DATA' | 'BUSINESS' | null;
export type ColumnKey = 'PRIMARY' | 'UNIQUE' | null;
/** 对象标题来自哪一档：业务视图 → 像名称的表注释 → 表名。 */
export type NameSource = 'BUSINESS_VIEW' | 'COMMENT' | 'PHYSICAL';

type NumericWire = number | string;

export interface SystemSummaryWire {
  connectorId: string;
  name: string;
  displayName: string | null;
  kind: string | null;
  status: string | null;
  semanticStatus: SemanticStatus;
  tableCount: NumericWire;
  truncated: boolean;
  viewStatus: ViewStatus;
}

export interface SystemSummary extends Omit<SystemSummaryWire, 'tableCount'> {
  tableCount: number;
}

export interface ColumnRef {
  name: string;
  comment: string | null;
}

export interface SelfReference {
  fromColumn: string;
  toColumn: string;
  tier: RelationTier;
  confirmedBy: ConfirmedBy;
  role: string | null;
}

export interface TableCardWire {
  name: string;
  displayName: string | null;
  nameSource: NameSource;
  summary: string | null;
  domain: string | null;
  comment: string | null;
  objectType: 'TABLE' | 'VIEW';
  related: boolean;
  selfReferences: SelfReference[];
  keyColumns: ColumnRef[];
  relationColumns: ColumnRef[];
  fieldCount: NumericWire;
}

export interface TableCard extends Omit<TableCardWire, 'fieldCount'> {
  fieldCount: number;
}

export interface Relation {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: RelationCardinality;
  tier: RelationTier;
  confirmedBy: ConfirmedBy;
  /** 关系角色名（业务视图，缺了退回干净的列注释）；都没有为 null。 */
  role: string | null;
  discriminatorColumn: string | null;
}

export interface SystemGraphWire {
  connectorId: string;
  name: string;
  displayName: string | null;
  semanticStatus: SemanticStatus;
  truncated: boolean;
  viewStatus: ViewStatus;
  tables: TableCardWire[];
  relations: Relation[];
}

export interface SystemGraph extends Omit<SystemGraphWire, 'tables'> {
  tables: TableCard[];
}

export interface FieldInfo {
  name: string;
  type: string | null;
  nullable: boolean;
  comment: string | null;
  key: ColumnKey;
  inRelation: boolean;
}

export interface TableDetail {
  name: string;
  displayName: string | null;
  nameSource: NameSource;
  summary: string | null;
  domain: string | null;
  comment: string | null;
  objectType: 'TABLE' | 'VIEW';
  selfReferences: SelfReference[];
  fields: FieldInfo[];
  relations: Relation[];
}
