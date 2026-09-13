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

// ---------------------------------------------------------------------------
// 使用记录（审计）
// ---------------------------------------------------------------------------

/**
 * 一条使用记录。回答「这个连接被谁、在什么时候、用来做了什么」。
 *
 * 两个字段值得单独说明：
 * - `errorDetail` 后端已脱敏（存的就是 ConnectorException.getSafeDetail()），可直接展示给客户；
 *   原始异常从来只进日志。
 * - `statementText` 是**平台实际执行**的语句，可能被护栏改写过（注入/收紧 LIMIT），
 *   也可能超长被截断并标注「…[已截断]」。要的就是「真正打到客户库上的那条」。
 */
export interface ConnectorAuditRow {
  id: string;
  time: string;
  connectorId: string;
  connectorName: string;
  agentId?: string | null;
  /** Agent 已删除时为空——审计记录不随 Agent 消失。 */
  agentName?: string | null;
  capability: string;
  operation: string;
  traceId?: string | null;
  rowCount?: number | string | null;
  elapsedMs?: number | string | null;
  success: boolean;
  errorCode?: string | null;
  errorDetail?: string | null;
  statementText?: string | null;
}

export interface ConnectorAuditQuery {
  page?: number;
  size?: number;
  connectorId?: string;
  agentId?: string;
  success?: boolean;
  capability?: string;
  /** 后端是 java.util.Date，传 ISO 字符串即可。 */
  start?: string;
  end?: string;
}

// ---------------------------------------------------------------------------
// 结构快照与漂移检测
// ---------------------------------------------------------------------------

/** 快照里的一个对象（表 / 视图 / 接口…）。后端已解析好 detail，前端不再解一遍。 */
export interface ConnectorSchemaObject {
  objectType: string;
  objectName: string;
  objectComment?: string | null;
  fields: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    comment?: string | null;
    extra?: string | null;
  }>;
  /** 这个对象的结构没取到时的原因（权限只到部分表是常见情况）；正常为空。 */
  error?: string | null;
  syncedAt?: string | null;
}

/** 对象级变化。details 对 CHANGED 而言是列级差异的中文描述。 */
export interface SchemaObjectDiff {
  objectName: string;
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  details: string[];
}

export interface SchemaSnapshotResult {
  objectCount: number | string;
  totalObjects: number | string;
  /** 对象数超过平台上限，本次只覆盖了一部分——这时「没有差异」不等于「真的没变」。 */
  truncated: boolean;
  /** 第一次快照，此时「全是新增」没有信息量，不该当成结构漂移报警。 */
  firstSnapshot: boolean;
  diffs: SchemaObjectDiff[];
  syncedAt?: string | null;
}
