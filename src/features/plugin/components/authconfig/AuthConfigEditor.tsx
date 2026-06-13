import { useRef, useState } from 'react';
import { App, Alert, Button, Input, Space } from 'antd';
import { CodeOutlined, FormOutlined } from '@ant-design/icons';
import type { PluginAuthType } from '@/api/types';
import {
  parseAuthConfig,
  serializeAuthConfig,
  type AuthForm,
  type ParsedAuthConfig,
} from '@/features/plugin/utils/authConfig';
import ApiKeyForm from './ApiKeyForm';
import HmacForm from './HmacForm';
import OAuth2Form from './OAuth2Form';
import TokenFetchForm from './TokenFetchForm';
import type {
  ApiKeyForm as ApiKeyFormValue,
  HmacForm as HmacFormValue,
  OAuth2Form as OAuth2FormValue,
  TokenFetchForm as TokenFetchFormValue,
} from '@/features/plugin/utils/authConfig';

interface Props {
  authType: PluginAuthType;
  pluginId: string;
  /** 受 antd Form.Item 注入：当前 authConfig 字符串 */
  value?: string;
  onChange?: (next: string) => void;
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/**
 * auth_config 编辑器：按认证方式渲染结构化表单，附带「切换到 JSON」高级模式。
 * 作为 antd Form.Item 的受控子组件（value/onChange 契约），内部把表单 ⇄ JSON 双向转换后回写字符串。
 */
export default function AuthConfigEditor({ authType, pluginId, value, onChange }: Props) {
  const { message } = App.useApp();
  const [parsed, setParsed] = useState<ParsedAuthConfig>(() => parseAuthConfig(authType, value));
  // 记录上次渲染用的 authType + 我们最后向外 emit 的字符串，用于区分「类型切换/外部变更」与「自身变更」
  const prev = useRef<{ authType: PluginAuthType; emitted?: string }>({ authType, emitted: value });

  // 渲染期同步：authType 切换、或外部 value 变化（非自身 emit）→ 立即重新解析，
  // 避免「prop 已是新类型、state 还是旧类型表单」用错结构渲染而崩（如 TOKEN_FETCH 取 request.headers）。
  let view = parsed;
  if (prev.current.authType !== authType || value !== prev.current.emitted) {
    view = parseAuthConfig(authType, value);
    prev.current = { authType, emitted: value };
    setParsed(view);
  }

  const emit = (next: ParsedAuthConfig) => {
    const str =
      next.mode === 'raw' ? next.raw : serializeAuthConfig(authType, next.form as AuthForm);
    prev.current = { authType, emitted: str };
    setParsed(next);
    onChange?.(str);
  };

  const onFormChange = (form: AuthForm) => emit({ mode: 'form', form, raw: view.raw });

  const switchToRaw = () => {
    const raw = view.form != null ? pretty(serializeAuthConfig(authType, view.form)) : view.raw;
    emit({ mode: 'raw', raw, form: view.form });
  };

  const switchToForm = () => {
    const p = parseAuthConfig(authType, view.raw);
    if (p.mode === 'form') {
      emit(p);
    } else {
      message.warning('当前 JSON 无法用表单表示（格式不符或含未知字段），请修正后再切换');
    }
  };

  const renderForm = () => {
    const form = view.form;
    // 同步兜底：理论上 view 已随 authType 重解析，form 结构与类型一致；缺失则不渲染避免崩
    if (!form) return null;
    switch (authType) {
      case 'API_KEY':
        return <ApiKeyForm value={form as ApiKeyFormValue} onChange={onFormChange} />;
      case 'HMAC':
        return <HmacForm value={form as HmacFormValue} onChange={onFormChange} />;
      case 'OAUTH2':
        return (
          <OAuth2Form value={form as OAuth2FormValue} onChange={onFormChange} pluginId={pluginId} />
        );
      case 'TOKEN_FETCH':
        return (
          <TokenFetchForm
            value={form as TokenFetchFormValue}
            onChange={onFormChange}
            pluginId={pluginId}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 8 }}>
        {view.mode === 'form' ? (
          <Button size="small" type="text" icon={<CodeOutlined />} onClick={switchToRaw}>
            切换到 JSON
          </Button>
        ) : (
          <Button size="small" type="text" icon={<FormOutlined />} onClick={switchToForm}>
            切换到表单
          </Button>
        )}
      </Space>

      {view.mode === 'form' ? (
        renderForm()
      ) : (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 8 }}
            message="高级 JSON 模式"
            description="历史配置或表单暂不支持的字段会落到这里。修正为标准结构后可「切换到表单」。"
          />
          <Input.TextArea
            value={view.raw}
            onChange={(e) => emit({ mode: 'raw', raw: e.target.value, form: view.form })}
            rows={8}
            style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}
