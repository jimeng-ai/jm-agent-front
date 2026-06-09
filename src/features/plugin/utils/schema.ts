import { nanoid } from 'nanoid';

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** 入参在 HTTP 请求中的位置（仅顶层字段有意义） */
export type ParamLocation = 'path' | 'query' | 'body';

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  /** 该入参放到 URL 路径 / Query / Body，仅顶层字段使用，默认 query */
  location?: ParamLocation;
  /**
   * 固定值/默认值（仅顶层字段）。填写后该参数视为「固定值」：
   * 不进入给 LLM 的 inputSchema、调用时直接以该值拼进请求（适合 API Key 等）。
   */
  defaultValue?: string;
  enumValues?: string[];
  fields?: FieldDef[];
  itemType?: Exclude<FieldType, 'array'>;
  itemFields?: FieldDef[];
  itemEnumValues?: string[];
}

/** 固定参数随 inputSchema 持久化的结构（不进入 properties，故不暴露给 LLM） */
export interface FixedParamWire {
  name: string;
  type: FieldType;
  location: ParamLocation;
  value: string;
  description?: string;
  /** 顶层字段中的原始序号，用于回填时还原顺序 */
  order: number;
}

type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  /** 厂商扩展：固定参数列表，LLM 会忽略未知字段 */
  'x-fixed-params'?: FixedParamWire[];
};

/** 是否为「固定值」字段（填了默认值即固定值） */
export function isFixedField(f: FieldDef): boolean {
  return !!f.defaultValue && f.defaultValue.trim() !== '';
}

export function newField(partial?: Partial<FieldDef>): FieldDef {
  return {
    id: nanoid(),
    name: '',
    type: 'string',
    required: false,
    ...partial,
  };
}

function fieldToSchema(field: FieldDef): JsonSchema {
  const base: JsonSchema = {};
  if (field.description) base.description = field.description;

  switch (field.type) {
    case 'string':
      base.type = 'string';
      // 字符串带候选值 → JSON Schema 的 enum 约束（不再是独立的 enum 类型）
      if (field.enumValues && field.enumValues.length > 0) base.enum = field.enumValues;
      return base;
    case 'number':
    case 'boolean':
      base.type = field.type;
      return base;
    case 'object':
      base.type = 'object';
      base.properties = {};
      base.required = [];
      (field.fields ?? []).forEach((f) => {
        if (!f.name) return;
        base.properties![f.name] = fieldToSchema(f);
        if (f.required) base.required!.push(f.name);
      });
      if (base.required!.length === 0) delete base.required;
      return base;
    case 'array': {
      base.type = 'array';
      const itemType = field.itemType ?? 'string';
      if (itemType === 'object') {
        base.items = fieldToSchema({
          id: '',
          name: '',
          type: 'object',
          fields: field.itemFields,
        });
      } else if (itemType === 'string' && field.itemEnumValues && field.itemEnumValues.length > 0) {
        // 字符串元素带候选值 → items.enum
        base.items = { type: 'string', enum: field.itemEnumValues };
      } else {
        base.items = { type: itemType };
      }
      return base;
    }
  }
}

export function fieldsToJsonSchema(fields: FieldDef[]): Record<string, unknown> {
  const root: JsonSchema = { type: 'object', properties: {}, required: [] };
  const fixed: FixedParamWire[] = [];
  fields.forEach((f, idx) => {
    if (!f.name) return;
    // 固定值字段不进 properties（即不暴露给 LLM），单独存入 x-fixed-params 以便回填
    if (isFixedField(f)) {
      fixed.push({
        name: f.name,
        type: f.type,
        location: f.location ?? 'query',
        value: f.defaultValue!.trim(),
        description: f.description?.trim() || undefined,
        order: idx,
      });
      return;
    }
    root.properties![f.name] = fieldToSchema(f);
    if (f.required) root.required!.push(f.name);
  });
  if (root.required!.length === 0) delete root.required;
  if (fixed.length > 0) root['x-fixed-params'] = fixed;
  return root as Record<string, unknown>;
}

function schemaToField(name: string, schema: JsonSchema, required: boolean): FieldDef {
  const base: FieldDef = {
    id: nanoid(),
    name,
    type: 'string',
    required,
    description: schema.description,
  };

  // 带 enum 约束 → 还原成「带候选值的 string」（而非独立的 enum 类型）
  if (Array.isArray(schema.enum)) {
    base.type = 'string';
    base.enumValues = schema.enum.map(String);
    return base;
  }

  switch (schema.type) {
    case 'number':
    case 'integer':
      base.type = 'number';
      return base;
    case 'boolean':
      base.type = 'boolean';
      return base;
    case 'object': {
      base.type = 'object';
      const req = new Set(schema.required ?? []);
      base.fields = Object.entries(schema.properties ?? {}).map(([k, v]) =>
        schemaToField(k, v, req.has(k)),
      );
      return base;
    }
    case 'array': {
      base.type = 'array';
      const items = schema.items ?? { type: 'string' };
      if (Array.isArray(items.enum)) {
        base.itemType = 'string';
        base.itemEnumValues = items.enum.map(String);
      } else if (items.type === 'object') {
        base.itemType = 'object';
        const req = new Set(items.required ?? []);
        base.itemFields = Object.entries(items.properties ?? {}).map(([k, v]) =>
          schemaToField(k, v, req.has(k)),
        );
      } else if (items.type === 'number' || items.type === 'integer') {
        base.itemType = 'number';
      } else if (items.type === 'boolean') {
        base.itemType = 'boolean';
      } else {
        base.itemType = 'string';
      }
      return base;
    }
    default:
      base.type = 'string';
      return base;
  }
}

