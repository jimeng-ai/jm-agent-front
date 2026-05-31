import { nanoid } from 'nanoid';

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';

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
    case 'number':
    case 'boolean':
      base.type = field.type;
      return base;
    case 'enum':
      base.type = 'string';
      base.enum = field.enumValues ?? [];
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
      } else if (itemType === 'enum') {
        base.items = { type: 'string', enum: field.itemEnumValues ?? [] };
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

  if (Array.isArray(schema.enum)) {
    base.type = 'enum';
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
        base.itemType = 'enum';
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
  return {
    id: nanoid(),
    name: fw.name ?? '',
    type: (fw.type as FieldType) ?? 'string',
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
