import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Transfer, Typography, Spin } from 'antd';
import type { Key } from 'react';
import { agentApi } from '@/features/agent/api';
import { pluginApi } from '@/features/plugin/api';

interface Props {
  agentId: string;
}

export default function PluginBindPanel({ agentId }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const allQuery = useQuery({
    queryKey: ['plugin', 'list', 'PUBLISHED'],
    queryFn: () => pluginApi.list('PUBLISHED'),
  });
  const boundQuery = useQuery({
    queryKey: ['agent', agentId, 'plugins'],
    queryFn: () => agentApi.listPlugins(agentId),
    enabled: !!agentId,
  });

  const bindMut = useMutation({
    mutationFn: (pluginId: string) => agentApi.bindPlugin(agentId, pluginId),
  });
  const unbindMut = useMutation({
    mutationFn: (pluginId: string) => agentApi.unbindPlugin(agentId, pluginId),
  });

  const onChange = async (_next: Key[], direction: 'left' | 'right', moveKeys: Key[]) => {
    try {
      if (direction === 'right') {
        await Promise.all(moveKeys.map((k) => bindMut.mutateAsync(String(k))));
      } else {
        await Promise.all(moveKeys.map((k) => unbindMut.mutateAsync(String(k))));
      }
      message.success('绑定已更新');
      qc.invalidateQueries({ queryKey: ['agent', agentId, 'plugins'] });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (allQuery.isLoading || boundQuery.isLoading) return <Spin />;

  const dataSource = (allQuery.data ?? []).map((p) => ({
    key: p.id,
    title: p.name,
    description: p.description || p.code,
  }));
  const targetKeys = (boundQuery.data ?? []).map((p) => p.id);

  return (
    <>
      <Typography.Text type="secondary">
        左侧为可选已发布插件，右侧为已绑定到该 Agent 的插件
      </Typography.Text>
      <Transfer
        dataSource={dataSource}
        targetKeys={targetKeys}
        onChange={onChange}
        render={(item) => `${item.title}`}
        titles={['可选插件', '已绑定']}
        listStyle={{ width: 320, height: 360 }}
        style={{ marginTop: 12 }}
      />
    </>
  );
}
