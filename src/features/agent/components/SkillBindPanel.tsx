import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Transfer, Typography, Spin } from 'antd';
import type { Key } from 'react';
import { agentApi } from '@/features/agent/api';
import { skillApi } from '@/features/skill/api';

interface Props {
  agentId: string;
}

export default function SkillBindPanel({ agentId }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // 候选技能：只列 status==='ACTIVE' 的（草稿/停用的不可绑）。
  const allQuery = useQuery({
    queryKey: ['skill', 'list', 'active-candidates'],
    queryFn: () => skillApi.list(),
  });
  const boundQuery = useQuery({
    queryKey: ['agent', agentId, 'skills'],
    queryFn: () => agentApi.listSkills(agentId),
    enabled: !!agentId,
  });

  const bindMut = useMutation({
    mutationFn: (skillId: string) => agentApi.bindSkill(agentId, skillId),
  });
  const unbindMut = useMutation({
    mutationFn: (skillId: string) => agentApi.unbindSkill(agentId, skillId),
  });

  const onChange = async (_next: Key[], direction: 'left' | 'right', moveKeys: Key[]) => {
    try {
      if (direction === 'right') {
        await Promise.all(moveKeys.map((k) => bindMut.mutateAsync(String(k))));
      } else {
        await Promise.all(moveKeys.map((k) => unbindMut.mutateAsync(String(k))));
      }
      message.success('绑定已更新');
      qc.invalidateQueries({ queryKey: ['agent', agentId, 'skills'] });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (allQuery.isLoading || boundQuery.isLoading) return <Spin />;

  const dataSource = (allQuery.data ?? [])
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({
      key: String(s.id),
      title: s.name,
      description: s.description || '',
    }));
  // 后端返回的是绑定关系行(AgentSkill)，要取其中的 skillId 才能和左侧技能 id 对上。
  const targetKeys = (boundQuery.data ?? []).map((b) => String(b.skillId));

  return (
    <>
      <Typography.Text type="secondary">
        左侧为可选的已上架（ACTIVE）技能，右侧为已绑定到该 Agent 的技能
      </Typography.Text>
      <Transfer
        dataSource={dataSource}
        targetKeys={targetKeys}
        onChange={onChange}
        render={(item) => `${item.title}`}
        titles={['可选技能', '已绑定']}
        listStyle={{ width: 320, height: 360 }}
        style={{ marginTop: 12 }}
      />
    </>
  );
}
