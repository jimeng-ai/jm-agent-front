import { Drawer, Descriptions, Tag, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { skillApi } from '@/features/skill/api';

interface Props {
  id: string | null;
  onClose: () => void;
}

const SCOPE_LABEL: Record<string, string> = { PRIVATE: '私有', TENANT: '团队共享' };
const SCOPE_COLOR: Record<string, string> = { PRIVATE: 'default', TENANT: 'blue' };
const TYPE_LABEL: Record<string, string> = { PROMPT: 'Prompt', DOER: 'Doer' };
const TYPE_COLOR: Record<string, string> = { PROMPT: 'purple', DOER: 'orange' };
const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', ACTIVE: '启用', DISABLED: '停用' };
const STATUS_COLOR: Record<string, string> = { DRAFT: 'default', ACTIVE: 'green', DISABLED: 'red' };
const SOURCE_LABEL: Record<string, string> = { UPLOAD: '上传', MARKET: '市场', AI_GEN: 'AI 生成' };

export default function SkillDetailDrawer({ id, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'detail', id],
    queryFn: () => skillApi.get(id!),
    enabled: !!id,
  });

  return (
    <Drawer title="Skill 详情" open={!!id} onClose={onClose} width={480}>
      {isLoading ? (
        <Spin />
      ) : data ? (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="名称">{data.name}</Descriptions.Item>
          <Descriptions.Item label="描述">{data.description || '—'}</Descriptions.Item>
          <Descriptions.Item label="类型">
            <Tag color={TYPE_COLOR[data.skillType]}>
              {TYPE_LABEL[data.skillType] ?? data.skillType}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="范围">
            <Tag color={SCOPE_COLOR[data.scope]}>{SCOPE_LABEL[data.scope] ?? data.scope}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="来源">
            {SOURCE_LABEL[data.source] ?? data.source}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS_COLOR[data.status]}>{STATUS_LABEL[data.status] ?? data.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="版本">{data.version}</Descriptions.Item>
          <Descriptions.Item label="所有人 ID">{data.ownerUserId}</Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
