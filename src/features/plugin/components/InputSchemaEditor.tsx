import { Button, Input, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  newField,
  type FieldDef,
  type FieldType,
  type ParamLocation,
} from '@/features/plugin/utils/schema';
import { LOCATION_OPTIONS } from '@/features/plugin/utils/mapping';

const TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: 'string', value: 'string' },
  { label: 'number', value: 'number' },
  { label: 'boolean', value: 'boolean' },
  { label: 'enum', value: 'enum' },
  { label: 'object', value: 'object' },
  { label: 'array', value: 'array' },
];

const ITEM_TYPE_OPTIONS = TYPE_OPTIONS.filter((o) => o.value !== 'array');

interface Props {
  value: FieldDef[];
  onChange: (next: FieldDef[]) => void;
}

export default function InputSchemaEditor({ value, onChange }: Props) {
  return (
    <FieldList value={value} onChange={onChange} topLevel />
  );
}

interface ListProps {
  value: FieldDef[];
  onChange: (next: FieldDef[]) => void;
  itemLabel?: string;
  /** 顶层字段才展示「位置(Path/Query/Body)」选择 */
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
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
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
        新增{itemLabel}
      </Button>
    </Space>
  );
}

interface RowProps {
  field: FieldDef;
  topLevel?: boolean;
  onChange: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
}

function FieldRow({ field, topLevel = false, onChange, onRemove }: RowProps) {
  const onTypeChange = (t: FieldType) => {
    const patch: Partial<FieldDef> = { type: t };
    if (t !== 'enum') patch.enumValues = undefined;
    if (t !== 'object') patch.fields = undefined;
    if (t !== 'array') {
      patch.itemType = undefined;
      patch.itemFields = undefined;
      patch.itemEnumValues = undefined;
    } else if (!field.itemType) {
      patch.itemType = 'string';
    }
    onChange(patch);
  };

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: 10,
        background: '#fafafa',
      }}
    >
      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder="字段名"
          value={field.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ width: 200 }}
        />
        <Select<FieldType>
          value={field.type}
          onChange={onTypeChange}
          options={TYPE_OPTIONS}
          style={{ width: 110 }}
        />
        {topLevel && (
          <Tooltip title="该参数放到 URL 路径 / Query / 请求体；保存时自动拼接，无需手写">
            <Select<ParamLocation>
              value={field.location ?? 'query'}
              onChange={(loc) => onChange({ location: loc })}
              options={LOCATION_OPTIONS}
              style={{ width: 120 }}
            />
          </Tooltip>
        )}
        <Input
          placeholder="描述（供 LLM 理解）"
          value={field.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <Space style={{ paddingLeft: 8, paddingRight: 8 }}>
          <Typography.Text type="secondary">必填</Typography.Text>
          <Switch
            checked={!!field.required}
            onChange={(v) => onChange({ required: v })}
          />
        </Space>
        <Button icon={<DeleteOutlined />} danger onClick={onRemove} />
      </Space.Compact>

      {field.type === 'enum' && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ marginRight: 8 }}>
            候选值：
          </Typography.Text>
          <EnumValuesEditor
            value={field.enumValues ?? []}
            onChange={(v) => onChange({ enumValues: v })}
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
                  itemFields: t === 'object' ? field.itemFields ?? [] : undefined,
                  itemEnumValues: t === 'enum' ? field.itemEnumValues ?? [] : undefined,
                })
              }
              options={ITEM_TYPE_OPTIONS}
              style={{ width: 140 }}
            />
          </Space>
          {field.itemType === 'enum' && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                候选值：
              </Typography.Text>
              <EnumValuesEditor
                value={field.itemEnumValues ?? []}
                onChange={(v) => onChange({ itemEnumValues: v })}
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
      tagRender={(p) => <Tag closable={p.closable} onClose={p.onClose}>{p.label}</Tag>}
    />
  );
}
