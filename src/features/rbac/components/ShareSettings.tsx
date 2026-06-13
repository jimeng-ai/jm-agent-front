import { useEffect, useState } from 'react';
import { App, Button, Checkbox, Divider, Empty, Space, Spin, Switch } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { rbacApi, type ShareResourceType } from '../api';

interface Props {
  resourceType: ShareResourceType;
  resourceId?: string;
  /** 是否启用查询（弹窗里用 open 控制；内联页面常驻可传 true）。 */
  active?: boolean;
  /** 保存成功回调（弹窗里用于关闭）。 */
  onSaved?: () => void;
  /** 是否自带「保存」按钮（内联场景 true；弹窗用自己的 onOk 则 false）。 */
  withSaveButton?: boolean;
}

/**
 * 资源分享的内容主体：全公司可见开关 + 指定部门(角色)勾选。
 * 从 ShareModal 抽出，供弹窗与「权限与共享」内联 Tab 复用，保证逻辑单一来源。
 * 「角色 = 部门」：勾选的部门成员即可看到该资源；全公司开关对本企业所有成员可见。
 */
export default function ShareSettings({
  resourceType,
  resourceId,
  active = true,
  onSaved,
  withSaveButton = false,
}: Props) {
  const { message } = App.useApp();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [tenantWide, setTenantWide] = useState(false);

  const rolesQ = useQuery({
    queryKey: ['rbac', 'roles'],
    queryFn: rbacApi.listRoles,
    enabled: active,
  });
  const sharesQ = useQuery({
    queryKey: ['rbac', 'shares', resourceType, resourceId],
    queryFn: () => rbacApi.getShares(resourceType, resourceId as string),
    enabled: active && !!resourceId,
  });

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
      onSaved?.();
    },
    onError: (e: unknown) =>
      message.error(e instanceof Error && e.message ? e.message : '保存失败'),
  });

  if (rolesQ.isLoading || sharesQ.isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spin />
      </div>
    );
  }

  const roles = rolesQ.data ?? [];

  return (
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
      {withSaveButton && (
        <Space style={{ marginTop: 20 }}>
          <Button type="primary" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
            保存分享设置
          </Button>
        </Space>
      )}
    </>
  );
}
