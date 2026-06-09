import { useMemo, useState } from 'react';
import { App, Button, Checkbox, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { nanoid } from 'nanoid';
import type { FieldType } from '@/features/plugin/utils/schema';
import { type OutputField, outputPath } from '@/features/plugin/utils/mapping';
import {
  evalJsonPath,
  parseSampleToOutputs,
  type ParsedOutput,
} from '@/features/plugin/utils/jsonpath';

const OUTPUT_TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' },
];
const ITEM_TYPE_OPTIONS = OUTPUT_TYPE_OPTIONS.filter((o) => o.value !== 'array');

const COL = { name: 184, type: 116, source: 200, required: 64, action: 32 };

function newOutput(partial?: Partial<OutputField>): OutputField {
  return { id: nanoid(), name: '', path: '', type: 'string', required: true, ...partial };
}

function parsedToOutput(po: ParsedOutput): OutputField {
  const o = newOutput({ name: po.name, type: po.type, path: po.path ?? '' });
  if (po.type === 'object') o.fields = (po.fields ?? []).map(parsedToOutput);
  if (po.type === 'array') {
    // 嵌套数组(array of array)退化为 string，避免无意义的深层结构
    const it: Exclude<FieldType, 'array'> =
      po.itemType && po.itemType !== 'array' ? po.itemType : 'string';
    o.itemType = it;
    if (it === 'object') o.itemFields = (po.itemFields ?? []).map(parsedToOutput);
  }
  return o;
}

interface Props {
  value: OutputField[];
  onChange: (next: OutputField[]) => void;
}

export default function OutputParamsEditor({ value, onChange }: Props) {
  const { message } = App.useApp();
  const [showSource, setShowSource] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [sample, setSample] = useState('');

  const parsedSample = useMemo<unknown>(() => {
    if (!sample.trim()) return undefined;
    try {
      return JSON.parse(sample);
    } catch {
      return undefined;
    }
  }, [sample]);

  const applyAutoParse = () => {
    const r = parseSampleToOutputs(sample);
    if (!r.ok) {
      message.error(r.error);
      return;
    }
    // 覆盖：用解析结果整体替换现有输出参数（解析失败时已提前 return，不会误清空）
    onChange(r.rows.map(parsedToOutput));
    message.success(`已生成 ${r.rows.length} 个输出参数（已覆盖原配置）`);
    setAutoOpen(false);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={10}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        声明工具返回给 Agent 的字段。默认按字段名从响应顶层同名键取值（如 errcode → 响应里的
        errcode）；type 选 Object/Array 可继续添加内部子参数。不配置则返回完整响应。
      </Typography.Text>

      <OutputList
        value={value}
        onChange={onChange}
        topLevel
        showSource={showSource}
        parsedSample={parsedSample}
      />

      <Space wrap>
        <Button
          icon={<PlusOutlined />}
          onClick={() => onChange([...value, newOutput()])}
          type="dashed"
        >
          添加参数
        </Button>
        <Button icon={<ThunderboltOutlined />} onClick={() => setAutoOpen(true)}>
          自动解析
        </Button>
        <Checkbox checked={showSource} onChange={(e) => setShowSource(e.target.checked)}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            高级：自定义来源路径
          </Typography.Text>
        </Checkbox>
      </Space>

      <Modal
        title="自动解析输出参数"
        open={autoOpen}
        onCancel={() => setAutoOpen(false)}
        onOk={applyAutoParse}
        okText="解析并填充"
        width={600}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          粘贴一段接口的样例响应，自动识别字段名与类型（含嵌套对象/数组）生成输出参数。
          <b style={{ color: '#d4380d' }}>会覆盖当前已配置的输出参数</b>。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder={'{\n  "errcode": 0,\n  "errmsg": "ok",\n  "data": { "userId": "u_1" }\n}'}
          style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}
        />
        <SamplePreview sample={sample} />
      </Modal>
    </Space>
  );
}

interface ListProps {
  value: OutputField[];
  onChange: (next: OutputField[]) => void;
  topLevel?: boolean;
  showSource?: boolean;
  parsedSample?: unknown;
}

function OutputList({
  value,
  onChange,
  topLevel = false,
  showSource = false,
  parsedSample,
}: ListProps) {
  const update = (idx: number, patch: Partial<OutputField>) =>
    onChange(value.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={topLevel ? 10 : 8}>
      {topLevel && value.length > 0 && <ColumnHeader showSource={showSource} />}
      {value.map((o, idx) => (
        <OutputRow
          key={o.id}
          field={o}
          topLevel={topLevel}
          showSource={showSource}
          parsedSample={parsedSample}
          onChange={(patch) => update(idx, patch)}
          onRemove={() => remove(idx)}
        />
      ))}
    </Space>
  );
}

