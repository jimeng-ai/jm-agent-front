import { Form, Input, Select, Tabs, Button, Space, Tag, Typography, AutoComplete } from 'antd';
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import type { HttpMethod } from '@/api/types';
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
  /** 入参字段（含位置），用于 Query/Body 派生与请求预览 */
  fields: FieldDef[];
  /** 插件基础信息里的 Base URL，工具只写路径时用它补全域名 */
  baseUrl?: string;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const PH = /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g;
function shortVars(tpl: string): string[] {
  return Array.from(tpl.matchAll(PH)).map((m) => m[1]);
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

  const inputNames = useMemo(() => fields.map((f) => f.name).filter(Boolean), [fields]);
  const pathFields = fields.filter((f) => f.name && f.location === 'path');
  const bodyFields = fields.filter((f) => f.name && f.location === 'body');
  const noBody = v.method === 'GET' || v.method === 'DELETE';

  const preview = buildPreview(fields, v, baseUrl);
  // 只写了相对路径却没配 baseUrl → 运行时无域名会失败，提示一下
  const urlIsAbsolute = /^https?:\/\//i.test((v.urlTemplate || '').trim());
  const missingBaseUrl = !!v.urlTemplate && !urlIsAbsolute && !(baseUrl ?? '').trim();

  // 未声明变量校验（仅 URL + header 值里手写的 {{x}}；query/body 自动拼装无需手写）
  const usedVars = [
    ...shortVars(v.urlTemplate || ''),
    ...v.headers.flatMap((h) => shortVars(h.value || '')),
  ];
  const undefinedVars = [...new Set(usedVars)].filter((x) => !inputNames.includes(x));

  const setHeader = (idx: number, patch: Partial<HeaderRow>) =>
    update({ headers: v.headers.map((h, i) => (i === idx ? { ...h, ...patch } : h)) });
  const addHeader = (row?: HeaderRow) =>
    update({ headers: [...v.headers, row ?? { key: '', value: '' }] });
  const removeHeader = (idx: number) =>
    update({ headers: v.headers.filter((_, i) => i !== idx) });

  return (
    <Form layout="vertical">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        <InfoCircleOutlined /> 这里配置工具被调用时实际发出的 HTTP 请求。<b>只需填接口路径</b>（如{' '}
        <code>/simpleWeather/query</code>），域名取自「基础信息」里的 Base URL。上方「入参字段」会按各自的
        传入方法自动拼进来：<b>query_param</b> 拼成 <code>?a=..&amp;b=..</code>、<b>body_param</b>{' '}
        拼进请求体、<b>path_param</b> 替换路径里的 <code>{'{{变量}}'}</code>。
      </Typography.Paragraph>
      <Space.Compact style={{ width: '100%' }}>
        <Select<HttpMethod>
          value={v.method}
          onChange={(m) => update({ method: m })}
          options={METHODS.map((m) => ({ label: m, value: m }))}
          style={{ width: 110 }}
        />
        <Input
          value={v.urlTemplate}
          onChange={(e) => update({ urlTemplate: e.target.value })}
          placeholder="接口路径，如 /simpleWeather/query（域名取自基础信息 Base URL；也可填完整 URL）"
        />
      </Space.Compact>
      {missingBaseUrl && (
        <div style={{ marginTop: 4 }}>
          <Typography.Text type="warning">
            <InfoCircleOutlined /> 基础信息里未配置 Base URL，请去「基础信息」填写域名，或在此填完整 URL。
          </Typography.Text>
        </div>
      )}

      {pathFields.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Space size={[4, 4]} wrap>
            <Typography.Text type="secondary">Path 变量：</Typography.Text>
            {pathFields.map((f) => (
              <Tag
                key={f.id}
                style={{ cursor: 'pointer' }}
                onClick={() => update({ urlTemplate: (v.urlTemplate || '') + `{{${f.name}}}` })}
              >
                {f.name}
              </Tag>
            ))}
          </Space>
        </div>
      )}
      {undefinedVars.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <Typography.Text type="warning">
            <InfoCircleOutlined /> 未在入参中定义的变量：{undefinedVars.join(', ')}
          </Typography.Text>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          background: '#f6f8fa',
          border: '1px solid #eee',
          borderRadius: 6,
          padding: '8px 12px',
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          请求预览
        </Typography.Text>
        <pre style={codeBox}>
          {preview.line}
          {preview.body ? `\nbody: ${preview.body}` : ''}
        </pre>
      </div>

      <Tabs
        style={{ marginTop: 16 }}
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
              <OutputParamsEditor
                value={v.outputs}
                onChange={(outputs) => update({ outputs })}
              />
            ),
          },
        ]}
      />
    </Form>
  );
}
