import { Form, Select, Tabs, Button, Space, Tag, Typography, AutoComplete } from 'antd';
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { FieldDef } from '@/features/plugin/utils/schema';
import {
  type HttpForm,
  type HeaderRow,
  buildPreview,
  BODY_TYPE_OPTIONS,
  COMMON_HEADER_KEYS,
  COMMON_HEADER_VALUES,
  COMMON_HEADER_PRESETS,
} from '@/features/plugin/utils/mapping';
import OutputParamsEditor from './OutputParamsEditor';

interface Props {
  value: HttpForm;
  onChange: (v: HttpForm) => void;
  /** 入参字段（含位置），用于 Body 派生与生成预览 */
  fields: FieldDef[];
  /** 插件基础信息里的 Base URL，工具只写路径时用它补全域名 */
  baseUrl?: string;
}

const codeBox: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontFamily: 'Menlo, monospace',
};

export default function HttpMappingForm({ value: v, onChange, fields, baseUrl }: Props) {
  const update = (patch: Partial<HttpForm>) => onChange({ ...v, ...patch });

  const bodyFields = fields.filter((f) => f.name && f.location === 'body');
  const noBody = v.method === 'GET' || v.method === 'DELETE';

  const preview = buildPreview(fields, v, baseUrl);

  const setHeader = (idx: number, patch: Partial<HeaderRow>) =>
    update({ headers: v.headers.map((h, i) => (i === idx ? { ...h, ...patch } : h)) });
  const addHeader = (row?: HeaderRow) =>
    update({ headers: [...v.headers, row ?? { key: '', value: '' }] });
  const removeHeader = (idx: number) => update({ headers: v.headers.filter((_, i) => i !== idx) });

  return (
    <Form layout="vertical">
      <Tabs
        items={[
          {
            key: 'headers',
            label: 'Headers',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space size={[4, 4]} wrap>
                  <Typography.Text type="secondary">快捷添加：</Typography.Text>
                  {COMMON_HEADER_PRESETS.map((p) => (
                    <Tag
                      key={p.label}
                      color="blue"
                      style={{ cursor: 'pointer' }}
                      onClick={() => addHeader(p.row)}
                    >
                      + {p.label}
                    </Tag>
                  ))}
                </Space>
                {v.headers.map((h, idx) => (
                  <Space.Compact key={idx} style={{ width: '100%' }}>
                    <AutoComplete
                      style={{ width: 240 }}
                      value={h.key}
                      onChange={(val) => setHeader(idx, { key: val })}
                      options={COMMON_HEADER_KEYS.map((k) => ({ value: k }))}
                      filterOption={(input, opt) =>
                        String(opt?.value ?? '')
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      placeholder="Header 名"
                    />
                    <AutoComplete
                      style={{ width: '100%' }}
                      value={h.value}
                      onChange={(val) => setHeader(idx, { value: val })}
                      options={(COMMON_HEADER_VALUES[h.key.trim()] ?? []).map((val) => ({
                        value: val,
                      }))}
                      placeholder="Header 值（可含 {{var}}）"
                    />
                    <Button icon={<DeleteOutlined />} onClick={() => removeHeader(idx)} />
                  </Space.Compact>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => addHeader()} block type="dashed">
                  添加 Header
                </Button>
              </Space>
            ),
          },
          {
            key: 'body',
            label: 'Body',
            disabled: noBody,
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <Typography.Text type="secondary">Body 类型</Typography.Text>
                  <Select
                    value={v.bodyContentType}
                    onChange={(t) => update({ bodyContentType: t })}
                    options={BODY_TYPE_OPTIONS}
                    style={{ width: 300 }}
                  />
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <InfoCircleOutlined /> Body 参数请在上方「入参字段」里把位置设为 <b>Body</b>
                  ，系统会按类型自动拼装；下方为生成预览。
                </Typography.Text>
                {bodyFields.length > 0 && preview.body ? (
                  <pre style={codeBox}>{preview.body}</pre>
                ) : (
                  <Typography.Text type="secondary">（暂无 Body 参数）</Typography.Text>
                )}
              </Space>
            ),
          },
          {
            key: 'extract',
            label: '输出参数',
            children: (
              <OutputParamsEditor value={v.outputs} onChange={(outputs) => update({ outputs })} />
            ),
          },
        ]}
      />
    </Form>
  );
}
