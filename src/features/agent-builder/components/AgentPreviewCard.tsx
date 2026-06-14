import { Button, Card, Checkbox, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getModelCatalog } from '@/features/agent/api';
import { pluginApi } from '@/features/plugin/api';
import { kbApi } from '@/features/knowledge/api';
import type { BuilderDraft } from '../api';

const { Paragraph, Text } = Typography;

interface Props {
  draft: BuilderDraft;
  /** 用户在预览里手改字段（受控）。 */
  onChange: (patch: Partial<BuilderDraft>) => void;
  selectedPluginIds: number[];
  selectedKbIds: number[];
  onPluginToggle: (ids: number[]) => void;
  onKbToggle: (ids: number[]) => void;
  onCreate: () => void;
  creating: boolean;
}

export default function AgentPreviewCard(props: Props) {
  const {
    draft,
    onChange,
    selectedPluginIds,
    selectedKbIds,
    onPluginToggle,
    onKbToggle,
    onCreate,
    creating,
  } = props;

  const modelsQuery = useQuery({ queryKey: ['models', 'catalog'], queryFn: getModelCatalog });
  const pluginsQuery = useQuery({
    queryKey: ['plugin', 'list', 'PUBLISHED'],
    queryFn: () => pluginApi.list('PUBLISHED'),
  });
  const kbsQuery = useQuery({ queryKey: ['kb', 'list'], queryFn: () => kbApi.list() });

  const canCreate = !!draft.name?.trim() && !!draft.systemPrompt?.trim();

  return (
    <Card
      title="实时预览"
      extra={<Tag color="blue">草稿</Tag>}
      style={{ height: '100%', overflow: 'auto' }}
    >
      <Form layout="vertical">
        <Form.Item label="名称" required>
          <Input
            value={draft.name}
            placeholder="（待生成）"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="描述">
          <Input
            value={draft.description}
            placeholder="（待生成）"
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="人设 / 系统提示词" required>
          <Input.TextArea
            rows={6}
            value={draft.systemPrompt}
            placeholder="（待生成）"
            onChange={(e) => onChange({ systemPrompt: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="模型">
          <Select
            value={draft.model}
            placeholder="（待生成）"
            options={modelsQuery.data ?? []}
            onChange={(v) => onChange({ model: v })}
          />
        </Form.Item>

        {!!draft.presetQuestions?.length && (
          <Form.Item label="预设引导问题">
            <Space direction="vertical" style={{ width: '100%' }}>
              {draft.presetQuestions.map((q, i) => (
                <Text key={i} code>
                  {q}
                </Text>
              ))}
            </Space>
          </Form.Item>
        )}

        <Form.Item label="推荐插件（勾选后将绑定）">
          <Checkbox.Group
            value={selectedPluginIds}
            onChange={(v) => onPluginToggle(v as number[])}
            options={(pluginsQuery.data ?? []).map((p) => ({ label: p.name, value: Number(p.id) }))}
          />
        </Form.Item>
        <Form.Item label="推荐知识库（勾选后将绑定）">
          <Checkbox.Group
            value={selectedKbIds}
            onChange={(v) => onKbToggle(v as number[])}
            options={(kbsQuery.data ?? []).map((k) => ({ label: k.name, value: Number(k.id) }))}
          />
        </Form.Item>
      </Form>

      <Button type="primary" block disabled={!canCreate} loading={creating} onClick={onCreate}>
        创建 Agent
      </Button>
      {!canCreate && (
        <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
          需先生成「名称」和「人设」才能创建
        </Paragraph>
      )}
    </Card>
  );
}