function fixedToField(fw: FixedParamWire): FieldDef {
  // 历史数据里 type 可能是已废弃的 'enum'，统一归一成 string
  const rawType = (fw.type as string) ?? 'string';
  return {
    id: nanoid(),
    name: fw.name ?? '',
    type: rawType === 'enum' ? 'string' : (rawType as FieldType),
    required: false,
    description: fw.description,
    location: (fw.location as ParamLocation) ?? 'query',
    defaultValue: fw.value ?? '',
  };
}

export function jsonSchemaToFields(schema: Record<string, unknown> | undefined): FieldDef[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as JsonSchema;

  // 普通字段（来自 properties，保持插入顺序）
  const req = new Set(s.required ?? []);
  const normal: FieldDef[] =
    s.properties && typeof s.properties === 'object'
      ? Object.entries(s.properties).map(([k, v]) => schemaToField(k, v, req.has(k)))
      : [];

  // 固定字段（来自 x-fixed-params），按 order 插回原始位置以保持顺序稳定
  const fixedWire = Array.isArray(s['x-fixed-params']) ? s['x-fixed-params'] : [];
  const fixed = fixedWire
    .map((fw) => ({
      order: typeof fw.order === 'number' ? fw.order : Number.MAX_SAFE_INTEGER,
      field: fixedToField(fw),
    }))
    .sort((a, b) => a.order - b.order);

  const result = [...normal];
  fixed.forEach(({ order, field }) => {
    result.splice(Math.min(order, result.length), 0, field);
  });
  return result;
}

/** 人类可读的组合类型标签：Array&lt;Object&gt; / Array&lt;String&gt; / Object / String 等 */
export function composedTypeLabel(field: FieldDef): string {
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (field.type === 'array') return `Array<${cap(field.itemType ?? 'string')}>`;
  return cap(field.type);
}

function inferFieldType(v: unknown): FieldType {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'string';
  switch (typeof v) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

/** 由一个样例值递归推断出参数定义（含 object 子字段、array 元素结构） */
function sampleValueToField(name: string, value: unknown): FieldDef {
  const type = inferFieldType(value);
  const f = newField({ name, type });
  if (type === 'object') {
    f.fields = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      sampleValueToField(k, v),
    );
  } else if (type === 'array') {
    const arr = value as unknown[];
    // 取首个对象元素推断元素字段（对象数组场景）
    const firstObj = arr.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as
      | Record<string, unknown>
      | undefined;
    if (firstObj) {
      f.itemType = 'object';
      f.itemFields = Object.entries(firstObj).map(([k, v]) => sampleValueToField(k, v));
    } else {
      const it = arr.length ? inferFieldType(arr[0]) : 'string';
      // 不支持数组套数组，退化为 string 元素
      f.itemType = it === 'array' ? 'string' : it;
    }
  }
  return f;
}

export type SampleParseResult = { ok: true; fields: FieldDef[] } | { ok: false; error: string };

/**
 * 从一段「示例请求体 JSON」反推入参定义。
 * - 顶层 JSON 对象（最常见）→ 每个键是一个入参，默认作为 body
 * - 顶层是对象数组 → 归成一个 Array&lt;Object&gt; 入参（默认名 items）
 */
export function parseSampleToFields(sample: string): SampleParseResult {
  if (!sample.trim()) return { ok: false, error: '请先粘贴示例 JSON' };
  let json: unknown;
  try {
    json = JSON.parse(sample);
  } catch (e) {
    return { ok: false, error: `不是合法 JSON：${(e as Error).message}` };
  }

  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    // 粘贴的本身就是 JSON Schema（{type:"object",properties:{...}}）→ 直接按 schema 还原，
    // 能保留 required、enum 候选值等约束（比从示例值推断更精确）
    if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
      const fields = jsonSchemaToFields(obj).map((f) => ({
        ...f,
        location: f.location ?? ('body' as ParamLocation),
      }));
      return fields.length ? { ok: true, fields } : { ok: false, error: '未解析到任何字段' };
    }
    // 否则按「示例值」逐键推断类型
    const fields = Object.entries(obj).map(([k, v]) => ({
      ...sampleValueToField(k, v),
      location: 'body' as ParamLocation,
    }));
    return fields.length ? { ok: true, fields } : { ok: false, error: '未解析到任何字段' };
  }

  if (Array.isArray(json)) {
    return { ok: true, fields: [sampleValueToField('items', json)] };
  }

  return { ok: false, error: '示例需要是 JSON 对象（推荐）或对象数组' };
}
