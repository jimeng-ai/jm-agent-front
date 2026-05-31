import { useQuery } from '@tanstack/react-query';
import { Form, InputNumber, Select, Slider, Spin, Switch } from 'antd';
import { kbApi } from '@/features/knowledge/api';

export interface KbBindingValue {
  kbIds?: string[];
  topK?: number;
  scoreThreshold?: number;
  rerank?: boolean;
}

interface Props {
  value?: KbBindingValue;
  onChange?: (v: KbBindingValue) => void;
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
      <Form.Item
        label={`相似度阈值 ${value?.scoreThreshold ?? 0.5}`}
        extra="低于该相关度（rerank 精排分，0~1）的片段会被过滤，全部低于则提示未找到。仅在开启 rerank 时生效；阈值偏高可能过滤过多，建议结合检索测试调试。"
      >
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={value?.scoreThreshold ?? 0.5}
          onChange={(v) => update({ scoreThreshold: v })}
        />
      </Form.Item>
      <Form.Item
        label="Rerank 精排"
        extra="开启后对召回结果做重排序，结果更相关但更慢；关闭则按混合检索（BM25+向量）融合分排序。"
      >
        <Switch checked={value?.rerank ?? true} onChange={(v) => update({ rerank: v })} />
      </Form.Item>
    </Form>
  );
}
