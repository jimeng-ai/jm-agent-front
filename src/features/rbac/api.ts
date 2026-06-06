import { get, put } from '@/api/client';

/** 可分享的资源类型，对应后端 ResourceType 实例类型。 */
export type ShareResourceType = 'AGENT' | 'PLUGIN' | 'KNOWLEDGE_BASE';

/** 角色 = 部门。 */
export interface RbacRole {
  id: string;
  name: string;
  code?: string;
}

/** 某资源的分享设置：分享到的部门(角色) id 列表 + 是否全公司可见。 */
export interface ResourceShares {
  roleIds: string[];
  tenantWide: boolean;
}

export const rbacApi = {
  /** 当前租户的角色(部门)列表，供分享弹窗勾选（成员可访问，非超管专属）。 */
  listRoles: () => get<RbacRole[]>('/admin/rbac/roles/options'),

  getShares: (type: ShareResourceType, id: string) =>
    get<ResourceShares>(`/admin/rbac/resource/${type}/${id}/shares`),

  /** 整体覆盖分享设置（部门 + 全公司开关）。 */
  setShares: (type: ShareResourceType, id: string, payload: ResourceShares) =>
    put<{ updated: boolean }>(`/admin/rbac/resource/${type}/${id}/shares`, payload),
};
