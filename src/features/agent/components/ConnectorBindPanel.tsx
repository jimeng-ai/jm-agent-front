import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Space, Spin, Tag, Tooltip, Transfer, Typography } from 'antd';
import type { Key } from 'react';
import { agentApi } from '@/features/agent/api';
import { authApi } from '@/features/auth/api';
import { connectorApi } from '@/features/connector/api';
import type { ConnectorView } from '@/features/connector/types';

/**
 * 给 Agent 授权连接器。
 *
 * ★ 没有这个面板，整条链路是跑不通的：网关的授权是 fail-closed 的——
 * 无 agent_connection 绑定即无权限，Agent 调 conn_list 永远返回空集。
 *
 * 与技能绑定的两个实质差别，都在界面上体现出来了：
 * 1. **授予限企业超管**（后端 requireSuperAdmin）。授予连接 = 让这个 Agent 能以某个身份
 *    访问客户的生产系统，比绑技能重得多——技能只是「怎么调」的说明，连接才是「能不能调」。
 * 2. **要看得见风险**。未通过只读验证、或健康异常的连接器必须显眼标出来，
 *    否则超管会在不知情的情况下把一条可写的连接授权出去。
 */

interface Props {
  agentId: string;
}

const CAP_LABEL: Record<string, string> = {
  QUERY: '能查',
  DESCRIBE: '能自描述',
  INVOKE: '能调用',
  SYNC: '能同步',
  SUBSCRIBE: '能订阅',
  HEALTH: '能报状态',
};

interface Item {
  key: string;
  title: string;
  /** 非 ACTIVE 的不可勾选：绑了也用不了（网关会拒），不如在这里就挡住。 */
  disabled: boolean;
  row: ConnectorView;
}

export default function ConnectorBindPanel({ agentId }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // staleTime 与 ModuleRoute / WorkbenchSidebar / 连接器列表页保持一致（全局默认是 30s）。
  const { data: perm } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    staleTime: 60_000,
  });
  const isSuperAdmin = perm?.superAdmin === true;

  const allQuery = useQuery({
    queryKey: ['connector', 'list'],
    queryFn: connectorApi.list,
  });
  const boundQuery = useQuery({
    queryKey: ['agent', agentId, 'connections'],
    queryFn: () => agentApi.listConnections(agentId),
    enabled: !!agentId,
  });

  const grantMut = useMutation({
    mutationFn: (connectionId: string) => agentApi.grantConnection(agentId, connectionId),
  });
  const revokeMut = useMutation({
    mutationFn: (connectionId: string) => agentApi.revokeConnection(agentId, connectionId),
  });

  const onChange = async (_next: Key[], direction: 'left' | 'right', moveKeys: Key[]) => {
    try {
      if (direction === 'right') {
        await Promise.all(moveKeys.map((k) => grantMut.mutateAsync(String(k))));
      } else {
        await Promise.all(moveKeys.map((k) => revokeMut.mutateAsync(String(k))));
      }
      message.success('授权已更新');
      qc.invalidateQueries({ queryKey: ['agent', agentId, 'connections'] });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (allQuery.isLoading || boundQuery.isLoading) return <Spin />;

  const dataSource: Item[] = (allQuery.data ?? []).map((row) => ({
    key: row.id,
    title: row.displayName || row.name,
    disabled: row.status !== 'ACTIVE',
    row,
  }));
  // 后端返回的是授权关系行，取 connectionId 才能和左侧连接器 id 对上。
  const targetKeys = (boundQuery.data ?? []).map((b) => String(b.connectionId));

  // 已授权但未通过只读验证的——这是最需要被看见的一种状态。
  const riskyBound = dataSource.filter(
    (d) => targetKeys.includes(d.key) && !d.row.readonlyVerified,
  );

  return (
    <>
      <Typography.Text type="secondary">
        左侧为企业已接入的连接器，右侧为已授权给该 Agent 的。授权后 Agent 才能通过
        <Typography.Text code>conn_*</Typography.Text>
        工具访问对应系统；不授权则完全够不到（无绑定即无权限）。
      </Typography.Text>

      {!isSuperAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="仅企业超管可修改授权"
          description="授予连接意味着让该 Agent 以某个身份访问客户的生产系统，因此授予/撤销限企业超级管理员。这里可以查看当前授权情况。"
        />
      )}

      {riskyBound.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={`有 ${riskyBound.length} 条已授权的连接尚未通过只读验证`}
          description="平台未能确认这些连接的账号写不了数据。请到「数据连接」页点「测试连接」，或在数据库侧改用只读账号。"
        />
      )}

      <Transfer<Item>
        dataSource={dataSource}
        targetKeys={targetKeys}
        onChange={onChange}
        disabled={!isSuperAdmin}
        titles={['可选连接器', '已授权']}
        listStyle={{ width: 380, height: 380 }}
        style={{ marginTop: 12 }}
        render={(item) => (
          <div>
            <Space size={4} wrap>
              <span style={{ fontWeight: 500 }}>{item.title}</span>
              <Tag>{item.row.kindLabel || item.row.kind}</Tag>
              {item.row.status !== 'ACTIVE' && <Tag>已停用</Tag>}
              {!item.row.readonlyVerified && (
                <Tooltip title="平台未能确认这个连接的账号写不了数据">
                  <Tag color="orange">只读未验证</Tag>
                </Tooltip>
              )}
              {item.row.healthState === 'UNHEALTHY' && (
                <Tooltip title={item.row.healthReason || '连接异常'}>
                  <Tag color="red">异常</Tag>
                </Tooltip>
              )}
            </Space>
            <div style={{ fontSize: 12, color: '#999' }}>
              {item.row.name}
              {item.row.capabilities?.length
                ? ` · ${item.row.capabilities.map((c) => CAP_LABEL[c] ?? c).join(' / ')}`
                : ' · 未探测'}
            </div>
          </div>
        )}
      />
    </>
  );
}
