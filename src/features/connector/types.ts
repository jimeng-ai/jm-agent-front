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
  /**
   * 写操作策略。三态，后端 WritePolicy.parse() 认不出来的值一律回落 FORBIDDEN，
   * 所以这里可以当成必有值用，前端不用再兜一遍底。
   */
  writePolicy: WritePolicy;
  /** 策略的中文名（只读 / 写需审批 / 写自动）。直接展示，别在前端再维护一份枚举→文案的映射。 */
  writePolicyLabel: string;
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
  /**
   * 写策略。**刻意是 string 而不是 WritePolicy**：它来自表单里的 Select，
   * 收窄成联合类型只会逼着调用方到处 cast；真正的闸在后端（parse 不认识就回落 FORBIDDEN）。
   */
  writePolicy?: string;
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

/**
 * 试连结果。
 *
 * 只读判定刻意保留三态（已验证 / 确认可写 / 判不出来）而不是压成一个布尔：
 * 三者对使用者意味着完全不同的动作（可以保存 / 换只读账号 / 去查账号权限），
 * 压成布尔等于替使用者做了这个判断。
 */
export interface ProbeOutcome {
  ok: boolean;
  failureReason?: string | null;
  capabilities: string[];
  readonlyVerified: boolean;
  readonlyUndetermined: boolean;
  readonlyDetail?: string | null;
}

// ---------------------------------------------------------------------------
// 写操作分级：授权命令生成 + 写操作审批
// ---------------------------------------------------------------------------

/**
 * 连接级的写策略。
 *
 * 刻意是三态而不是「允不允许写」一个布尔：中间那档（写需审批）才是这套东西存在的理由——
 * 客户既不想把生产库交给模型自动写，也不想把写这件事整个砍掉。
 * 压成布尔等于逼客户在「全禁」和「全放」之间二选一。
 *
 * 与后端 `WritePolicy` 枚举同名同值；后端 `parse()` 认不出来一律回落 FORBIDDEN（fail-closed）。
 */
export type WritePolicy = 'FORBIDDEN' | 'REQUIRE_APPROVAL' | 'AUTO';

/**
 * 生成授权命令的入参。
 *
 * `kind` 原样回传给后端：**由后端决定生成哪种数据库的语法**，前端一如既往不认识任何具体类型
 * （这里若出现 `if (kind === 'MYSQL')`，「新增一种连接器类型前端零改动」就破了）。
 */
export interface GrantScriptRequest {
  kind: string;
  /** 连接参数里的库名。可能还没填，此时后端只能生成不带库名的骨架。 */
  database?: string;
  username: string;
  /** MySQL 的 `user@host` 里的 host：`%` 表示任意来源。 */
  host: string;
  /** 空数组 = 整库授权；非空 = 只授这几张表。 */
  tables: string[];
  /** 写策略决定授权里给不给 INSERT/UPDATE/DELETE，所以必须一起传。 */
  writePolicy: string;
}

/** 生成结果。`sql` 是给人复制去执行的，`notes` 是必须一起读的注意事项（比如密码要自己换）。 */
export interface GrantScriptResult {
  sql: string;
  notes: string[];
}

/** 写操作的三种动作。DDL / TRUNCATE / REPLACE 在护栏那层就被挡掉了，不会出现在这里。 */
export type WriteOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * 审批单状态。
 *
 * 注意 APPROVED 与 FAILED 是**两件事**：批准之后语句还要真的在客户库上跑一次，
 * 跑挂了落 FAILED。所以「批准接口返回 200」不等于「数据改成功了」——
 * 审批页要看返回行的 status 再决定提示成功还是失败。
 */
export type PendingWriteStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'FAILED';

/**
 * 一条待审批（或已决策）的写操作。
 *
 * `statementText` 是**平台护栏改写后、将要真正打到客户库上的那一条**，不是模型写的原文。
 * 审批看的必须是这一条：看原文批准、执行改写后的语句，等于没审。
 */
export interface PendingWriteRow {
  id: string;
  time: string;
  connectorName: string;
  agentId?: string | null;
  /** Agent 已删除时为空——审批记录不随 Agent 消失。 */
  agentName?: string | null;
  operation: WriteOperation;
  targetTable?: string | null;
  statementText: string;
  status: PendingWriteStatus;
  /** 仅 APPROVED 后有值（真正执行掉的行数）。numbers-as-strings，渲染前 Number() 兜底。 */
  affectedRows?: number | string | null;
  /** 后端已脱敏，可直接展示给客户。 */
  errorDetail?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  /** 过了这个点后端就不再放行（超时未审 = 不执行，fail-closed）。 */
  expiresAt?: string | null;
}

export interface PendingWriteQuery {
  page?: number;
  size?: number;
  connectorId?: string;
  agentId?: string;
  /** 不传 = 全部状态。审批页默认只传 PENDING。 */
  status?: PendingWriteStatus;
}
