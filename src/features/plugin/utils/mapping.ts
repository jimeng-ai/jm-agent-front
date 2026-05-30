import { nanoid } from 'nanoid';
import type { FieldDef, FieldType, ParamLocation } from './schema';
import type { HttpMethod, PluginHttpMapping } from '@/api/types';

/**
 * 入参字段(含位置) + 友好表单  ⇄  后端 PluginHttpMapping 模型 的双向组装。
 *
 * 设计要点：
 * - 用户在表单里写「短名」占位 {{city}}，保存时统一转成后端要求的命名空间占位
 *   {{input.city}}（后端 PluginTemplateRenderer 只认 input./secrets./env./meta.）。
 * - Query 参数由 location==='query' 的入参自动拼成 queryTemplate；
 *   Body 参数由 location==='body' 的入参自动拼成 bodyTemplate；
 *   Path 参数由用户写进 URL 模板的 {{name}} 占位承载。
 */

export const LOCATION_OPTIONS: { label: string; value: ParamLocation }[] = [
  { label: 'Query 参数', value: 'query' },
  { label: 'Body 参数', value: 'body' },
  { label: 'Path 路径', value: 'path' },
];

export const DEFAULT_BODY_MIME = 'application/json';

export const BODY_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: '不带 Body', value: '' },
  { label: 'JSON (application/json)', value: 'application/json' },
  { label: '表单 (x-www-form-urlencoded)', value: 'application/x-www-form-urlencoded' },
  { label: '表单 (multipart/form-data)', value: 'multipart/form-data' },
];

export const COMMON_HEADER_KEYS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Accept-Language',
  'User-Agent',
  'X-Api-Key',
  'X-Request-Id',
];

export const COMMON_HEADER_VALUES: Record<string, string[]> = {
  'Content-Type': [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
  ],
  Accept: ['application/json', '*/*', 'text/plain'],
  'Accept-Language': ['zh-CN', 'en-US'],
  Authorization: ['Bearer {{secrets.token}}'],
};

/** 一键添加的常用请求头预设 */
export const COMMON_HEADER_PRESETS: { label: string; row: HeaderRow }[] = [
  { label: 'Content-Type: JSON', row: { key: 'Content-Type', value: 'application/json' } },
  {
    label: 'Content-Type: 表单',
    row: { key: 'Content-Type', value: 'application/x-www-form-urlencoded' },
  },
  { label: 'Accept: JSON', row: { key: 'Accept', value: 'application/json' } },
  { label: 'Authorization: Bearer', row: { key: 'Authorization', value: 'Bearer {{secrets.token}}' } },
];

export interface OutputField {
  id: string;
  name: string;
  path: string; // JSONPath，如 $.result.realtime.temperature
  type: FieldType;
  description?: string;
}

export interface HeaderRow {
  key: string;
  value: string;
}

/** 表单内部使用的友好结构（占位符均为短名 {{name}}） */
export interface HttpForm {
  method: HttpMethod;
  urlTemplate: string;
  headers: HeaderRow[];
  bodyContentType: string; // 真实 MIME，'' 表示不带 body
  outputs: OutputField[];
}

export function emptyHttpForm(): HttpForm {
  return { method: 'GET', urlTemplate: '', headers: [], bodyContentType: '', outputs: [] };
}

const SHORT_PH = /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g; // {{name}}（无命名空间）

/** 短名占位 → 后端命名空间占位：{{city}} → {{input.city}}（仅对已声明入参生效） */
export function toBackendTemplate(tpl: string, inputNames: Set<string>): string {
  if (!tpl) return tpl;
  return tpl.replace(SHORT_PH, (m, n) => (inputNames.has(n) ? `{{input.${n}}}` : m));
}

/** 反向：{{input.city}} → {{city}}，便于在表单里展示 */
export function toDisplayTemplate(tpl: string): string {
  if (!tpl) return tpl;
  return tpl.replace(/\{\{\s*input\.([a-zA-Z_]\w*)\s*\}\}/g, (_m, n) => `{{${n}}}`);
}

function inputNamesFromTemplate(tpl: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*input\.([a-zA-Z_]\w*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) out.push(m[1]);
  return out;
}

function needsJsonQuote(t: FieldType): boolean {
  return t === 'string' || t === 'enum';
}

export function serializeOutputs(outputs: OutputField[]): string | undefined {
  const valid = outputs.filter((o) => o.name.trim() && o.path.trim());
  if (valid.length === 0) return undefined;
  return JSON.stringify(
    valid.map((o) => ({
      name: o.name.trim(),
      path: o.path.trim(),
      type: o.type,
      desc: o.description?.trim() || undefined,
    })),
  );
}

