import { useState } from 'react';
import { App, Button, Checkbox, Input, Modal, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  newField,
  isFixedField,
  parseSampleToFields,
  composedTypeLabel,
  type FieldDef,
  type FieldType,
  type ParamLocation,
} from '@/features/plugin/utils/schema';
import { LOCATION_OPTIONS, isComplexType } from '@/features/plugin/utils/mapping';

const TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' },
];

const ITEM_TYPE_OPTIONS = TYPE_OPTIONS.filter((o) => o.value !== 'array');

const COL = { name: 184, type: 116, location: 132, required: 64, action: 32 };

interface Props {
  value: FieldDef[];
  onChange: (next: FieldDef[]) => void;
}

export default function InputSchemaEditor({ value, onChange }: Props) {
  const { message } = App.useApp();
  const [importOpen, setImportOpen] = useState(false);
  const [sample, setSample] = useState('');

  const doImport = () => {
    const r = parseSampleToFields(sample);
    if (!r.ok) {
      message.error(r.error);
      return;
    }
    // 覆盖：用解析结果整体替换现有入参（解析失败时已提前 return，不会误清空）
    onChange(r.fields);
    message.success(`已生成 ${r.fields.length} 个入参（已覆盖原配置）`);
    setImportOpen(false);
    setSample('');
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={10}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Tooltip title="粘贴接口的示例请求体，自动反推参数名、类型与嵌套结构（含对象数组）">
          <Button size="small" icon={<ThunderboltOutlined />} onClick={() => setImportOpen(true)}>
            从示例 JSON 生成
          </Button>
        </Tooltip>
      </div>
      <FieldList value={value} onChange={onChange} topLevel />

      <Modal
        title="从示例 JSON 生成入参"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={doImport}
        okText="解析并填充"
        width={600}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          粘贴接口的<b>示例请求体</b>或 <b>JSON Schema</b>
          ，自动识别参数名、类型与嵌套结构（含对象、对象数组）。 解析出的参数默认作为 <b>Body</b>
          ；若是 Query/Path 参数可在表格里改「传入方法」。
          <b style={{ color: '#d4380d' }}>会覆盖当前已配置的入参</b>。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder={'{\n  "orders": [{ "sku": "A1", "qty": 2 }],\n  "page": 1\n}'}
          style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}
        />
      </Modal>
    </Space>
  );
}

interface ListProps {
  value: FieldDef[];
  onChange: (next: FieldDef[]) => void;
  itemLabel?: string;
  /** 顶层字段才展示「传入方法」与「默认值」，并显示列头 */
  topLevel?: boolean;
}

function FieldList({ value, onChange, itemLabel = '字段', topLevel = false }: ListProps) {
  const update = (idx: number, patch: Partial<FieldDef>) => {
    onChange(value.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };
  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = () => {
    onChange([...value, newField(topLevel ? { location: 'query' } : undefined)]);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={topLevel ? 10 : 8}>
      {topLevel && value.length > 0 && <ColumnHeader />}
      {value.map((f, idx) => (
        <FieldRow
          key={f.id}
          field={f}
          topLevel={topLevel}
          onChange={(patch) => update(idx, patch)}
          onRemove={() => remove(idx)}
        />
      ))}
      <Button icon={<PlusOutlined />} onClick={add} block type="dashed">
        {topLevel ? '添加参数' : `新增${itemLabel}`}
      </Button>
    </Space>
  );
}

function ColumnHeader() {
  const cell: React.CSSProperties = { fontSize: 12, color: '#8c8c8c' };
  const req = <span style={{ color: '#ff4d4f' }}> *</span>;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 2px' }}>
      <div style={{ width: COL.name, ...cell }}>参数名称{req}</div>
      <div style={{ width: COL.type, ...cell }}>参数类型{req}</div>
      <div style={{ flex: 1, minWidth: 120, ...cell }}>参数描述</div>
      <div style={{ width: COL.location, ...cell }}>传入方法{req}</div>
      <div style={{ width: COL.required, textAlign: 'center', ...cell }}>必填</div>
      <div style={{ width: COL.action }} />
    </div>
  );
}

interface RowProps {
  field: FieldDef;
  topLevel?: boolean;
  onChange: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
}

