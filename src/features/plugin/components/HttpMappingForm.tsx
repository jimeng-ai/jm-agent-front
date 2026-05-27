import { Form, Input, Select, Tabs, Button, Space, Tag, Typography, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import type { HttpMethod, PluginHttpMapping } from '@/api/types';
import JsonPathPreview from './JsonPathPreview';

interface Props {
  value?: PluginHttpMapping;
  onChange?: (v: PluginHttpMapping) => void;
  /** 工具入参 schema 的字段名集合，用于变量校验 */
  inputVariables?: string[];
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

function extractVars(template: string): string[] {
  return Array.from(template.matchAll(/\{\{(\w+)\}\}/g)).map((m) => m[1]);
}

export default function HttpMappingForm({ value, onChange, inputVariables = [] }: Props) {
  const v: PluginHttpMapping = {
    method: 'GET',
    urlTemplate: '',
    headersTemplate: {},
    bodyType: 'json',
    bodyTemplate: '',
    responseExtract: '',
    ...value,
  };

  const update = (patch: Partial<PluginHttpMapping>) => onChange?.({ ...v, ...patch });
  const headers = useMemo(
    () => Object.entries(v.headersTemplate || {}),
    [v.headersTemplate],
  );

  const updateHeader = (idx: number, key: string, val: string) => {
    const next = [...headers];
    next[idx] = [key, val];
    update({ headersTemplate: Object.fromEntries(next.filter(([k]) => k)) });
  };
  const removeHeader = (idx: number) => {
    const next = headers.filter((_, i) => i !== idx);
    update({ headersTemplate: Object.fromEntries(next) });
  };
  const addHeader = () => {
    update({ headersTemplate: { ...v.headersTemplate, '': '' } });
  };

  const allVars = [
    ...extractVars(v.urlTemplate || ''),
    ...Object.values(v.headersTemplate || {}).flatMap(extractVars),
    ...extractVars(v.bodyTemplate || ''),
  ];
  const undefinedVars = [...new Set(allVars)].filter((x) => !inputVariables.includes(x));

  return (
    <Form layout="vertical">
      <Space.Compact style={{ width: '100%' }}>
        <Select
          value={v.method}
          onChange={(m) => update({ method: m })}
          options={METHODS.map((m) => ({ label: m, value: m }))}
          style={{ width: 110 }}
        />
        <Input
          value={v.urlTemplate}
          onChange={(e) => update({ urlTemplate: e.target.value })}
          placeholder="URL 模板，支持 {{varName}}"
        />
      </Space.Compact>

      <div style={{ marginTop: 8 }}>
        {inputVariables.length > 0 && (
          <Space size={[4, 4]} wrap>
            <Typography.Text type="secondary">可用变量：</Typography.Text>
            {inputVariables.map((vv) => (
              <Tag
                key={vv}
                style={{ cursor: 'pointer' }}
                onClick={() => update({ urlTemplate: (v.urlTemplate || '') + `{{${vv}}}` })}
              >
                {vv}
              </Tag>
            ))}
          </Space>
        )}
        {undefinedVars.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="warning">
              <InfoCircleOutlined /> 未在入参 schema 中定义的变量：{undefinedVars.join(', ')}
            </Typography.Text>
          </div>
        )}
      </div>

      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'headers',
            label: 'Headers',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {headers.map(([k, val], idx) => (
                  <Space.Compact key={idx} style={{ width: '100%' }}>
                    <Input
                      placeholder="Key"
                      value={k}
                      onChange={(e) => updateHeader(idx, e.target.value, val)}
                      style={{ width: 200 }}
                    />
                    <Input
                      placeholder="Value（可含 {{var}}）"
                      value={val}
                      onChange={(e) => updateHeader(idx, k, e.target.value)}
                    />
                    <Button icon={<DeleteOutlined />} onClick={() => removeHeader(idx)} />
                  </Space.Compact>
                ))}
                <Button icon={<PlusOutlined />} onClick={addHeader} block>
                  添加 Header
                </Button>
              </Space>
            ),
          },
          {
            key: 'body',
            label: 'Body',
            disabled: v.method === 'GET' || v.method === 'DELETE',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  value={v.bodyType}
                  onChange={(t) => update({ bodyType: t })}
                  options={[
                    { label: 'raw JSON', value: 'json' },
                    { label: 'form-data', value: 'form' },
                    { label: 'urlencoded', value: 'urlencoded' },
                  ]}
                  style={{ width: 160 }}
                />
                <Input.TextArea
                  rows={8}
                  value={v.bodyTemplate}
                  onChange={(e) => update({ bodyTemplate: e.target.value })}
                  placeholder='例如 {"q": "{{query}}"}'
                />
              </Space>
            ),
          },
          {
            key: 'extract',
            label: '响应抽取',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  value={v.responseExtract}
                  onChange={(e) => update({ responseExtract: e.target.value })}
                  placeholder="JSONPath：如 $.data.items[*].name"
                  prefix="JSONPath:"
                />
                <Typography.Text type="secondary">
                  <Tooltip title="抽取规则用于从原始响应中提取关键字段返回给 Agent">
                    <InfoCircleOutlined /> 抽取说明
                  </Tooltip>
                </Typography.Text>
                <JsonPathPreview />
              </Space>
            ),
          },
        ]}
      />
    </Form>
  );
}
