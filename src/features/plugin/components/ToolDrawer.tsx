import { useEffect, useState } from 'react';
import { Drawer, Form, Input, Switch, Space, Button, App, Divider, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { pluginToolApi } from '@/features/plugin/api';
import type { PluginHttpMapping, PluginTool } from '@/api/types';
import HttpMappingForm from './HttpMappingForm';
import InputSchemaEditor from './InputSchemaEditor';
import {
  fieldsToJsonSchema,
  jsonSchemaToFields,
  type FieldDef,
} from '@/features/plugin/utils/schema';

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
}

export default function ToolDrawer({ open, pluginId, tool, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ToolFormValues>();
  const [fields, setFields] = useState<FieldDef[]>([]);
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
      });
      setFields(jsonSchemaToFields(tool?.inputSchema));
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

  const inputVariables = fields.map((f) => f.name).filter(Boolean);

  const saveMut = useMutation({
    mutationFn: async (values: ToolFormValues) => {
      const namesSeen = new Set<string>();
      for (const f of fields) {
        if (!f.name) throw new Error('存在未命名的入参字段');
        if (namesSeen.has(f.name)) throw new Error(`字段名重复：${f.name}`);
        namesSeen.add(f.name);
      }
      const payload = {
        name: values.name,
        description: values.description,
        enabled: values.enabled,
        inputSchema: fieldsToJsonSchema(fields),
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

        <Divider>入参字段</Divider>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          逐个配置工具的输入字段，将作为 LLM 调用本工具时填入的参数
        </Typography.Text>
        <InputSchemaEditor value={fields} onChange={setFields} />

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
