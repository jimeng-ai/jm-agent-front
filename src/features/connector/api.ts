import { del, get, post, put } from '@/api/client';
import type { PageResult } from '@/api/types';
import type {
  ConnectorAuditQuery,
  ConnectorAuditRow,
  ConnectorKind,
  ConnectorStatus,
  ConnectorUpsert,
  ConnectorView,
} from './types';

export const connectorApi = {
  /** 类型清单 + 每种类型的表单 schema。前端渲染表单的唯一依据。 */
  kinds: () => get<ConnectorKind[]>('/admin/connectors/kinds'),
  list: () => get<ConnectorView[]>('/admin/connectors'),
  get: (id: string) => get<ConnectorView>(`/admin/connectors/${id}`),
  create: (payload: ConnectorUpsert) => post<ConnectorView>('/admin/connectors', payload),
  update: (id: string, payload: ConnectorUpsert) =>
    put<ConnectorView>(`/admin/connectors/${id}`, payload),
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
};
