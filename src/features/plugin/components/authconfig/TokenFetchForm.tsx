import { Button, Collapse, Input, InputNumber, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import Field from './Field';
import AuthFetchTester from './AuthFetchTester';
import {
  dotToJsonPath,
  jsonPathToDot,
  serializeAuthConfig,
  type TokenFetchForm as TokenFetchFormValue,
} from '@/features/plugin/utils/authConfig';

interface Props {
  value: TokenFetchFormValue;
  onChange: (next: TokenFetchFormValue) => void;
  pluginId: string;
}

/**
 * 通用「登录换 token」：配置一次换取 token 的请求 + 从响应里取 token/过期 + 注入到业务请求。
 * 「测试获取」真实调一次，点返回 JSON 里的字段即可自动填 token/过期路径，无需懂 JSONPath。
 */
export default function TokenFetchForm({ value, onChange, pluginId }: Props) {
  const set = (patch: Partial<TokenFetchFormValue>) => onChange({ ...value, ...patch });
  const setReq = (patch: Partial<TokenFetchFormValue['request']>) =>
    set({ request: { ...value.request, ...patch } });
  const setInject = (patch: Partial<TokenFetchFormValue['inject']>) =>
    set({ inject: { ...value.inject, ...patch } });

  const headers = value.request.headers;
  const setHeader = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setReq({ headers: headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h)) });
  const addHeader = () => setReq({ headers: [...headers, { key: '', value: '' }] });
  const removeHeader = (i: number) => setReq({ headers: headers.filter((_, idx) => idx !== i) });

  const bodyEditable = value.request.method !== 'GET';

  return (
    <div style={{ maxWidth: 640 }}>
      <Field label="登录接口地址" required hint="换取 token 的接口，如 https://auth.x.com/login">
        <Input
          value={value.request.url}
          onChange={(e) => setReq({ url: e.target.value })}
          placeholder="https://auth.x.com/login"
        />
      </Field>

      <Space size={12} style={{ display: 'flex' }}>
        <Field label="请求方法">
          <Select
            value={value.request.method}
            onChange={(method) => setReq({ method })}
            style={{ width: 120 }}
            options={[
              { label: 'POST', value: 'POST' },
              { label: 'GET', value: 'GET' },
              { label: 'PUT', value: 'PUT' },
            ]}
          />
        </Field>
        <Field label="Content-Type" hint="请求体格式">
          <Select
            value={value.request.content_type}
            onChange={(content_type) => setReq({ content_type })}
            style={{ width: 240 }}
            options={[
              { label: 'application/json', value: 'application/json' },
              {
                label: 'application/x-www-form-urlencoded',
                value: 'application/x-www-form-urlencoded',
              },
            ]}
          />
        </Field>
      </Space>

      <Field label="请求头" hint="可选；需要鉴权头时添加。值里可用 {{secrets.字段名}} 引用凭证。">
        {headers.map((h, i) => (
          <Space key={i} align="baseline" style={{ display: 'flex', marginBottom: 6 }}>
            <Input
              value={h.key}
              onChange={(e) => setHeader(i, { key: e.target.value })}
              placeholder="Header 名"
              style={{ width: 200 }}
            />
            <Input
              value={h.value}
              onChange={(e) => setHeader(i, { value: e.target.value })}
              placeholder="值"
              style={{ width: 260 }}
            />
            <DeleteOutlined onClick={() => removeHeader(i)} style={{ color: '#999' }} />
          </Space>
        ))}
        <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addHeader}>
          添加请求头
        </Button>
      </Field>

      {bodyEditable && (
        <Field
          label="登录参数（请求体）"
          hint={
            <>
              按接口要求填写；密钥用 <code>{'{{secrets.字段名}}'}</code> 占位，真实值在「凭证」Tab
              填。例：<code>{'{"appKey":"{{secrets.appKey}}"}'}</code>
            </>
          }
        >
          <Input.TextArea
            value={value.request.body}
            onChange={(e) => setReq({ body: e.target.value })}
            rows={3}
            style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}
            placeholder={'{"appKey":"{{secrets.appKey}}"}'}
          />
        </Field>
      )}

      <Field
        label="Token 字段路径"
        required
        hint="返回 JSON 里 token 所在位置；点下方「测试获取」的字段可自动填，也可手填如 data.token"
      >
        <Input
          value={jsonPathToDot(value.token_path)}
          onChange={(e) => set({ token_path: dotToJsonPath(e.target.value) })}
          placeholder="data.token"
        />
      </Field>

      <Space size={12} style={{ display: 'flex', alignItems: 'flex-start' }}>
        <Field label="过期字段路径" hint="可选；返回里过期时间所在位置">
          <Input
            value={jsonPathToDot(value.expire_path)}
            onChange={(e) => set({ expire_path: dotToJsonPath(e.target.value) })}
            placeholder="data.expire"
            style={{ width: 240 }}
          />
        </Field>
        <Field label="过期单位">
          <Select
            value={value.expire_unit}
            onChange={(expire_unit) => set({ expire_unit })}
            style={{ width: 120 }}
            options={[
              { label: '秒', value: 'sec' },
              { label: '毫秒', value: 'ms' },
            ]}
          />
        </Field>
      </Space>

      <Field label="注入到业务请求" hint="拿到 token 后，怎么带到真正的业务接口上">
        <Space size={8} style={{ display: 'flex' }} wrap>
          <Select
            value={value.inject.location}
            onChange={(location) => setInject({ location })}
            style={{ width: 130 }}
            options={[
              { label: '请求头', value: 'header' },
              { label: 'Query 参数', value: 'query' },
            ]}
          />
          <Input
            value={value.inject.name}
            onChange={(e) => setInject({ name: e.target.value })}
            placeholder="Authorization"
            style={{ width: 200 }}
            addonBefore="名称"
          />
          <Input
            value={value.inject.prefix}
            onChange={(e) => setInject({ prefix: e.target.value })}
            placeholder="Bearer "
            style={{ width: 180 }}
            addonBefore="前缀"
          />
        </Space>
      </Field>

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'adv',
            label: '高级',
            children: (
              <Field label="默认有效期（秒）" hint="未配置过期字段时使用，默认 3600">
                <InputNumber
                  value={value.default_ttl_sec}
                  onChange={(v) => set({ default_ttl_sec: v ?? undefined })}
                  style={{ width: 200 }}
                  min={1}
                  placeholder="3600"
                />
              </Field>
            ),
          },
        ]}
      />

      <div style={{ marginTop: 8 }}>
        <AuthFetchTester
          pluginId={pluginId}
          authType="TOKEN_FETCH"
          authConfig={serializeAuthConfig('TOKEN_FETCH', value)}
          currentTokenPath={value.token_path}
          currentExpirePath={value.expire_path}
          onPickToken={(jp) => set({ token_path: jp })}
          onPickExpire={(jp) => set({ expire_path: jp })}
        />
      </div>
    </div>
  );
}
