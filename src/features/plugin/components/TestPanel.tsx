import { useMemo, useState } from 'react';
import {
  App,
  Drawer,
  Form,
  Input,
  Select,
  Button,
  Space,
  Tag,
  Typography,
  Alert,
  Segmented,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pluginTestApi, pluginToolApi, type TestResult } from '@/features/plugin/api';
import { jsonSchemaToFields, isFixedField, type FieldDef } from '@/features/plugin/utils/schema';

interface Props {
  open: boolean;
  pluginId: string;
  onClose: () => void;
}

const mono: React.CSSProperties = { fontFamily: 'Menlo, monospace', fontSize: 12 };

function coerceArg(raw: string, f: FieldDef): unknown {
  switch (f.type) {
    case 'number': {
      const n = Number(raw);
      return raw.trim() !== '' && Number.isFinite(n) ? n : raw;
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : raw;
    case 'object':
    case 'array':
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

export default function TestPanel({ open, pluginId, onClose }: Props) {
  const { message } = App.useApp();
  const [toolId, setToolId] = useState<string | undefined>();
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [inputJson, setInputJson] = useState('{\n  "query": "hello"\n}');
  const [result, setResult] = useState<TestResult | null>(null);

  const toolsQuery = useQuery({
    queryKey: ['plugin', pluginId, 'tools'],
    queryFn: () => pluginToolApi.list(pluginId),
    enabled: open,
  });
  const tools = toolsQuery.data ?? [];
  const selectedTool = tools.find((t) => t.id === toolId);

  // 只展示需要用户/LLM 填写的参数；固定值参数已烤进请求，无需输入
  const paramFields = useMemo<FieldDef[]>(() => {
    if (!selectedTool) return [];
    return jsonSchemaToFields(selectedTool.inputSchema).filter((f) => f.name && !isFixedField(f));
  }, [selectedTool]);

  const buildInputFromForm = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    paramFields.forEach((f) => {
      const raw = argValues[f.name];
      if (raw === undefined || raw === '') return;
      out[f.name] = coerceArg(raw, f);
    });
    return out;
  };

  const onSelectTool = (id: string) => {
    setToolId(id);
    setArgValues({});
  };

  const switchMode = (m: 'form' | 'json') => {
    if (m === mode) return;
    if (m === 'json') {
      // 表单 → JSON：把已填的表单值序列化进 JSON，便于继续手改
      setInputJson(JSON.stringify(buildInputFromForm(), null, 2));
    } else {
      // JSON → 表单：尽量把 JSON 拆回各字段
      try {
        const parsed = JSON.parse(inputJson) as Record<string, unknown>;
        const next: Record<string, string> = {};
        Object.entries(parsed).forEach(([k, v]) => {
          next[k] = typeof v === 'string' ? v : JSON.stringify(v);
        });
        setArgValues(next);
      } catch {
        /* JSON 不合法就保持表单原样 */
      }
    }
    setMode(m);
  };

  const testMut = useMutation({
    mutationFn: async () => {
      if (!toolId) throw new Error('请选择工具');
      let input: Record<string, unknown>;
      if (mode === 'form') {
        const missing = paramFields.filter(
          (f) => f.required && !(argValues[f.name] ?? '').toString().trim(),
        );
        if (missing.length) {
          throw new Error(`缺少必填参数：${missing.map((f) => f.name).join('、')}`);
        }
        input = buildInputFromForm();
      } else {
        try {
          input = JSON.parse(inputJson);
        } catch {
          throw new Error('入参 JSON 不合法');
        }
      }
      return pluginTestApi.test(pluginId, { toolId, input });
    },
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => setResult({ error: e.message }),
  });

  return (
    <Drawer title="试调用" width={720} open={open} onClose={onClose} destroyOnClose>
      <Form layout="vertical">
        <Form.Item label="工具" required>
          <Select
            value={toolId}
            onChange={onSelectTool}
            options={tools.map((t) => ({ label: t.name, value: t.id }))}
            placeholder="选择要测试的工具"
          />
        </Form.Item>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <Typography.Text>
            入参 <span style={{ color: '#ff4d4f' }}>*</span>
          </Typography.Text>
          <Segmented
            value={mode}
            onChange={(m) => switchMode(m as 'form' | 'json')}
            options={[
              { label: '表单', value: 'form' },
              { label: 'JSON', value: 'json' },
            ]}
          />
        </div>

        {mode === 'form' ? (
          !selectedTool ? (
            <Typography.Text type="secondary">请先选择工具</Typography.Text>
          ) : paramFields.length === 0 ? (
            <Typography.Text type="secondary">该工具无需入参（或参数均为固定值）</Typography.Text>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              {paramFields.map((f) => (
                <ArgField
                  key={f.id}
                  field={f}
                  value={argValues[f.name] ?? ''}
                  onChange={(v) => setArgValues((s) => ({ ...s, [f.name]: v }))}
                />
              ))}
            </Space>
          )
        ) : (
          <Input.TextArea
            rows={8}
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            style={mono}
          />
        )}

        <Button
          type="primary"
          loading={testMut.isPending}
          onClick={() => testMut.mutate()}
          style={{ marginTop: 12 }}
        >
          发起调用
        </Button>
      </Form>

      {result != null && (
        <div style={{ marginTop: 16 }}>
          <Typography.Title level={5}>调用结果</Typography.Title>
          {result.error ? (
            <Alert type="error" message={result.error} />
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {result.curl && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      最终请求（curl）
                      {result.status != null && (
                        <Tag
                          color={result.status < 400 ? 'green' : 'red'}
                          style={{ marginLeft: 8 }}
                        >
                          HTTP {result.status}
                        </Tag>
                      )}
                    </Typography.Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard?.writeText(result.curl ?? '');
                        message.success('已复制 curl');
                      }}
                    >
                      复制
                    </Button>
                  </div>
                  <pre style={resultBox}>{result.curl}</pre>
                </div>
              )}

              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  抽取结果（返回给 Agent）
                </Typography.Text>
                <pre style={resultBox}>
                  {JSON.stringify('extracted' in result ? result.extracted : result, null, 2)}
                </pre>
              </div>

              {result.response && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#8c8c8c' }}>
                    原始响应体
                  </summary>
                  <pre style={resultBox}>{result.response}</pre>
                </details>
              )}
            </Space>
          )}
        </div>
      )}
    </Drawer>
  );
}

