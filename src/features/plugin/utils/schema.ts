import { nanoid } from 'nanoid';

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  enumValues?: string[];
  fields?: FieldDef[];
  itemType?: Exclude<FieldType, 'array'>;
  itemFields?: FieldDef[];
  itemEnumValues?: string[];
}

type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
};

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
  fields.forEach((f) => {
    if (!f.name) return;
    root.properties![f.name] = fieldToSchema(f);
    if (f.required) root.required!.push(f.name);
  });
  if (root.required!.length === 0) delete root.required;
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

export function jsonSchemaToFields(schema: Record<string, unknown> | undefined): FieldDef[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as JsonSchema;
  if (s.type !== 'object' || !s.properties) return [];
  const req = new Set(s.required ?? []);
  return Object.entries(s.properties).map(([k, v]) => schemaToField(k, v, req.has(k)));
}
