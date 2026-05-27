import { useEffect, useMemo, useState } from 'react';
import { Drawer, Form, Input, Switch, Space, Button, App, Divider, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { pluginToolApi } from '@/features/plugin/api';
import type { PluginHttpMapping, PluginTool } from '@/api/types';
import HttpMappingForm from './HttpMappingForm';

interface Props {
  open: boolean;
  pluginId: string;
  tool?: PluginTool;
  onClose: () => void;
  onSaved: () => void;
}

interface ToolFormValues {
  name: string;
  description?: string;
  enabled: boolean;
  inputSchemaJson: string;
}

const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "搜索关键词" }
  },
  "required": ["query"]
}`;

export default function ToolDrawer({ open, pluginId, tool, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ToolFormValues>();
  const [mapping, setMapping] = useState<PluginHttpMapping>({
    method: 'GET',
    urlTemplate: '',
  });

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: tool?.name ?? '',
        description: tool?.description ?? '',
        enabled: tool?.enabled ?? true,
        inputSchemaJson: JSON.stringify(tool?.inputSchema ?? JSON.parse(DEFAULT_SCHEMA), null, 2),
      });
      setMapping(
        tool?.mapping ?? {
          method: 'GET',
          urlTemplate: '',
          headersTemplate: {},
          bodyType: 'json',
        },
      );
    }
  }, [open, tool, form]);

  const inputVariables = useMemo(() => {
    try {
      const schemaJson = form.getFieldValue('inputSchemaJson') as string | undefined;
      if (!schemaJson) return [];
      const parsed = JSON.parse(schemaJson);
      return Object.keys(parsed?.properties ?? {});
    } catch {
      return [];
    }
  }, [form, mapping]);

  const saveMut = useMutation({
    mutationFn: async (values: ToolFormValues) => {
      let inputSchema: Record<string, unknown> = {};
      try {
        inputSchema = JSON.parse(values.inputSchemaJson);
      } catch {
        throw new Error('入参 schema 不是合法 JSON');
      }
      const payload = {
        name: values.name,
        description: values.description,
        enabled: values.enabled,
        inputSchema,
        mapping,
      };
      if (tool) {
        return pluginToolApi.update(pluginId, tool.id, payload);
      }
      return pluginToolApi.create(pluginId, payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      onSaved();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Drawer
      title={tool ? '编辑工具' : '新增工具'}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMut.isPending} onClick={() => form.submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => saveMut.mutate(v)}
      >
        <Form.Item label="工具名" name="name" rules={[{ required: true }]}>
          <Input placeholder="如 search_weather" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={2} placeholder="工具用途，用于 LLM 选择该工具" />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          label="入参 Schema (JSON Schema)"
          name="inputSchemaJson"
          rules={[
            {
              validator: (_, v) => {
                try {
                  JSON.parse(v);
                  return Promise.resolve();
                } catch (e) {
                  return Promise.reject((e as Error).message);
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={10} style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }} />
        </Form.Item>

        <Divider>HTTP 映射</Divider>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          配置工具实际调用的 HTTP 端点
        </Typography.Text>
        <HttpMappingForm
          value={mapping}
          onChange={setMapping}
          inputVariables={inputVariables}
        />
      </Form>
    </Drawer>
  );
}