function FieldRow({ field, topLevel = false, onChange, onRemove }: RowProps) {
  const fixed = isFixedField(field);

  const onTypeChange = (t: FieldType) => {
    const patch: Partial<FieldDef> = { type: t };
    // 候选值只对 string 有意义（= JSON Schema 的 enum 约束）
    if (t !== 'string') patch.enumValues = undefined;
    if (t !== 'object') patch.fields = undefined;
    if (t !== 'array') {
      patch.itemType = undefined;
      patch.itemFields = undefined;
      patch.itemEnumValues = undefined;
    } else if (!field.itemType) {
      patch.itemType = 'string';
    }
    if (t === 'object' || t === 'array') {
      // 对象/数组没有「固定字面量」的概念，切换时清掉默认值
      patch.defaultValue = undefined;
      // 结构化参数只能进 body（query/path 承载不了 JSON 结构），切到复杂类型时强制 body
      patch.location = 'body';
    }
    onChange(patch);
  };

  const scalar = field.type !== 'object' && field.type !== 'array';
  const complex = isComplexType(field.type);

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: 10,
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          placeholder="参数名称"
          value={field.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ width: COL.name }}
        />
        <Select<FieldType>
          value={field.type}
          onChange={onTypeChange}
          options={TYPE_OPTIONS}
          style={{ width: COL.type }}
        />
        {field.type === 'array' && (
          <Tooltip title="数组元素类型在下方选择">
            <Tag color="blue" style={{ marginInlineEnd: 0, whiteSpace: 'nowrap' }}>
              {composedTypeLabel(field)}
            </Tag>
          </Tooltip>
        )}
        <Input
          placeholder="请输入描述（供 LLM 理解）"
          value={field.description}
          onChange={(e) => onChange({ description: e.target.value })}
          style={{ flex: 1, minWidth: 120 }}
        />
        {topLevel && (
          <Tooltip
            title={
              complex
                ? '对象/数组等结构化参数只能作为 Body 发送'
                : '该参数放到 URL 路径 / Query / 请求体；保存时自动拼接，无需手写'
            }
          >
            <Select<ParamLocation>
              value={complex ? 'body' : (field.location ?? 'query')}
              onChange={(loc) => onChange({ location: loc })}
              options={
                complex ? LOCATION_OPTIONS.filter((o) => o.value === 'body') : LOCATION_OPTIONS
              }
              disabled={complex}
              style={{ width: COL.location }}
            />
          </Tooltip>
        )}
        <div style={{ width: COL.required, textAlign: 'center' }}>
          <Tooltip title={fixed ? '固定值参数始终存在，无需必填' : ''}>
            <Checkbox
              checked={fixed ? false : !!field.required}
              disabled={fixed}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
          </Tooltip>
        </div>
        <Button
          type="text"
          icon={<MinusCircleOutlined style={{ color: '#999' }} />}
          onClick={onRemove}
          style={{ width: COL.action }}
        />
      </div>

      {topLevel && scalar && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, width: 64 }}>
            默认值
          </Typography.Text>
          <Input
            size="small"
            style={{ width: 260 }}
            placeholder="留空 = 由 LLM 填写"
            value={field.defaultValue ?? ''}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
          />
          {fixed ? (
            <>
              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                固定值
              </Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                每次都用此值、不暴露给 LLM
              </Typography.Text>
            </>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              填写后即固定值，适合 API Key 等不交给 LLM 的参数
            </Typography.Text>
          )}
        </div>
      )}

      {field.type === 'string' && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
          <Tooltip title="填了候选值，该参数就只能取其中之一（映射成 JSON Schema 的 enum）；留空＝自由文本">
            <Typography.Text type="secondary" style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
              候选值（可选）：
            </Typography.Text>
          </Tooltip>
          <EnumValuesEditor
            value={field.enumValues ?? []}
            onChange={(v) => onChange({ enumValues: v.length ? v : undefined })}
          />
        </div>
      )}

      {field.type === 'object' && (
        <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #e6e6e6' }}>
          <FieldList
            value={field.fields ?? []}
            onChange={(v) => onChange({ fields: v })}
            itemLabel="子字段"
          />
        </div>
      )}

      {field.type === 'array' && (
        <div style={{ marginTop: 8 }}>
          <Space wrap>
            <Typography.Text type="secondary">数组元素类型：</Typography.Text>
            <Select
              value={field.itemType ?? 'string'}
              onChange={(t) =>
                onChange({
                  itemType: t,
                  itemFields: t === 'object' ? (field.itemFields ?? []) : undefined,
                  itemEnumValues: t === 'string' ? field.itemEnumValues : undefined,
                })
              }
              options={ITEM_TYPE_OPTIONS}
              style={{ width: 140 }}
            />
          </Space>
          {field.itemType === 'string' && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
              <Tooltip title="给数组元素限定候选值（JSON Schema 的 items.enum）；留空＝自由文本">
                <Typography.Text type="secondary" style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                  元素候选值（可选）：
                </Typography.Text>
              </Tooltip>
              <EnumValuesEditor
                value={field.itemEnumValues ?? []}
                onChange={(v) => onChange({ itemEnumValues: v.length ? v : undefined })}
              />
            </div>
          )}
          {field.itemType === 'object' && (
            <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #e6e6e6' }}>
              <FieldList
                value={field.itemFields ?? []}
                onChange={(v) => onChange({ itemFields: v })}
                itemLabel="元素字段"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnumValuesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Select
      mode="tags"
      style={{ minWidth: 280 }}
      value={value}
      onChange={onChange}
      tokenSeparators={[',']}
      placeholder="输入候选值后回车"
      tagRender={(p) => (
        <Tag closable={p.closable} onClose={p.onClose}>
          {p.label}
        </Tag>
      )}
    />
  );
}