const resultBox: React.CSSProperties = {
  background: '#fafafa',
  border: '1px solid #f0f0f0',
  borderRadius: 4,
  padding: 8,
  maxHeight: 320,
  overflow: 'auto',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: '4px 0 0',
};

function ArgField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = (
    <span>
      {field.name}
      {field.required && <span style={{ color: '#ff4d4f' }}> *</span>}{' '}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {field.type}
        {field.description ? ` · ${field.description}` : ''}
      </Typography.Text>
    </span>
  );

  let control: React.ReactNode;
  switch (field.type) {
    case 'number':
      control = (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="请输入数字"
        />
      );
      break;
    case 'boolean':
      control = (
        <Select
          value={value || undefined}
          onChange={onChange}
          placeholder="选择 true / false"
          style={{ width: 200 }}
          options={[
            { label: 'true', value: 'true' },
            { label: 'false', value: 'false' },
          ]}
        />
      );
      break;
    case 'string':
      // 带候选值的 string → 下拉单选；否则普通文本框
      control =
        field.enumValues && field.enumValues.length > 0 ? (
          <Select
            value={value || undefined}
            onChange={onChange}
            placeholder="选择候选值"
            style={{ minWidth: 220 }}
            options={field.enumValues.map((v) => ({ label: v, value: v }))}
          />
        ) : (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.description || '请输入值'}
          />
        );
      break;
    case 'object':
    case 'array':
      control = (
        <Input.TextArea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            field.type === 'array' ? 'JSON 数组，如 ["a","b"]' : 'JSON 对象，如 {"k":"v"}'
          }
          style={mono}
        />
      );
      break;
    default:
      control = (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description || '请输入值'}
        />
      );
  }

  return (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      {control}
    </Form.Item>
  );
}
