import { nanoid } from 'nanoid';
import type { HttpMethod } from '@/api/types';
import type { AiOutputSpec, AiParamSpec, AiToolSpec } from '@/features/plugin/api';
import { newField, type FieldDef, type FieldType } from './schema';
import { emptyHttpForm, type HttpForm, type OutputField } from './mapping';

/**
 * AI 草稿(ToolSpec) → 编辑器状态({fields, httpForm})。刻意做得很薄：
 * 真正的 inputSchema / mapping 仍由保存时的 fieldsToJsonSchema + buildMapping 生成，
 * 保证「枚举=string+候选值」「object/array 强制 body」等规则只有一处真源。
 */

const TYPES: FieldType[] = ['string', 'number', 'boolean', 'object', 'array'];

function asType(t?: string): FieldType {
  const v = (t ?? '').toLowerCase();
  return (TYPES as string[]).includes(v) ? (v as FieldType) : 'string';
}

function paramToField(p: AiParamSpec): FieldDef {
  const type = asType(p.type);
  const f = newField({
    name: p.name ?? '',
    type,
    description: p.description || undefined,
    required: !!p.required,
    location: (p.location as FieldDef['location']) || undefined,
  });
  if (type === 'string' && p.enumValues && p.enumValues.length) {
    f.enumValues = p.enumValues;
  }
  if (type === 'object') {
    f.fields = (p.fields ?? []).map(paramToField);
  }
  if (type === 'array') {
    const it = asType(p.itemType);
    f.itemType = it === 'array' ? 'string' : it;
    if (f.itemType === 'object') {
      f.itemFields = (p.itemFields ?? []).map(paramToField);
    }
  }
  return f;
}

function outputToField(o: AiOutputSpec): OutputField {
  return {
    id: nanoid(),
    name: o.name ?? '',
    path: '',
    type: asType(o.type),
    description: o.description || undefined,
  };
}

export interface EditorTool {
  name: string;
  title?: string;
  description?: string;
  enabled: boolean;
  fields: FieldDef[];
  httpForm: HttpForm;
}

export function toolSpecToEditor(spec: AiToolSpec): EditorTool {
  const httpForm: HttpForm = {
    ...emptyHttpForm(),
    method: (spec.method as HttpMethod) || 'POST',
    urlTemplate: spec.path ?? '',
    headers: (spec.headers ?? []).map((h) => ({ key: h.key ?? '', value: h.value ?? '' })),
    bodyContentType: spec.bodyContentType ?? '',
    outputs: (spec.outputs ?? []).map(outputToField),
  };
  return {
    name: spec.name ?? '',
    title: spec.title || undefined,
    description: spec.description || undefined,
    enabled: true,
    fields: (spec.params ?? []).map(paramToField),
    httpForm,
  };
}

/** 反向：把编辑器里某个工具（名称 + fields + httpForm）还原成 ToolSpec（供对已存插件做对话式微调）。 */
export function editorToToolSpec(
  name: string,
  description: string | undefined,
  fields: FieldDef[],
  httpForm: HttpForm,
  title?: string,
): AiToolSpec {
  return {
    name,
    title: title || undefined,
    description,
    method: httpForm.method,
    path: httpForm.urlTemplate,
    params: fields.map(fieldToParam),
    headers: httpForm.headers.filter((h) => h.key.trim()),
    bodyContentType: httpForm.bodyContentType || undefined,
    outputs: httpForm.outputs
      .filter((o) => o.name.trim())
      .map((o) => ({ name: o.name, type: o.type, description: o.description })),
  };
}

/** 反向：把编辑器里某个字段还原成 ParamSpec。 */
export function fieldToParam(f: FieldDef): AiParamSpec {
  const p: AiParamSpec = {
    name: f.name,
    type: f.type,
    description: f.description,
    required: f.required,
    location: f.location,
  };
  if (f.type === 'string' && f.enumValues && f.enumValues.length) p.enumValues = f.enumValues;
  if (f.type === 'object') p.fields = (f.fields ?? []).map(fieldToParam);
  if (f.type === 'array') {
    p.itemType = f.itemType ?? 'string';
    if (f.itemType === 'object') p.itemFields = (f.itemFields ?? []).map(fieldToParam);
  }
  return p;
}