interface RowProps {
  field: OutputField;
  topLevel?: boolean;
  showSource?: boolean;
  parsedSample?: unknown;
  onChange: (patch: Partial<OutputField>) => void;
  onRemove: () => void;
}

function OutputRow({
  field,
  topLevel = false,
  showSource = false,
  parsedSample,
  onChange,
  onRemove,
}: RowProps) {
  const onTypeChange = (t: FieldType) => {
    const patch: Partial<OutputField> = { type: t };
    if (t !== 'object') patch.fields = undefined;
    if (t !== 'array') {
      patch.itemType = undefined;
      patch.itemFields = undefined;
    } else if (!field.itemType) {
      patch.itemType = 'string';
    }
    onChange(patch);
  };

  const hit =
    topLevel && showSource && parsedSample !== undefined
      ? evalJsonPath(parsedSample, outputPath(field))
      : undefined;

  return (
    <div>
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
          options={OUTPUT_TYPE_OPTIONS}
          style={{ width: COL.type }}
        />
        <Input
          placeholder="请输入描述（供 Agent 理解）"
          value={field.description}
          onChange={(e) => onChange({ description: e.target.value })}
          style={{ flex: 1, minWidth: 120 }}
        />
        {topLevel && showSource && (
          <Input
            placeholder={`$.${field.name || 'field'}`}
            value={field.path}
            onChange={(e) => onChange({ path: e.target.value })}
            style={{ width: COL.source, fontFamily: 'Menlo, monospace', fontSize: 12 }}
          />
        )}
        <div style={{ width: COL.required, textAlign: 'center' }}>
          <Checkbox
            checked={!!field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
        </div>
        <Button
          type="text"
          icon={<MinusCircleOutlined style={{ color: '#999' }} />}
          onClick={onRemove}
          style={{ width: COL.action }}
        />
      </div>

      {hit !== undefined && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, marginLeft: COL.name + COL.type + 16, display: 'block' }}
        >
          命中：{previewValue(hit)}
        </Typography.Text>
      )}

      {field.type === 'object' && (
        <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #e6e6e6' }}>
          <OutputList value={field.fields ?? []} onChange={(v) => onChange({ fields: v })} />
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => onChange({ fields: [...(field.fields ?? []), newOutput()] })}
            style={{ marginTop: 8 }}
          >
            添加子参数
          </Button>
        </div>
      )}

      {field.type === 'array' && (
        <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #e6e6e6' }}>
          <Space wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              数组元素类型：
            </Typography.Text>
            <Select
              value={field.itemType ?? 'string'}
              onChange={(t) =>
                onChange({
                  itemType: t,
                  itemFields: t === 'object' ? (field.itemFields ?? []) : undefined,
                })
              }
              options={ITEM_TYPE_OPTIONS}
              style={{ width: 140 }}
            />
          </Space>
          {field.itemType === 'object' && (
            <div style={{ marginTop: 8 }}>
              <OutputList
                value={field.itemFields ?? []}
                onChange={(v) => onChange({ itemFields: v })}
              />
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => onChange({ itemFields: [...(field.itemFields ?? []), newOutput()] })}
                style={{ marginTop: 8 }}
              >
                添加元素字段
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnHeader({ showSource }: { showSource: boolean }) {
  const cell: React.CSSProperties = { fontSize: 12, color: '#8c8c8c' };
  const req = <span style={{ color: '#ff4d4f' }}> *</span>;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 2px' }}>
      <div style={{ width: COL.name, ...cell }}>参数名称{req}</div>
      <div style={{ width: COL.type, ...cell }}>参数类型{req}</div>
      <div style={{ flex: 1, minWidth: 120, ...cell }}>参数描述</div>
      {showSource && <div style={{ width: COL.source, ...cell }}>来源路径</div>}
      <div style={{ width: COL.required, textAlign: 'center', ...cell }}>必填</div>
      <div style={{ width: COL.action }} />
    </div>
  );
}

function SamplePreview({ sample }: { sample: string }) {
  if (!sample.trim()) return null;
  const r = parseSampleToOutputs(sample);
  if (!r.ok) {
    return (
      <Typography.Text type="danger" style={{ fontSize: 12 }}>
        {r.error}
      </Typography.Text>
    );
  }
  return (
    <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        将添加：
      </Typography.Text>
      {r.rows.map((row) => (
        <Tag key={row.name}>
          {row.name} <Typography.Text type="secondary">({row.type})</Typography.Text>
        </Tag>
      ))}
    </Space>
  );
}

function previewValue(v: unknown): string {
  if (v === null) return 'null（未命中）';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}
