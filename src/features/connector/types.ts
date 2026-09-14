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

  // ── 语义层状态 ──────────────────────────────────────────────────────────
  // 接入时零人工：没有表单、没有确认页，说明书是背着人推导出来的。那就必须有一个地方能回答
  // 「它跑了没有、跑成了没有」——否则「零人工」在界面上等同于「什么都没发生」。
  // 下面三个字段一起才拼得出那一行字：语义层：生成中 / 已生成 / 失败 / 不适用。

  /**
   * 推导状态。后端只产出 NONE | RUNNING | READY | FAILED | NOT_APPLICABLE 五个值之一，
   * 且把存量行上的 NULL 在 toView 里归一成 NONE，所以正常不会缺。
   *
   * ★ 仍标成可选，并且渲染时必须有兜底分支：漏认一个值那一格就是**空白**，
   * 而「空白」和「没跑过」在人眼里是一回事——于是一条根本推不了语义层的 HTTP 连接
   * 会被当成卡住了，有人去点重试，永远点不出结果。
   */
  semanticStatus?: SemanticStatus | null;

  /**
   * 最近一次【成功生成】的时间。失败与「不适用」都不盖这个戳，
   * 所以它回答的是「上次什么时候还是好的」，**不能单独用来判断当前状态**。
   */
  semanticSyncedAt?: string | null;

  /** 本次（最近一次）推导【开始】的时间。★ RUNNING 时「生成中」要显示的是它，不是 semanticSyncedAt。 */
  semanticClaimAt?: string | null;

  /**
   * 结果摘要（覆盖了几张表、丢了多少条）、失败原因、或「推导已关闭」。
   *
   * ★ 失败分支写进来的是**原始异常摘要**，没过统一脱敏，常带客户的主机名和账号。
   * 本页限企业超管，所以照常展示；但别把它搬到任何客户侧界面上。
   */
  semanticNote?: string | null;

  // ── 数据出库档位 ────────────────────────────────────────────────────────────
  // 三个字段一起给，是因为这一格在界面上不是一个下拉框，而是一句要被人读懂的承诺：
  // 档位值（提交时**原样回填**）、短名（列表/下拉框显示）、这一档到底什么东西会出库（展开显示）。
  // 只拿前两个，界面上就只剩三个人畜无害的词，客户看不出第 3 档和第 2 档差在哪——
  // 而那正是他唯一真正需要看懂的一次选择。

  /**
   * 数据出库档位。后端只产出 METADATA_ONLY | DERIVED_STATS | SAMPLE_VALUES 三个值之一，
   * 存量行上的 NULL 在 toView 里已归一成默认档（DERIVED_STATS），所以正常不会缺。
   *
   * ★ 仍标成可选：兜底分支必须存在（同 semanticStatus 那条注释的理由）。
   * ★ 更要紧的是**编辑表单必须把它原样回填进 ConnectorUpsert.semanticDataTier**——
   *   那边留空等于第 2 档，**不等于「保持原样」**，漏回填会把一条已开第 3 档的连接静默降档。
   */
  semanticDataTier?: SemanticDataTier | null;

  /** 档位的中文短名（第 1 档 · 纯元数据 / 第 2 档 · 派生统计 / 第 3 档 · 样本值）。有它就直接展示它。 */
  semanticDataTierLabel?: string | null;

  /**
   * 这一档【具体什么东西会离开客户的数据库】，一句话，可直接展示给客户。
   *
   * ★ 它和 DDL 列注释、后端枚举的 javadoc 是**同一句话**的三个落点，来源都是
   * `SemanticDataTier.egressStatement()`。后端给了就用后端这份——分叉了就等于没有安全说明。
   */
  semanticDataTierEgress?: string | null;

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
  /**
   * 数据出库档位。同上，刻意是 string——它也来自表单里的 Select。
   *
   * ★★ **留空 = 默认档（DERIVED_STATS），不是「保持原样」。**
   * 本接口是整体覆盖的 PUT，不是局部打补丁。后端刻意这么定，理由是让「省略」等于「沿用」
   * 会造出一个**没人审计得到的粘性状态**：此后每一次「改个显示名」的保存都在默默给第 3 档续期，
   * 事后谁也说不清当初是谁把真实取值出库这件事打开的。
   *
   * 所以**编辑表单必须把 ConnectorView.semanticDataTier 原样回填进来再提交**。漏了它，
   * 用户只是去改一个显示名，就会把一条第 3 档的连接降回第 2 档，而界面上什么都不会说。
   *
   * 填错不会悄悄降档：非空但认不出来的值后端一律 400 拒绝（拼错的档位被静默降一档存下去、
   * 界面还显示着刚才选的那个，才是真正查不出来的那种失效）。
   */
  semanticDataTier?: string;
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
 * 数据出库档位：为了看懂客户那个库，我们允许**什么形态的东西**离开它。
 *
 * 刻意是三档而不是「许不许读数据」一个布尔：表名、「这一列 NULL 率 3%」、「这一列的 top-20 实际取值」
 * 三者的敏感度差着数量级。压成布尔，客户只能一刀切到最严那头，然后为此付出代价——
 * 真实生产库上，纯元数据推表关系的精确率约 0.49，允许库内采样的是 1.00。
 * **推错的表关系不报错**，它只让模型 join 出一个看着正常的错数字，比「查不出来」难发现得多。
 *
 * 与 {@link WritePolicy} 是**两道互不替代的闸**：那个管「能不能改客户的数据」，
 * 这个管「能带走客户的什么数据」。一条只读连接照样可能在第 3 档上把真实取值带出来。
 *
 * 与后端 `SemanticDataTier` 枚举同名同值。★ 前端**不要按序号比较档位**（`>= 2` 这种）：
 * 后端刻意不暴露序号，就是因为那种比较写错一个符号不会报错，只会让取值多走一档出去。
 */
