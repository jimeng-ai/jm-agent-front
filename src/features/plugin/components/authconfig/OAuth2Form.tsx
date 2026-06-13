import { Collapse, Input, InputNumber, Select } from 'antd';
import Field from './Field';
import AuthFetchTester from './AuthFetchTester';
import {
  serializeAuthConfig,
  type OAuth2Form as OAuth2FormValue,
} from '@/features/plugin/utils/authConfig';

interface Props {
  value: OAuth2FormValue;
  onChange: (next: OAuth2FormValue) => void;
  pluginId: string;
}

/** OAuth2 客户端凭证模式：填 token 地址 + scope + 凭证传递方式；client_id/secret 在凭证 Tab。 */
export default function OAuth2Form({ value, onChange, pluginId }: Props) {
  const set = (patch: Partial<OAuth2FormValue>) => onChange({ ...value, ...patch });
  return (
    <div style={{ maxWidth: 560 }}>
      <Field
        label="Token 接口地址"
        required
        hint="换取 access_token 的地址，如 https://auth.x.com/oauth/token"
      >
        <Input
          value={value.token_url}
          onChange={(e) => set({ token_url: e.target.value })}
          placeholder="https://auth.x.com/oauth/token"
        />
      </Field>
      <Field label="Scope" hint="可选，按服务商要求填，多个用空格分隔">
        <Input
          value={value.scope}
          onChange={(e) => set({ scope: e.target.value })}
          placeholder="read write"
        />
      </Field>
      <Field
        label="凭证传递方式"
        hint="client_id/secret 放进请求体，还是用 HTTP Basic 头。不确定就选请求体"
      >
        <Select
          value={value.client_auth}
          onChange={(client_auth) => set({ client_auth })}
          style={{ width: 240 }}
          options={[
            { label: '请求体 (body)', value: 'body' },
            { label: 'HTTP Basic 头', value: 'basic' },
          ]}
        />
      </Field>

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'adv',
            label: '高级（过期与缓存）',
            children: (
              <>
                <Field label="默认有效期（秒）" hint="接口未返回过期时间时使用，默认 3600">
                  <InputNumber
                    value={value.default_ttl_sec}
                    onChange={(v) => set({ default_ttl_sec: v ?? undefined })}
                    style={{ width: 200 }}
                    min={1}
                    placeholder="3600"
                  />
                </Field>
                <Field label="安全余量（秒）" hint="提前多久判定过期并重取，默认 60">
                  <InputNumber
                    value={value.safety_margin_sec}
                    onChange={(v) => set({ safety_margin_sec: v ?? undefined })}
                    style={{ width: 200 }}
                    min={0}
                    placeholder="60"
                  />
                </Field>
              </>
            ),
          },
        ]}
      />

      <div style={{ marginTop: 8 }}>
        <AuthFetchTester
          pluginId={pluginId}
          authType="OAUTH2"
          authConfig={serializeAuthConfig('OAUTH2', value)}
        />
      </div>
    </div>
  );
}
