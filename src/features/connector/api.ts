import { del, get, post, put } from '@/api/client';
import type { PageResult } from '@/api/types';
import type {
  ConnectorAuditQuery,
  ConnectorAuditRow,
  ConnectorKind,
  ConnectorStatus,
  ConnectorSchemaObject,
  ConnectorUpsert,
  ConnectorView,
  GrantScriptRequest,
  GrantScriptResult,
  PendingWriteQuery,
  PendingWriteRow,
  ConnectorSemanticRow,
  ProbeOutcome,
  SchemaSnapshotResult,
  SemanticDeriveStarted,
  SemanticRowDeleted,
} from './types';

export const connectorApi = {
  /** 类型清单 + 每种类型的表单 schema。前端渲染表单的唯一依据。 */
  kinds: () => get<ConnectorKind[]>('/admin/connectors/kinds'),
  list: () => get<ConnectorView[]>('/admin/connectors'),
  get: (id: string) => get<ConnectorView>(`/admin/connectors/${id}`),
  create: (payload: ConnectorUpsert) => post<ConnectorView>('/admin/connectors', payload),

  /**
   * 试连：按表单参数实际连一次，**不落库**。
   *
   * 跑的是和「创建并验证」同一套三步探测，所以这里过了创建就一定过。
   * 编辑态要传 id，否则后端不知道「敏感参数留空 = 沿用原值」里的「原值」是谁的。
   */
  probe: (payload: ConnectorUpsert, id?: string) =>
    post<ProbeOutcome>('/admin/connectors/probe', payload, id ? { params: { id } } : undefined),
  update: (id: string, payload: ConnectorUpsert) =>
    put<ConnectorView>(`/admin/connectors/${id}`, payload),

  /**
   * 取回已保存的凭据明文（编辑弹窗里点「眼睛」）。
   *
   * ★ **必须是单独一次请求，不能并进 `get`。** 这是整个「查看密码」功能唯一容易做错的地方：
   * 把明文塞进详情返回值里，界面上照样可以先打码再点眼睛显示，看起来一模一样——
   * 但明文在**打开弹窗的那一刻**就已经过了 HTTP、进了浏览器内存和 devtools 的 Network 面板。
   * 藏起来只发生在视觉层，泄露发生在传输层。所以明文只在用户真的点了那一下才去取。
   *
   * ★ **是 POST 不是 GET。** 后端每次调用都写一条 `admin.credential_reveal` 审计——
   * 有副作用的端点做成 GET，任何一处预取 / 重试 / 把 GET 当幂等的中间件都会凭空造出
   * 「有人查看了密码」的记录，而那张表的全部价值就在于它记的每一条都真的发生过。
   *
   * ★ **拿到的值不要写进表单、不要放进 react-query 缓存。** 只在组件内 state 里活到弹窗关闭
   * （Modal 有 destroyOnClose）。写进表单会在下一次保存时把它当成「用户新填的密码」重新加密一遍，
   * 白白多一次明文往返。
   *
   * @returns 敏感参数名 → 明文。该类型没有敏感参数时是空对象
   */
  revealCredential: (id: string) => post<Record<string, string>>(`/admin/connectors/${id}/credential`),
  /**
   * 重新探测。注意后端**不会**因探测失败返回错误状态——失败原因回填在
   * healthState / healthReason 里正常返回，所以这里拿到的永远是「现在的状态」。
   */
  test: (id: string) => post<ConnectorView>(`/admin/connectors/${id}/test`),
  // status 走 query 参数（后端 @RequestParam），不是 body；client.post 的第三参透传给 axios。
  setStatus: (id: string, status: ConnectorStatus) =>
    post<{ status: string }>(`/admin/connectors/${id}/status`, undefined, { params: { status } }),
  remove: (id: string) => del<{ deleted: boolean }>(`/admin/connectors/${id}`),

  /**
   * 使用记录。走 GET + query 参数，筛选条件能放进 URL。
   *
   * 路径是 /audit 而不是 /{id}/audit：连接维度只是最常用的一种筛选，
   * 「某个 Agent 都访问过什么」同样要能回答。
   */
  audit: (q: ConnectorAuditQuery) =>
    get<PageResult<ConnectorAuditRow>>('/admin/connectors/audit', q as Record<string, unknown>),

  /** 已缓存的结构快照。工具查的是实时结构，这里看的是上次快照——两者可能不同，界面要标出同步时间。 */
  schema: (id: string) => get<ConnectorSchemaObject[]>(`/admin/connectors/${id}/schema`),

  /**
   * 重新拉取结构并与上次比对。返回里的 diffs 才是重点：
   * 客户悄悄加了字段、删了表，挂在上面的业务口径就跟着失效，而这件事没有别的机制会发现。
   * 注意它会对客户库发 1+N 次元数据查询，所以是手动触发的。
   */
  refreshSchema: (id: string) => post<SchemaSnapshotResult>(`/admin/connectors/${id}/schema/refresh`),

  /**
   * 语义层：已生成的「说明书」全文。
   *
   * 结构快照回答「有哪些表、哪些列」，这个接口回答**「它们是什么意思」**——
   * 客户给的只读账号里全是 t_ord_mst 这样的名字，没有这一层模型就只能猜，
   * 而猜错不会报错，只会返回一个看起来很正常的错数字。
   */
  semantic: (id: string) => get<ConnectorSemanticRow[]>(`/admin/connectors/${id}/semantic`),

  /**
   * 语义层：手工重新推导。
   *
   * ★ **异步**：后端把任务扔进线程池就返回 `{started:true}`，这不代表推导完成。
   * 真实进度写在连接详情的 semanticStatus / semanticNote 上，调用方要回去刷那一行，
   * 不能拿这次返回当「已生成」。
   *
   * ★ 重跑**只覆盖机器推断的行**：后端那条 SQL 是
   * `DELETE FROM connector_semantic WHERE connector_id = ? AND source = 'INFERRED'`，
   * 人在对话里答过的口径（HUMAN）与直接采信客户库注释的（IMPORTED）一行不动。
   */
  deriveSemantic: (id: string) =>
    post<SemanticDeriveStarted>(`/admin/connectors/${id}/semantic/derive`),

  /**
   * 语义层：删掉**一行**。
   *
   * ★ **物理删除，不可恢复。** 后端走的是裸 `DELETE FROM connector_semantic`，不是逻辑删除——
   * 唯一键 `uk_connector_semantic` 不含 `deleted`，留一条软删死行会永久占住键位，
   * 同一条断言此后再也写不进去（而且报出来的是「口径正在被同时修改」这种假并发错）。
   * 所以确认框里必须把「不可恢复」说出来，不能照搬别处「删除」按钮的措辞。
   *
   * ★ **rowId 走路径参数，不是 body。** `client.ts` 的 `del<T>(url)` 只接一个 url，
   * 没有 body、也没有 params。**不要为这一个接口去改 `del` 的签名**——那个函数被所有 feature
   * 共用，为一处需求加可选参数，受影响的是整条 HTTP 层。后端因此把 rowId 设计成路径的一段。
   *
   * ★ 返回的 `removed` 是**实际删除行数**，可能是 0（重复点击、或者并发里被别人先删了）。
   * 后端对这种情况不报错，是幂等的——调用方按 0 提示「这行已经不在了」，不要当成失败。
   */
  deleteSemanticRow: (id: string, rowId: string) =>
    del<SemanticRowDeleted>(`/admin/connectors/${id}/semantic/${rowId}`),
};