export type SemanticDataTier = 'METADATA_ONLY' | 'DERIVED_STATS' | 'SAMPLE_VALUES';

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
  /**
   * ★ 提交时**预估**的影响行数。**不是承诺**：估算在提交时、执行在批准时，中间数据会变。
   *
   * 它存在的理由：`affectedRows` 要执行完才有值，那时候批已经批完了。而审批的人
   * 光看一条 SQL 判不出它命中 3 行还是 30 万行——这个数是他唯一的范围参考。
   * 估不出来为空（INSERT ... SELECT、超时、方言不支持）。
   */
  estimatedRows?: number | string | null;
  /**
   * ★ 发起这次写请求的那轮对话的 trace_id。
   *
   * 只看一条 SQL 判不出它该不该执行——得知道「模型当时为什么要写这一条」。
   * 有它才能顺着回到那段对话（调用日志 · Trace 页按 trace_id 查）。
   */
  traceId?: string | null;
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

// ---------------------------------------------------------------------------
// 语义层（说明书）
// ---------------------------------------------------------------------------

/**
 * 推导状态。后端枚举的**全集**，一个不能漏。
 *
 * ★ `NOT_APPLICABLE` 不是错误：这种连接器压根不提供结构自描述（今天的 HTTP 就是，
 * 它只声明 INVOKE / HEALTH），没有结构可推，重跑也不会变。把它渲染成红色，
 * 只会让人去修一个没坏的东西——而真正 FAILED 的那几条混在一堆假警报里，反而没人看。
 */
export type SemanticStatus = 'NONE' | 'RUNNING' | 'READY' | 'FAILED' | 'NOT_APPLICABLE';

/** 一条断言挂在什么上。METRIC / CAVEAT 不挂具体的表，挂整条连接。 */
export type SemanticScope = 'OBJECT' | 'FIELD' | 'JOIN' | 'METRIC' | 'CAVEAT';

/**
 * 这句话是谁说的。**这是全部信任判断的起点**：
 * INFERRED 是模型看着表名列名推的，HUMAN 是业务方在对话里亲口答的，IMPORTED 是客户库里的注释。
 */
export type SemanticSource = 'INFERRED' | 'HUMAN' | 'IMPORTED';

/** 依据来源。分界线是「有没有外部依据」，不是「能不能验证」。 */
export type SemanticEvidence = 'COMMENT' | 'DATA' | 'NAME' | 'GUESS';

/** 行状态。STALE = 它锚的结构已经变了，这句话可能已经不成立。 */
export type SemanticRowStatus = 'DRAFT' | 'CONFIRMED' | 'STALE';

/** 采样验证结论。P1 还没有做采样验证，所以现在推出来的行几乎全是 NONE。 */
export type SemanticVerified = 'CONFIRMED' | 'WEAK' | 'REJECTED' | 'UNDECIDABLE' | 'NONE';

/**
 * 语义层里的一条断言。
 *
 * ★ 平台**刻意不提供编辑入口**（口径的纠正走对话，不走管理台表单）。
 * 所以这个抽屉是任何人唯一一次能注意到「某条口径写错了」的机会——
 * gloss 必须和 source / evidence / verified / status 一起显示。
 * 只显示 gloss，会让一句可能已经不成立的话看起来像事实。
 */
export interface ConnectorSemanticRow {
  id: string;
  scope: SemanticScope;
  /** 对象名（表名）。METRIC / CAVEAT 是空串——口径挂在整条连接上。 */
  objectName?: string | null;
  /** 字段名。仅 FIELD / JOIN 用；JOIN 存的是左侧列名。 */
  fieldName?: string | null;
  /** 业务词条，如「销售额」。仅 METRIC / CAVEAT 用。 */
  term?: string | null;
  /** 给模型看的那一句话。 */
  gloss?: string | null;
  /**
   * 按 scope 定形的结构化细节，后端已解析（JOIN 的另一端与基数、CAVEAT 涉及的表…）。
   * 后端解析不了时为 null——只丢这一个字段，不让整张表打不开。
   */
  detail?: Record<string, unknown> | null;
  source?: SemanticSource | null;
  evidence?: SemanticEvidence | null;
  /** 0-100，仅 INFERRED 有意义。★ numbers-as-strings：比较前必须 Number()。 */
  confidence?: number | string | null;
  verified?: SemanticVerified | null;
  status?: SemanticRowStatus | null;
  anchorKind?: string | null;
  /** 在对话里回答这条口径的人。 */
  answeredBy?: string | null;
  answeredName?: string | null;
  answeredAt?: string | null;
  /** 沉淀这条口径的那次对话，可据此回到现场。 */
  traceId?: string | null;
  /**
   * 口径被覆盖的留痕（只存旧值），最近 20 条。
   * 任何能对话的人都能覆盖口径且不做权限区分，这是那个已知代价的唯一取证材料——要展示出来。
   */
  history?: unknown[] | null;
  updateTime?: string | null;
}

/** 手工重跑的返回。★ 它只代表「已派发」，不代表「已生成」——真实进度在 ConnectorView.semanticStatus 上。 */
export interface SemanticDeriveStarted {
  started: boolean;
}