export function parseOutputs(raw?: string): OutputField[] {
  if (!raw || !raw.trim()) return [];
  const s = raw.trim();
  if (!s.startsWith('[')) return []; // 旧版单条 JSONPath，无既有数据，忽略
  try {
    const arr = JSON.parse(s) as Array<{ name?: string; path?: string; type?: string; desc?: string }>;
    if (!Array.isArray(arr)) return [];
    return arr.map((o) => ({
      id: nanoid(),
      name: o.name ?? '',
      path: o.path ?? '',
      type: (o.type as FieldType) ?? 'string',
      description: o.desc,
    }));
  } catch {
    return [];
  }
}

/** 由「入参字段(含位置) + 表单」组装出后端可用的 mapping 模型 */
export function buildMapping(fields: FieldDef[], form: HttpForm): PluginHttpMapping {
  const inputNames = new Set(fields.map((f) => f.name).filter(Boolean));
  const noBody = form.method === 'GET' || form.method === 'DELETE';

  const queryFields = fields.filter((f) => f.name && (f.location ?? 'query') === 'query');
  const bodyFields = fields.filter((f) => f.name && f.location === 'body');

  const queryTemplate: Record<string, string> = {};
  queryFields.forEach((f) => {
    queryTemplate[f.name] = `{{input.${f.name}}}`;
  });

  let bodyTemplate: string | undefined;
  let bodyContentType: string | undefined = form.bodyContentType || undefined;
  if (!noBody && bodyFields.length > 0) {
    if (!bodyContentType) bodyContentType = DEFAULT_BODY_MIME;
    if (bodyContentType.includes('json')) {
      bodyTemplate =
        '{' +
        bodyFields
          .map((f) => {
            const ph = `{{input.${f.name}}}`;
            return `${JSON.stringify(f.name)}: ${needsJsonQuote(f.type) ? `"${ph}"` : ph}`;
          })
          .join(', ') +
        '}';
    } else {
      bodyTemplate = bodyFields
        .map((f) => `${encodeURIComponent(f.name)}={{input.${f.name}}}`)
        .join('&');
    }
  }

  const headersTemplate: Record<string, string> = {};
  form.headers.forEach((h) => {
    const key = h.key.trim();
    if (key) headersTemplate[key] = toBackendTemplate(h.value, inputNames);
  });

  return {
    method: form.method,
    urlTemplate: toBackendTemplate(form.urlTemplate, inputNames),
    headersTemplate,
    queryTemplate,
    bodyTemplate: noBody ? undefined : bodyTemplate,
    bodyContentType: noBody ? undefined : bodyContentType,
    responseExtract: serializeOutputs(form.outputs),
  };
}

export interface Disassembled {
  form: HttpForm;
  /** 按字段名推断出的位置 */
  locations: Record<string, ParamLocation>;
}

/** 由后端 mapping 模型反推出友好表单 + 各入参的位置 */
export function disassembleMapping(m?: PluginHttpMapping): Disassembled {
  const mapping = m ?? ({ method: 'GET', urlTemplate: '' } as PluginHttpMapping);
  const form: HttpForm = {
    method: mapping.method ?? 'GET',
    urlTemplate: toDisplayTemplate(mapping.urlTemplate ?? ''),
    headers: Object.entries(mapping.headersTemplate ?? {}).map(([key, value]) => ({
      key,
      value: toDisplayTemplate(String(value)),
    })),
    bodyContentType: mapping.bodyContentType ?? '',
    outputs: parseOutputs(mapping.responseExtract),
  };

  const locations: Record<string, ParamLocation> = {};
  Object.keys(mapping.queryTemplate ?? {}).forEach((k) => {
    locations[k] = 'query';
  });
  inputNamesFromTemplate(mapping.bodyTemplate ?? '').forEach((n) => {
    locations[n] = 'body';
  });
  inputNamesFromTemplate(mapping.urlTemplate ?? '').forEach((n) => {
    locations[n] = 'path';
  });
  return { form, locations };
}

/** 把推断出的位置回填到入参字段上（顶层字段） */
export function applyLocations(
  fields: FieldDef[],
  locations: Record<string, ParamLocation>,
): FieldDef[] {
  return fields.map((f) => ({
    ...f,
    location: locations[f.name] ?? f.location ?? 'query',
  }));
}

/** 生成「请求预览」文本，供表单实时展示，提升可读性 */
export function buildPreview(fields: FieldDef[], form: HttpForm): { line: string; body?: string } {
  const queryFields = fields.filter((f) => f.name && (f.location ?? 'query') === 'query');
  const url = form.urlTemplate || '(未填写 URL)';
  const qs = queryFields.map((f) => `${f.name}={{${f.name}}}`).join('&');
  const line = `${form.method} ${url}${qs ? (url.includes('?') ? '&' : '?') + qs : ''}`;
  const mapping = buildMapping(fields, form);
  return { line, body: mapping.bodyTemplate };
}
