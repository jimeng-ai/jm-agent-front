import { Input, Select, Space, Switch } from 'antd';
import Field from './Field';
import type { HmacForm as HmacFormValue, HmacPlacement } from '@/features/plugin/utils/authConfig';

interface Props {
  value: HmacFormValue;
  onChange: (next: HmacFormValue) => void;
}

const DEFAULT_PLACEMENT: HmacPlacement = { type: 'header', name: '' };

/** HMAC 签名：偏专家向。给足字段与提示，密钥（secret_key）在「凭证」Tab 填。 */
export default function HmacForm({ value, onChange }: Props) {
  const set = (patch: Partial<HmacFormValue>) => onChange({ ...value, ...patch });
  const setPlacement = (patch: Partial<HmacPlacement>) =>
    set({ placement: { ...value.placement, ...patch } });

  const renderAux = (key: 'timestamp_field' | 'nonce_field', label: string, nameHint: string) => {
    const cur = value[key];
    return (
      <Field label={label} hint={`可选；开启后把${label}注入到指定 header/query`}>
        <Space size={8} align="center">
          <Switch
            checked={!!cur}
            onChange={(on) => set({ [key]: on ? { ...DEFAULT_PLACEMENT } : undefined })}
          />
          {cur && (
            <>
              <Select
                value={cur.type}
                onChange={(type) => set({ [key]: { ...cur, type } })}
                style={{ width: 120 }}
                options={[
                  { label: '请求头', value: 'header' },
                  { label: 'Query', value: 'query' },
                ]}
              />
              <Input
                value={cur.name}
                onChange={(e) => set({ [key]: { ...cur, name: e.target.value } })}
                placeholder={nameHint}
                style={{ width: 180 }}
              />
            </>
          )}
        </Space>
      </Field>
    );
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <Space size={12} style={{ display: 'flex' }}>
        <Field label="签名算法">
          <Select
            value={value.algorithm}
            onChange={(algorithm) => set({ algorithm })}
            style={{ width: 180 }}
            options={[
              { label: 'HMAC_SHA256', value: 'HMAC_SHA256' },
              { label: 'HMAC_SHA1', value: 'HMAC_SHA1' },
              { label: 'MD5', value: 'MD5' },
            ]}
          />
        </Field>
        <Field label="编码">
          <Select
            value={value.encoding}
            onChange={(encoding) => set({ encoding })}
            style={{ width: 140 }}
            options={[
              { label: 'hex', value: 'hex' },
              { label: 'base64', value: 'base64' },
            ]}
          />
        </Field>
      </Space>

      <Field
        label="签名模板"
        required
        hint={
          <>
            参与签名的字符串，可用占位符 <code>{'{method}'}</code> <code>{'{path}'}</code>{' '}
            <code>{'{{env.timestamp}}'}</code> <code>{'{{env.body_sha256}}'}</code> 等。
          </>
        }
      >
        <Input.TextArea
          value={value.sign_template}
          onChange={(e) => set({ sign_template: e.target.value })}
          rows={3}
          style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}
          placeholder={'{method}\n{path}\n{{env.timestamp}}'}
        />
      </Field>

      <Field label="签名放置位置" required hint="算出的签名注入到哪个 header/query">
        <Space size={8}>
          <Select
            value={value.placement.type}
            onChange={(type) => setPlacement({ type })}
            style={{ width: 120 }}
            options={[
              { label: '请求头', value: 'header' },
              { label: 'Query', value: 'query' },
            ]}
          />
          <Input
            value={value.placement.name}
            onChange={(e) => setPlacement({ name: e.target.value })}
            placeholder="X-Sign"
            style={{ width: 200 }}
          />
        </Space>
      </Field>

      {renderAux('timestamp_field', '时间戳字段', 'X-Timestamp')}
      {renderAux('nonce_field', '随机串字段', 'X-Nonce')}

      <div style={{ fontSize: 12, color: '#999' }}>
        提示：签名密钥（secret_key）在「凭证」Tab 里填写。
      </div>
    </div>
  );
}