/**
 * 写操作分级相关的接口。
 *
 * 单独成组而不是并进 `connectorApi`：这几个端点的语义和上面那批不是一回事——
 * 上面是「管连接」，这里是「管一次具体的写动作能不能落地」，调用方（授权面板、审批页）
 * 也和连接列表页完全不重叠。分开之后，谁在用写这条线一眼就看得出来。
 */
export const connectorWriteApi = {
  /**
   * 生成建账号 + 授权的命令。
   *
   * ★ 后端只是**生成一段文本**，平台从不拿着超级用户去客户库上执行它——
   * 那需要客户先给出一个能建账号的账号，等于把问题倒过来。这段命令是给客户 DBA 复制去跑的。
   */
  grantScript: (payload: GrantScriptRequest) =>
    post<GrantScriptResult>('/admin/connectors/grant-script', payload),

  /** 写操作审批单。走 GET + query，筛选条件能放进 URL（分享一条待办链接就有意义了）。 */
  pendingWrites: (q: PendingWriteQuery) =>
    get<PageResult<PendingWriteRow>>(
      '/admin/connectors/pending-writes',
      q as Record<string, unknown>,
    ),

  /**
   * 批准并**立即执行**。
   *
   * 返回的是决策后的那一行：注意它可能是 FAILED（批准了、但语句在客户库上跑挂了）。
   * 接口本身返回 200 只代表「审批这件事处理完了」，不代表数据改成功——调用方要看 status。
   */
  approve: (id: string) => post<PendingWriteRow>(`/admin/connectors/pending-writes/${id}/approve`),

  /** 拒绝。reason 必填：事后回看时「谁拒的」没有「为什么拒」值钱。 */
  reject: (id: string, reason: string) =>
    post<PendingWriteRow>(`/admin/connectors/pending-writes/${id}/reject`, { reason }),
};
