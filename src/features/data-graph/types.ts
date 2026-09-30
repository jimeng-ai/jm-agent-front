// 数据星图接口的形状（data-service 设计文档 §5.1）。
// spring.jackson.write_numbers_as_strings=true：数字到前端都是字符串，api.ts 负责转成 number。

export type SemanticStatus = 'READY' | 'RUNNING' | 'FAILED' | null;
export type RelationTier = 'CONFIRMED' | 'INFERRED';
export type RelationCardinality = 'MANY_TO_ONE' | 'ONE_TO_ONE' | null;
export type ConfirmedBy = 'DATA' | 'BUSINESS' | null;
export type ColumnKey = 'PRIMARY' | 'UNIQUE' | null;

type NumericWire = number | string;

export interface SystemSummaryWire {
  connectorId: string;
  name: string;
  displayName: string | null;
  kind: string | null;
  status: string | null;
  semanticStatus: SemanticStatus;
  tableCount: NumericWire;
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
}

export interface TableCardWire {
  name: string;
  displayName: string | null;
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
  label: string | null;
  discriminatorColumn: string | null;
}

export interface SystemGraphWire {
  connectorId: string;
  name: string;
  displayName: string | null;
  semanticStatus: SemanticStatus;
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
  comment: string | null;
  objectType: 'TABLE' | 'VIEW';
  selfReferences: SelfReference[];
  fields: FieldInfo[];
  relations: Relation[];
}
