import { Fragment } from 'react';
import { Divider, Form, Input, InputNumber, Select, Switch } from 'antd';
import type { Rule } from 'antd/es/form';
import type { ParamFieldSchema } from '../types';
import SecretField from './SecretField';

/**
 * 按后端下发的表单 schema 渲染参数表单。
 *
 * ★ **这个组件是「新增一种连接器类型，前端零改动」的全部实现。**
 * 它对具体类型一无所知：不认识 host/baseUrl 这些字段名，也没有任何 `if (kind === ...)`。
 * 后端多一个 Connector 实现类，`/admin/connectors/kinds` 自动多返回一项，这里自动多渲染一组表单。
 *
 * 如果哪天不得不在这里为某个类型写分支，那说明后端的 ParamSpec 表达力不够——
 * 该扩的是 ParamField（加一种 ParamType 或一个约束），不是在这里加 if。
 */

interface Props {
  fields: ParamFieldSchema[];
  /**
   * 编辑态：敏感字段不再是空输入框，而是「已保存」态（见 {@link SecretField}）。
   * 语义不变——不主动更换就不往表单里写值，后端那条「留空 = 沿用原值」照旧生效。
   */
  editing: boolean;
  /** 编辑态的连接 id，敏感字段取回明文时要用。新建态传 null。 */
  connectorId?: string | null;
  /** 表单里参数字段的命名空间，避免与 name/displayName 撞名。 */
  namePath?: string;
}

/** 把 schema 上的约束翻译成 antd 的校验规则。后端会再校验一遍，这里只是少跑一趟网络。 */
function rulesOf(f: ParamFieldSchema, editing: boolean): Rule[] {
  const rules: Rule[] = [];
  // 敏感字段在编辑态不强制必填：留空 = 沿用原值。
  const required = f.required && !(editing && f.secret);
  if (required) {
    rules.push({ required: true, message: `请填写${f.label}` });
  }
  if (f.pattern) {
    rules.push({ pattern: new RegExp(f.pattern), message: `${f.label}格式不正确` });
  }
  return rules;
}

function controlOf(f: ParamFieldSchema, editing: boolean, connectorId: string | null) {
  switch (f.type) {
    case 'password':
      // 编辑态交给 SecretField：它自己处理「已保存 / 更换中」两种形态，以及点眼睛取回明文。
      // 新建态它退化成一个普通的 Input.Password，与改动前完全一致。
      return <SecretField field={f} connectorId={editing ? connectorId : null} />;
    case 'int':
      return <InputNumber min={f.min} max={f.max} style={{ width: '100%' }} />;
    case 'bool':
      return <Switch />;
    case 'enum':
      return (
        <Select
          options={(f.options ?? []).map((o) => ({ label: o, value: o }))}
          placeholder={f.placeholder}
        />
      );
    case 'textarea':
      return <Input.TextArea rows={4} placeholder={f.placeholder} />;
    case 'string_list':
      return (
        <Select
          mode="tags"
          tokenSeparators={[',', ' ']}
          placeholder={f.placeholder ?? '回车添加多项'}
        />
      );
    default:
      return <Input placeholder={f.placeholder} />;
  }
}

export default function SchemaForm({
  fields,
  editing,
  connectorId = null,
  namePath = 'params',
}: Props) {
  // 按 group 分段，保持后端给出的字段顺序（Map 的插入序）。
  const groups = new Map<string, ParamFieldSchema[]>();
  for (const f of fields) {
    const g = f.group || '基本';
    const list = groups.get(g);
    if (list) list.push(f);
    else groups.set(g, [f]);
  }

  const sections = [...groups.entries()];

  return (
    <>
      {sections.map(([group, list], idx) => (
        <Fragment key={group}>
          {sections.length > 1 && (
            <Divider orientation="left" plain style={{ marginTop: idx === 0 ? 0 : 16 }}>
              {group}
            </Divider>
          )}
          {list.map((f) => (
            <Form.Item
              key={f.name}
              label={f.label}
              name={[namePath, f.name]}
              extra={f.help}
              rules={rulesOf(f, editing)}
              // bool 用 Switch，值绑在 checked 上而不是 value。
              valuePropName={f.type === 'bool' ? 'checked' : undefined}
            >
              {controlOf(f, editing, connectorId)}
            </Form.Item>
          ))}
        </Fragment>
      ))}
    </>
  );
}
