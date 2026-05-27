import { useState } from 'react';
import { Drawer, Form, Input, Select, Button, Space, Typography, Alert } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pluginCredApi, pluginTestApi, pluginToolApi } from '@/features/plugin/api';

interface Props {
  open: boolean;
  pluginId: string;
  onClose: () => void;
}

export default function TestPanel({ open, pluginId, onClose }: Props) {
  const [form] = Form.useForm<{ toolId: string; credentialAlias?: string; inputJson: string }>();
  const [result, setResult] = useState<unknown>(null);

  const toolsQuery = useQuery({
    queryKey: ['plugin', pluginId, 'tools'],
    queryFn: () => pluginToolApi.list(pluginId),
    enabled: open,
  });
  const credsQuery = useQuery({
    queryKey: ['plugin', pluginId, 'creds'],
    queryFn: () => pluginCredApi.list(pluginId),
    enabled: open,
  });

  const testMut = useMutation({
    mutationFn: async (v: { toolId: string; credentialAlias?: string; inputJson: string }) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(v.inputJson);
      } catch {
        throw new Error('入参 JSON 不合法');
      }
      return pluginTestApi.test(pluginId, {
        toolId: v.toolId,
        credentialAlias: v.credentialAlias,
        input,
      });
    },
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => setResult({ error: e.message }),
  });

  return (
    <Drawer title="试调用" width={720} open={open} onClose={onClose} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ inputJson: '{\n  "query": "hello"\n}' }}
        onFinish={(v) => testMut.mutate(v)}
      >
        <Form.Item label="工具" name="toolId" rules={[{ required: true }]}>
          <Select
            options={(toolsQuery.data ?? []).map((t) => ({ label: t.name, value: t.id }))}
            placeholder="选择要测试的工具"
          />
        </Form.Item>
        <Form.Item label="凭证（可选）" name="credentialAlias">
          <Select
            allowClear
            options={(credsQuery.data ?? []).map((c) => ({ label: c.alias, value: c.alias }))}
            placeholder="不选则使用默认凭证"
          />
        </Form.Item>
        <Form.Item label="入参 JSON" name="inputJson" rules={[{ required: true }]}>
          <Input.TextArea rows={6} style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }} />
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={testMut.isPending}>
            发起调用
          </Button>
        </Space>
      </Form>

      {result != null && (
        <div style={{ marginTop: 16 }}>
          <Typography.Title level={5}>调用结果</Typography.Title>
          {(result as { error?: string })?.error ? (
            <Alert type="error" message={(result as { error: string }).error} />
          ) : (
            <pre
              style={{
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRadius: 4,
                padding: 8,
                maxHeight: 400,
                overflow: 'auto',
                fontSize: 12,
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </Drawer>
  );
}
