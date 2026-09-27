import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Skeleton, Space, Tag, Transfer, Typography } from 'antd';
import type { Key } from 'react';
import { agentApi } from '@/features/agent/api';
import { skillApi } from '@/features/skill/api';

interface Props {
  agentId: string;
}

interface SkillTransferItem {
  key: string;
  title: string;
  description: string;
  disabled?: boolean;
}

interface Outcome {
  state: 'success' | 'error';
  message?: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function SkillBindPanel({ agentId }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

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

  const dataSource = useMemo<SkillTransferItem[]>(
    () =>
      (allQuery.data ?? [])
        .filter((skill) => skill.status === 'ACTIVE')
        .map((skill) => ({
          key: String(skill.id),
          title: skill.name,
          description: skill.description || '',
          disabled: pendingIds.has(String(skill.id)),
        })),
    [allQuery.data, pendingIds],
  );
  // 后端返回的是绑定关系行(AgentSkill)，要取其中的 skillId 才能和左侧技能 id 对上。
  const targetKeys = useMemo(
    () => (boundQuery.data ?? []).map((binding) => String(binding.skillId)),
    [boundQuery.data],
  );
  const refreshErrors = [
    allQuery.isError ? errorMessage(allQuery.error, '暂时无法刷新技能列表') : null,
    boundQuery.isError ? errorMessage(boundQuery.error, '暂时无法刷新当前技能授权') : null,
  ].filter((detail): detail is string => !!detail);

  const onChange = async (_next: Key[], direction: 'left' | 'right', moveKeys: Key[]) => {
    const ids = moveKeys.map(String);
    setPendingIds((current) => new Set([...current, ...ids]));
    setOutcomes((current) => {
      const next = { ...current };
      ids.forEach((id) => delete next[id]);
      return next;
    });

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          if (direction === 'right') await bindMut.mutateAsync(id);
          else await unbindMut.mutateAsync(id);
          return { id, outcome: { state: 'success' as const } };
        } catch (error) {
          return {
            id,
            outcome: { state: 'error' as const, message: errorMessage(error, '保存失败') },
          };
        }
      }),
    );

    setPendingIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setOutcomes((current) => ({
      ...current,
      ...Object.fromEntries(results.map((result) => [result.id, result.outcome])),
    }));

    const failed = results.filter((result) => result.outcome.state === 'error');
    if (failed.length < results.length) {
      await qc.invalidateQueries({ queryKey: ['agent', agentId, 'skills'] });
    }
    if (failed.length === 0) message.success('技能授权已生效');
    else if (failed.length === results.length)
      message.error(failed[0]?.outcome.message || '保存失败');
    else message.warning(`${failed.length} 个技能保存失败，其余授权已生效`);
  };

  if ((allQuery.isLoading && !allQuery.data) || (boundQuery.isLoading && !boundQuery.data)) {
    return <Skeleton active paragraph={{ rows: 7 }} />;
  }

  if (allQuery.isError && !allQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="可用技能加载失败"
        description={errorMessage(allQuery.error, '暂时无法读取技能列表')}
        action={
          <Button size="small" aria-label="重试加载技能" onClick={() => allQuery.refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  if (boundQuery.isError && !boundQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="当前技能授权加载失败"
        description={errorMessage(boundQuery.error, '暂时无法读取当前授权')}
        action={
          <Button
            size="small"
            aria-label="重试加载当前技能授权"
            onClick={() => boundQuery.refetch()}
          >
            重试
          </Button>
        }
      />
    );
  }

  return (
    <div data-testid="agent-skill-bind-panel">
      <div className="agent-bind-intro">
        <Typography.Text strong>技能授权更改后立即生效。</Typography.Text>
        <br />
        <Typography.Text type="secondary">
          左侧仅列出已上架（ACTIVE）的技能；移到右侧后该 Agent 立即可用，不随草稿保存或发布。
        </Typography.Text>
      </div>

      {(allQuery.isError || boundQuery.isError) && (
        <Alert
          type="warning"
          showIcon
          message="后台刷新失败，当前显示上一次成功读取的授权"
          description={
            <ul className="agent-refresh-error-list">
              {refreshErrors.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          }
          action={
            <Button
              size="small"
              aria-label="重试刷新技能授权"
              onClick={() => Promise.all([allQuery.refetch(), boundQuery.refetch()])}
            >
              重试
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      <Transfer<SkillTransferItem>
        className="agent-skill-transfer"
        dataSource={dataSource}
        targetKeys={targetKeys}
        onChange={onChange}
        render={(item) => (
          <Space size={5} wrap>
            <span>{item.title}</span>
            {pendingIds.has(item.key) && <Tag color="processing">保存中</Tag>}
            {!pendingIds.has(item.key) && outcomes[item.key]?.state === 'success' && (
              <Tag color="success">已生效</Tag>
            )}
            {!pendingIds.has(item.key) && outcomes[item.key]?.state === 'error' && (
              <Tag color="error">保存失败</Tag>
            )}
          </Space>
        )}
        titles={['可选技能', '已绑定']}
        operations={['绑定', '解绑']}
        showSearch
        filterOption={(input, item) =>
          `${item.title} ${item.description}`
            .toLocaleLowerCase()
            .includes(input.toLocaleLowerCase())
        }
        locale={{ itemUnit: '项', itemsUnit: '项', searchPlaceholder: '搜索技能' }}
      />

      <div className="agent-grant-outcome" aria-live="polite" style={{ marginTop: 10 }}>
        {Object.values(outcomes).some((outcome) => outcome.state === 'error')
          ? '有技能保存失败，可再次移动重试。'
          : Object.values(outcomes).some((outcome) => outcome.state === 'success')
            ? '最新技能授权已生效。'
            : '尚未在本页修改技能授权。'}
      </div>
    </div>
  );
}
