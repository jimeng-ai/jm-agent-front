import { Input, Select } from 'antd';
import Field from './Field';
import type { ApiKeyForm as ApiKeyFormValue } from '@/features/plugin/utils/authConfig';

interface Props {
  value: ApiKeyFormValue;
  onChange: (next: ApiKeyFormValue) => void;
}

/** API Key：把 key 放在请求头还是 query，以及字段名。Key 的值在「凭证」Tab 填。 */
export default function ApiKeyForm({ value, onChange }: Props) {
  const set = (patch: Partial<ApiKeyFormValue>) => onChange({ ...value, ...patch });
  return (
    <div style={{ maxWidth: 480 }}>
      <Field label="放在哪里" hint="API Key 作为请求头，还是拼到 URL 的 query 参数">
        <Select
          value={value.location}
          onChange={(location) => set({ location })}
          style={{ width: 200 }}
          options={[
            { label: '请求头 (header)', value: 'header' },
            { label: 'Query 参数', value: 'query' },
          ]}
        />
      </Field>
      <Field label="字段名" required hint="如 X-API-Key、apikey">
        <Input
          value={value.key_name}
          onChange={(e) => set({ key_name: e.target.value })}
          placeholder="X-API-Key"
        />
      </Field>
      <div style={{ fontSize: 12, color: '#999' }}>
        提示：Key 的实际值在「凭证」Tab 里填写（字段名 value）。
      </div>
    </div>
  );
}
