import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Form, Input, Space, Spin, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { pluginCredApi } from '@/features/plugin/api';
import type { PluginAuthType } from '@/api/types';

interface FieldSpec {
  name: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

const FIELDS_BY_TYPE: Partial<Record<PluginAuthType, FieldSpec[]>> = {
  BEARER: [{ name: 'token', label: 'Token', secret: true, placeholder: 'Bearer Token 字符串' }],
  BASIC: [
    { name: 'username', label: '用户名', placeholder: '用户名' },
    { name: 'password', label: '密码', secret: true, placeholder: '密码' },
  ],
  API_KEY: [
    {
      name: 'value',
      label: 'API Key',
      secret: true,
      placeholder: 'Key 字符串（header/query 位置在插件 auth_config 配置）',
    },
  ],
  HMAC: [{ name: 'secret_key', label: 'Secret Key', secret: true, placeholder: '签名密钥' }],
  OAUTH2: [
    { name: 'client_id', label: 'Client ID', placeholder: 'OAuth2 client_id' },
    {
      name: 'client_secret',
      label: 'Client Secret',
      secret: true,
      placeholder: 'OAuth2 client_secret',
    },
  ],
};

interface Props {
  pluginId: string;
  authType?: PluginAuthType;
}

export default function CredentialPanel({ pluginId, authType }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<Record<string, string>>();

  const fields = authType ? FIELDS_BY_TYPE[authType] : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['plugin', pluginId, 'credential'],
    queryFn: () => pluginCredApi.get(pluginId),
    enabled: !!fields,
  });

  useEffect(() => {
    if (!fields) return;
    const next: Record<string, string> = {};
    const json = data?.credentialJson ?? {};
    fields.forEach((f) => {
      const v = json[f.name];
      next[f.name] = typeof v === 'string' ? v : v == null ? '' : String(v);
    });
    form.setFieldsValue(next);
  }, [data, fields, form]);

  const saveMut = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const credentialJson: Record<string, string> = {};
      (fields ?? []).forEach((f) => {
        const v = values[f.name];
        if (v !== undefined && v !== '') credentialJson[f.name] = v;
      });
      return pluginCredApi.save(pluginId, { credentialJson });
    },
    onSuccess: () => {
      message.success('保存成功');
      qc.invalidateQueries({ queryKey: ['plugin', pluginId, 'credential'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  if (!authType || authType === 'NONE') {
    return (
      <Alert
        type="info"
        showIcon
        message="该插件未启用鉴权"
        description="如果需要鉴权，先到「基础信息」Tab 选择认证方式。"
      />
    );
  }

  // 通用 Token 获取：密钥键名由用户自定义（token 请求模板里 {{secrets.x}} 引用），用自由 key-value 编辑器
  if (authType === 'TOKEN_FETCH') {
    return <KvCredentialEditor pluginId={pluginId} />;
  }

  if (!fields) {
    return <Empty description={`未知的认证类型: ${authType}`} />;
  }

  if (isLoading) return <Spin />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>凭证</h4>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saveMut.isPending}
          onClick={() => form.submit()}
        >
          保存
        </Button>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        当前认证方式：<b>{authType}</b>。每个插件在租户内只允许配置一份凭证。
      </Typography.Paragraph>

      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 480 }}
        onFinish={(v) => saveMut.mutate(v)}
      >
        {fields.map((f) => (
          <Form.Item key={f.name} label={f.label} name={f.name}>
            {f.secret ? (
              <Input.Password placeholder={f.placeholder} visibilityToggle />
            ) : (
              <Input placeholder={f.placeholder} />
            )}
          </Form.Item>
        ))}
      </Form>
    </div>
  );
}

/**
 * TOKEN_FETCH 专用：自由 key-value 凭证编辑器。
 * 键名由用户自定义（与 auth_config 的 token_request body 里 {{secrets.x}} 对应），值统一密文输入。
 */
function KvCredentialEditor({ pluginId }: { pluginId: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<{ rows: { key: string; value: string }[] }>();

  const { data, isLoading } = useQuery({
    queryKey: ['plugin', pluginId, 'credential'],
    queryFn: () => pluginCredApi.get(pluginId),
  });

  useEffect(() => {
    const json = data?.credentialJson ?? {};
    const rows = Object.entries(json).map(([key, v]) => ({
      key,
      value: typeof v === 'string' ? v : v == null ? '' : String(v),
    }));
    form.setFieldsValue({ rows });
  }, [data, form]);

  const saveMut = useMutation({
    mutationFn: async (values: { rows?: { key: string; value: string }[] }) => {
      const credentialJson: Record<string, string> = {};
      (values.rows ?? []).forEach((r) => {
        if (r?.key) credentialJson[r.key] = r.value ?? '';
      });
      return pluginCredApi.save(pluginId, { credentialJson });
    },
    onSuccess: () => {
      message.success('保存成功');
      qc.invalidateQueries({ queryKey: ['plugin', pluginId, 'credential'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  if (isLoading) return <Spin />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>凭证</h4>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saveMut.isPending}
          onClick={() => form.submit()}
        >
          保存
        </Button>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        当前认证方式：<b>TOKEN_FETCH</b>。这里填 token 获取请求里 <code>{'{{secrets.x}}'}</code>{' '}
        引用的密钥（键名自定义），每个插件在租户内只允许配置一份凭证。
      </Typography.Paragraph>

      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 560 }}
        onFinish={(v) => saveMut.mutate(v)}
      >
        <Form.List name="rows">
          {(rows, { add, remove }) => (
            <>
              {rows.map((row) => (
                <Space key={row.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item
                    name={[row.name, 'key']}
                    rules={[{ required: true, message: '键名必填' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="字段名，如 appKey" style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item name={[row.name, 'value']} style={{ marginBottom: 0 }}>
                    <Input.Password placeholder="值" visibilityToggle style={{ width: 280 }} />
                  </Form.Item>
                  <DeleteOutlined onClick={() => remove(row.name)} />
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({ key: '', value: '' })}
                block
              >
                添加字段
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </div>
  );
}
