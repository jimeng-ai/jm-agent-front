import { useEffect, useState } from 'react';
import { App, Checkbox, Divider, Empty, Modal, Spin, Switch } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { rbacApi, type ShareResourceType } from '../api';

interface ShareModalProps {
  open: boolean;
  resourceType: ShareResourceType;
  resourceId?: string;
  resourceName?: string;
  onClose: () => void;
}

/**
 * 资源分享弹窗：把某个 Agent / 插件 / 知识库分享给指定部门(角色)或设为全公司可见。
 * 「角色 = 部门」：勾选的部门成员即可看到该资源；全公司开关对本企业所有成员(含未来新增部门)可见。
 */
export default function ShareModal({
  open,
  resourceType,
  resourceId,
  resourceName,
  onClose,
}: ShareModalProps) {
  const { message } = App.useApp();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [tenantWide, setTenantWide] = useState(false);

  const rolesQ = useQuery({
    queryKey: ['rbac', 'roles'],
    queryFn: rbacApi.listRoles,
    enabled: open,
  });
  const sharesQ = useQuery({
    queryKey: ['rbac', 'shares', resourceType, resourceId],
    queryFn: () => rbacApi.getShares(resourceType, resourceId as string),
    enabled: open && !!resourceId,
  });

  // 拉到当前分享设置后回填到本地编辑态
  useEffect(() => {
    if (sharesQ.data) {
      setRoleIds(sharesQ.data.roleIds ?? []);
      setTenantWide(!!sharesQ.data.tenantWide);
    }
  }, [sharesQ.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      rbacApi.setShares(resourceType, resourceId as string, { roleIds, tenantWide }),
    onSuccess: () => {
      message.success('分享设置已保存');
      onClose();
    },
    onError: (e: unknown) =>
      message.error(e instanceof Error && e.message ? e.message : '保存失败'),
  });

  const loading = rolesQ.isLoading || sharesQ.isLoading;
  const roles = rolesQ.data ?? [];

  return (
    <Modal
      title={`分享${resourceName ? `「${resourceName}」` : ''}`}
      open={open}
      onCancel={onClose}
      onOk={() => saveMut.mutate()}
      confirmLoading={saveMut.isPending}
      okText="保存"
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>全公司可见</span>
            <Switch checked={tenantWide} onChange={setTenantWide} />
          </div>
          <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
            开启后本企业所有成员（含未来新增部门）都能看到
          </div>
          <Divider style={{ margin: '16px 0' }}>或指定部门可见</Divider>
          {roles.length === 0 ? (
            <Empty description="暂无部门（角色）" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Checkbox.Group
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              value={roleIds}
              onChange={(v) => setRoleIds(v as string[])}
              options={roles.map((r) => ({ label: r.name, value: r.id }))}
            />
          )}
        </>
      )}
    </Modal>
  );
}
