import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, InputNumber, Select, Skeleton, Slider, Switch } from 'antd';
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
  const query = useQuery({
    queryKey: ['kb', 'list'],
    queryFn: kbApi.list,
  });
  if (query.isLoading && !query.data) return <Skeleton active paragraph={{ rows: 4 }} />;

  if (query.isError && !query.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="知识库列表加载失败"
        description={query.error instanceof Error ? query.error.message : '暂时无法读取知识库'}
        action={
          <Button size="small" aria-label="重试加载知识库" onClick={() => query.refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  const update = (patch: Partial<NonNullable<Props['value']>>) =>
    onChange?.({ ...(value ?? {}), ...patch });

  return (
    <div style={{ maxWidth: 560 }} data-testid="agent-knowledge-bind-panel">
      {query.isError && query.data && (
        <Alert
          type="warning"
          showIcon
          message="知识库列表后台刷新失败，当前显示上一次成功读取的内容"
          description={query.error instanceof Error ? query.error.message : '暂时无法刷新知识库'}
          action={
            <Button size="small" aria-label="重试刷新知识库" onClick={() => query.refetch()}>
              重试
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Form.Item label="关联知识库">
        <Select
          mode="multiple"
          allowClear
          aria-label="关联知识库"
          placeholder="选择要召回的知识库"
          value={value?.kbIds}
          onChange={(v) => update({ kbIds: v })}
          options={(query.data ?? []).map((kb) => ({ label: kb.name, value: kb.id }))}
        />
      </Form.Item>
      <Form.Item label="TopK">
        <InputNumber
          aria-label="知识库召回数量 TopK"
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
          aria-label="知识库相似度阈值"
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
        <Switch
          aria-label="启用 Rerank 精排"
          checked={value?.rerank ?? true}
          onChange={(v) => update({ rerank: v })}
        />
      </Form.Item>
    </div>
  );
}
