import { del, get, post, put } from '@/api/client';
import type { Connection, ConnectionUpsert, ConnStatus } from './types';

export const connectionApi = {
  list: () => get<Connection[]>('/admin/connections'),
  get: (id: string) => get<Connection>(`/admin/connections/${id}`),
  create: (payload: ConnectionUpsert) => post<Connection>('/admin/connections', payload),
  update: (id: string, payload: ConnectionUpsert) =>
    put<Connection>(`/admin/connections/${id}`, payload),
  // status 走 query 参数（后端 @RequestParam），不是 body；client.post 的第三参透传给 axios，支持 params。
  setStatus: (id: string, status: ConnStatus) =>
    post<{ status: string }>(`/admin/connections/${id}/status`, undefined, { params: { status } }),
  remove: (id: string) => del<{ deleted: boolean }>(`/admin/connections/${id}`),
};
