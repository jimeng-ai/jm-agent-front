/**
 * 连接器：客户系统接入（数据库 / HTTP 接口等）。全超管可见可管。
 *
 * ★ 本模块的核心约定：**前端不认识任何具体的连接器类型。**
 * 字段清单由后端 `GET /admin/connectors/kinds` 下发（每种类型一份表单 schema），
 * 前端按 schema 渲染。这是「新增一种连接器类型，前端零改动」这条验收标准的实现手段——
 * 所以这里**不允许**出现任何 kind 的字段名常量，也不允许出现 `if (kind === 'MYSQL')`。
 *
 * 后端 Long / 数值字段按字符串下发（全局 write_numbers_as_strings），故 id 用 string。
 * 凭据只写不读：读接口永远不回传，敏感参数连占位串都不给。
 */

/** 参数的控件类型，与后端 ParamType 一一对应。 */
export type ParamFieldType =
  | 'string'
  | 'password'
  | 'int'
  | 'bool'
  | 'enum'
  | 'textarea'
  | 'string_list';

/** 一个参数的定义。来自后端 ParamSpec.toFormSchema()，同时驱动后端校验与前端渲染。 */
export interface ParamFieldSchema {
  name: string;
  label: string;
  type: ParamFieldType;
  required: boolean;
  /** true 表示敏感：不进 config_json，只进密文，且永不回读。编辑时留空 = 沿用原值。 */
  secret: boolean;
  default?: string;
  placeholder?: string;
  help?: string;
  options?: string[];
  pattern?: string;
  min?: number;
  max?: number;
  /** 分组名，前端据此分段渲染。 */
  group: string;
}

/** 一种连接器类型。 */
export interface ConnectorKind {
  kind: string;
  displayName: string;
  /** 该类型**声明**支持的能力（小写）。实例实际可用的能力见 ConnectorView.capabilities。 */
  capabilities: string[];
  fields: ParamFieldSchema[];
}

export type ConnectorStatus = 'ACTIVE' | 'DISABLED';
export type HealthState = 'UNKNOWN' | 'HEALTHY' | 'UNHEALTHY';

export interface ConnectorView {
  id: string;
  name: string;
  displayName?: string | null;
  kind: string;
  /** 类型的中文名，直接展示。 */
  kindLabel: string;
  /** 非敏感参数。敏感参数不会出现在这里。 */
  params: Record<string, unknown>;
  transport?: string | null;
  status: ConnectorStatus;
  /** 探测后回填的**实际**可用能力（大写，如 QUERY / DESCRIBE）。 */
  capabilities: string[];
  healthState: HealthState;
  healthCheckedAt?: string | null;
  /** 不健康的原因，后端已脱敏，可直接展示。 */
  healthReason?: string | null;
  /** ★ 未通过只读验证的连接不该被当成安全的，列表里要显眼。 */
  readonlyVerified: boolean;
  readonlyVerifiedAt?: string | null;
  createTime?: string | null;
}

/**
 * 录入/编辑载荷。
 *
 * 刻意只有一个 `params` 口袋而不是每种类型一批字段——与后端 ConnectorUpsert 对齐。
 * 这里若为某个类型加一个具名字段，下次加新类型就得再加一批，抽象就白做了。
 */
export interface ConnectorUpsert {
  name: string;
  displayName?: string;
  /** 新建必填；编辑时不可改（后端会拒绝）。 */
  kind?: string;
  params: Record<string, unknown>;
  transport?: string;
}
