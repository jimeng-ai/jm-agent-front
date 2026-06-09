import { nanoid } from 'nanoid';
import { isFixedField, type FieldDef, type FieldType, type ParamLocation } from './schema';
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
  { label: 'query_param', value: 'query' },
  { label: 'body_param', value: 'body' },
  { label: 'path_param', value: 'path' },
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
  {
    label: 'Authorization: Bearer',
    row: { key: 'Authorization', value: 'Bearer {{secrets.token}}' },
  },
];

export interface OutputField {
  id: string;
  name: string;
  /** 来源 JSONPath 覆盖（仅顶层有意义）；留空则默认取 $.<name> */
  path: string;
  type: FieldType;
  description?: string;
  /** 仅作元信息：该字段是否一定出现在响应里 */
  required?: boolean;
  /** type=object 的子参数（仅描述返回对象的结构，后端按整段对象返回） */
  fields?: OutputField[];
  /** type=array 的元素类型 */
  itemType?: Exclude<FieldType, 'array'>;
  /** 元素为 object 时的子参数 */
  itemFields?: OutputField[];
}

/** 输出字段最终生效的来源路径：自定义优先，否则按字段名取顶层 $.<name> */
export function outputPath(o: OutputField): string {
  const p = o.path?.trim();
  return p || `$.${o.name.trim()}`;
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

/**
 * 把模板里的短名占位 {{name}} 逐个交给 replace() 决定替换成什么：
 * - 普通入参 → {{input.name}}（后端运行时再填值）
 * - 固定值入参 → 直接替换成字面量
 * - 未声明（如 {{secrets.x}} 含点不匹配）→ 原样保留
 */
export function applyTemplateVars(
  tpl: string,
  replace: (name: string) => string | undefined,
): string {
  if (!tpl) return tpl;
  return tpl.replace(SHORT_PH, (m, n) => replace(n) ?? m);
}

/** 反向：{{input.city}} → {{city}}，便于在表单里展示 */
export function toDisplayTemplate(tpl: string): string {
  if (!tpl) return tpl;
  return tpl.replace(/\{\{\s*input\.([a-zA-Z_]\w*)\s*\}\}/g, (_m, n) => `{{${n}}}`);
}

/** 固定值按类型转成 JS 值（用于 JSON body 时区分数字/布尔/字符串） */
function coerceLiteral(value: string, type: FieldType): unknown {
  const v = (value ?? '').trim();
  if (type === 'number') {
    const n = Number(v);
    return v !== '' && Number.isFinite(n) ? n : v;
  }
  if (type === 'boolean') {
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  }
  return v;
}

/** 固定值用于 query / path / form 的字符串形态（非 JSON，统一取原始字符串） */
function fixedAsString(f: FieldDef): string {
  return String(coerceLiteral(f.defaultValue ?? '', f.type));
}

function inputNamesFromTemplate(tpl: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*input\.([a-zA-Z_]\w*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) out.push(m[1]);
  return out;
}

function needsJsonQuote(t: FieldType): boolean {
  return t === 'string';
}

/** 结构化类型（对象 / 数组）：只能作为 JSON body 发送，放到 query/path 没有意义 */
export function isComplexType(t: FieldType): boolean {
  return t === 'object' || t === 'array';
}

/** 字段最终生效的传入位置：复杂类型强制 body，其余取字段自身 location（默认 query） */
export function effectiveLocation(f: FieldDef): ParamLocation {
  if (isComplexType(f.type)) return 'body';
  return f.location ?? 'query';
}

interface OutputWire {
  name?: string;
  path?: string;
  type?: string;
  desc?: string;
  required?: boolean;
  fields?: OutputWire[];
  itemType?: string;
  itemFields?: OutputWire[];
}

function serializeOne(o: OutputField, topLevel: boolean): OutputWire {
  const w: OutputWire = { name: o.name.trim(), type: o.type };
  if (topLevel) w.path = outputPath(o); // 顶层才有来源路径；子字段在返回对象内部
  if (o.description?.trim()) w.desc = o.description.trim();
  if (o.required) w.required = true;
  if (o.type === 'object') {
    w.fields = (o.fields ?? []).filter((c) => c.name.trim()).map((c) => serializeOne(c, false));
  }
  if (o.type === 'array') {
    w.itemType = o.itemType ?? 'string';
    if (o.itemType === 'object') {
      w.itemFields = (o.itemFields ?? [])
        .filter((c) => c.name.trim())
        .map((c) => serializeOne(c, false));
    }
  }
  return w;
}

export function serializeOutputs(outputs: OutputField[]): string | undefined {
  const valid = outputs.filter((o) => o.name.trim());
  if (valid.length === 0) return undefined;
  return JSON.stringify(valid.map((o) => serializeOne(o, true)));
}

function parseOne(w: OutputWire, topLevel: boolean): OutputField {
  const name = w.name ?? '';
  const type = (w.type as FieldType) ?? 'string';
  const rawPath = (w.path ?? '').trim();
  // 与默认 $.<name> 相同的视为「未自定义」，路径框留空更清爽
  const path = topLevel && rawPath !== `$.${name}` ? rawPath : '';
  const o: OutputField = {
    id: nanoid(),
    name,
    path,
    type,
    description: w.desc,
    required: !!w.required,
  };
  if (type === 'object') {
    o.fields = Array.isArray(w.fields) ? w.fields.map((c) => parseOne(c, false)) : [];
  }
  if (type === 'array') {
    o.itemType = (w.itemType as Exclude<FieldType, 'array'>) ?? 'string';
    if (o.itemType === 'object') {
      o.itemFields = Array.isArray(w.itemFields) ? w.itemFields.map((c) => parseOne(c, false)) : [];
    }
  }
  return o;
}

export function parseOutputs(raw?: string): OutputField[] {
  if (!raw || !raw.trim()) return [];
  const s = raw.trim();
  if (!s.startsWith('[')) return []; // 旧版单条 JSONPath，无既有数据，忽略
  try {
    const arr = JSON.parse(s) as OutputWire[];
    if (!Array.isArray(arr)) return [];
    return arr.map((w) => parseOne(w, true));
  } catch {
    return [];
  }
}

/** 由「入参字段(含位置) + 表单」组装出后端可用的 mapping 模型 */
export function buildMapping(fields: FieldDef[], form: HttpForm): PluginHttpMapping {
  const declared = fields.filter((f) => f.name);
  const noBody = form.method === 'GET' || form.method === 'DELETE';

  // url / header 里的 {{name}}：固定值 → 字面量；普通入参 → {{input.name}}
  const byName = new Map(declared.map((f) => [f.name, f] as const));
  const replaceVar = (n: string): string | undefined => {
    const f = byName.get(n);
    if (!f) return undefined; // 未声明（如 secrets/env）保留原样
    return isFixedField(f) ? fixedAsString(f) : `{{input.${n}}}`;
  };

  // 对象/数组等结构化参数只能进 body：query/path 无法承载 JSON 结构（会被序列化成乱码）。
  // 即便字段的 location 仍是历史遗留的 query/path，这里也强制按 body 处理。
  const queryFields = declared.filter((f) => effectiveLocation(f) === 'query');
  const bodyFields = declared.filter((f) => effectiveLocation(f) === 'body');

  const queryTemplate: Record<string, string> = {};
  queryFields.forEach((f) => {
    queryTemplate[f.name] = isFixedField(f) ? fixedAsString(f) : `{{input.${f.name}}}`;
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
            const key = JSON.stringify(f.name);
            if (isFixedField(f)) {
              return `${key}: ${JSON.stringify(coerceLiteral(f.defaultValue ?? '', f.type))}`;
            }
            const ph = `{{input.${f.name}}}`;
            return `${key}: ${needsJsonQuote(f.type) ? `"${ph}"` : ph}`;
          })
          .join(', ') +
        '}';
    } else {
      bodyTemplate = bodyFields
        .map((f) =>
          isFixedField(f)
            ? `${encodeURIComponent(f.name)}=${encodeURIComponent(fixedAsString(f))}`
            : `${encodeURIComponent(f.name)}={{input.${f.name}}}`,
        )
        .join('&');
    }
  }

  const headersTemplate: Record<string, string> = {};
  form.headers.forEach((h) => {
    const key = h.key.trim();
    if (key) headersTemplate[key] = applyTemplateVars(h.value, replaceVar);
  });

  return {
    method: form.method,
    urlTemplate: applyTemplateVars(form.urlTemplate, replaceVar),
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

/**
 * 把推断出的位置回填到入参字段上（顶层字段）。
 * 字段自带 location（来自 x-fixed-params 的固定字段）优先，其次按 mapping 推断，最后默认 query。
 */
export function applyLocations(
  fields: FieldDef[],
  locations: Record<string, ParamLocation>,
): FieldDef[] {
  return fields.map((f) => ({
    ...f,
    location: f.location ?? locations[f.name] ?? 'query',
  }));
}

/**
 * 拼接最终 URL（与后端 PluginHttpInvoker.resolveUrl 一致）：
 * urlTemplate 是绝对地址则原样；否则视为路径，前缀插件 baseUrl。
 */
export function resolveUrl(baseUrl: string | undefined, url: string): string {
  const u = (url ?? '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  let base = (baseUrl ?? '').trim();
  if (!base) return u;
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!u) return base;
  return base + (u.startsWith('/') ? u : '/' + u);
}

/** 生成「请求预览」文本，供表单实时展示，提升可读性 */
export function buildPreview(
  fields: FieldDef[],
  form: HttpForm,
  baseUrl?: string,
): { line: string; body?: string } {
  const declared = fields.filter((f) => f.name);
  const queryFields = declared.filter((f) => effectiveLocation(f) === 'query');
  // path 固定值在预览里替换成字面量，便于直观确认
  const pathOnly = (form.urlTemplate || '').replace(SHORT_PH, (m, n) => {
    const f = declared.find((x) => x.name === n);
    return f && isFixedField(f) ? fixedAsString(f) : m;
  });
  const url = form.urlTemplate ? resolveUrl(baseUrl, pathOnly) : '(未填写 URL)';
  const qs = queryFields
    .map((f) =>
      isFixedField(f)
        ? `${f.name}=${encodeURIComponent(fixedAsString(f))}`
        : `${f.name}={{${f.name}}}`,
    )
    .join('&');
  const line = `${form.method} ${url}${qs ? (url.includes('?') ? '&' : '?') + qs : ''}`;
  const mapping = buildMapping(fields, form);
  return { line, body: mapping.bodyTemplate };
}
