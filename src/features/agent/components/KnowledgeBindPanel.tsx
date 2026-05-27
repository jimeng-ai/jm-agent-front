import { useQuery } from '@tanstack/react-query';
import { Form, InputNumber, Select, Slider, Spin } from 'antd';
import { kbApi } from '@/features/knowledge/api';

interface Props {
  value?: { kbIds?: string[]; topK?: number; scoreThreshold?: number };
  onChange?: (v: { kbIds?: string[]; topK?: number; scoreThreshold?: number }) => void;
}

export default function KnowledgeBindPanel({ value, onChange }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['kb', 'list'],
    queryFn: kbApi.list,
  });
  if (isLoading) return <Spin />;

  const update = (patch: Partial<NonNullable<Props['value']>>) =>
    onChange?.({ ...(value ?? {}), ...patch });

  return (
    <Form layout="vertical" style={{ maxWidth: 560 }}>
      <Form.Item label="关联知识库">
        <Select
          mode="multiple"
          allowClear
          placeholder="选择要召回的知识库"
          value={value?.kbIds}
          onChange={(v) => update({ kbIds: v })}
          options={(data ?? []).map((kb) => ({ label: kb.name, value: kb.id }))}
        />
      </Form.Item>
      <Form.Item label="TopK">
        <InputNumber
          min={1}
          max={20}
          value={value?.topK ?? 5}
          onChange={(v) => update({ topK: v ?? 5 })}
        />
      </Form.Item>
      <Form.Item label={`相似度阈值 ${value?.scoreThreshold ?? 0.5}`}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={value?.scoreThreshold ?? 0.5}
          onChange={(v) => update({ scoreThreshold: v })}
        />
      </Form.Item>
    </Form>
  );
}
