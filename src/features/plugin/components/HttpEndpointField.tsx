import { Input, Select, Space, Tag, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import type { HttpMethod } from '@/api/types';
import type { FieldDef } from '@/features/plugin/utils/schema';
import type { HttpForm } from '@/features/plugin/utils/mapping';

interface Props {
  value: HttpForm;
  onChange: (v: HttpForm) => void;
  /** 入参字段（含位置），用于 Path 变量提示与未定义变量校验 */
  fields: FieldDef[];
  /** 插件基础信息里的 Base URL，工具只写路径时用它补全域名 */
  baseUrl?: string;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const PH = /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g;
function shortVars(tpl: string): string[] {
  return Array.from(tpl.matchAll(PH)).map((m) => m[1]);
}

/**
 * 请求方法 + 接口路径（含 Path 变量提示与变量校验）。
 * 独立成块，置于工具编辑表单顶部——先定义端点，再配置入参。
 */
export default function HttpEndpointField({ value: v, onChange, fields, baseUrl }: Props) {
  const update = (patch: Partial<HttpForm>) => onChange({ ...v, ...patch });

  const inputNames = useMemo(() => fields.map((f) => f.name).filter(Boolean), [fields]);
  const pathFields = fields.filter((f) => f.name && f.location === 'path');

  // 只写了相对路径却没配 baseUrl → 运行时无域名会失败，提示一下
  const urlIsAbsolute = /^https?:\/\//i.test((v.urlTemplate || '').trim());
  const missingBaseUrl = !!v.urlTemplate && !urlIsAbsolute && !(baseUrl ?? '').trim();

  // 未声明变量校验（仅 URL + header 值里手写的 {{x}}；query/body 自动拼装无需手写）
  const usedVars = [
    ...shortVars(v.urlTemplate || ''),
    ...v.headers.flatMap((h) => shortVars(h.value || '')),
  ];
  const undefinedVars = [...new Set(usedVars)].filter((x) => !inputNames.includes(x));

  return (
    <div style={{ marginBottom: 16 }}>
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
            <InfoCircleOutlined /> 基础信息里未配置 Base URL，请去「基础信息」填写域名，或在此填完整
            URL。
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
    </div>
  );
}
