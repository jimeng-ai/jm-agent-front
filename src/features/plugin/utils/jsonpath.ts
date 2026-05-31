import type { FieldType } from './schema';

/**
 * 与后端 PluginResponseExtractor 保持一致的 JSONPath 子集求值器（前端预览专用）。
 *
 * 支持：$ / $.a.b.c / $.a[0].b / $.items[*] / $.items[*].name（[*] 会逐项映射剩余路径）。
 * 不支持过滤、切片等复杂表达式——刻意与后端能力对齐，避免预览“能跑”而线上返回 null。
 */

export function inferType(v: unknown): FieldType {
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

function splitSegments(path: string): string[] {
  const segs: string[] = [];
  let cur = '';
  for (const c of path) {
    if (c === '.') {
      if (cur) {
        segs.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

function applySegments(node: unknown, segs: string[], idx: number): unknown {
  if (node === null || node === undefined) return null;
  if (idx >= segs.length) return node;

  const seg = segs[idx];
  let key = seg;
  let index: number | null = null;
  let wildcard = false;

  const b = seg.indexOf('[');
  if (b >= 0) {
    key = seg.slice(0, b);
    const e = seg.indexOf(']', b);
    if (e < 0) return null;
    const idxStr = seg.slice(b + 1, e).trim();
    if (idxStr === '*') wildcard = true;
    else {
      const n = Number(idxStr);
      if (!Number.isInteger(n)) return null;
      index = n;
    }
  }

  let cur: unknown = node;
  if (key) {
    cur =
      cur && typeof cur === 'object' && !Array.isArray(cur)
        ? (cur as Record<string, unknown>)[key]
        : undefined;
    if (cur === undefined || cur === null) return null;
  }

  if (wildcard) {
    if (!Array.isArray(cur)) return null;
    const out: unknown[] = [];
    for (const el of cur) {
      const v = applySegments(el, segs, idx + 1);
      if (v !== null && v !== undefined) out.push(v);
    }
    return out;
  }
  if (index !== null) {
    cur = Array.isArray(cur) ? (cur[index] ?? null) : null;
  }
  return applySegments(cur ?? null, segs, idx + 1);
}

/** 按后端规则对 JSON 求值；返回 null 表示未命中 */
export function evalJsonPath(json: unknown, path: string): unknown {
  const p = (path ?? '').trim();
  if (!p || p === '$') return json;
  let norm = p;
  if (norm.startsWith('$.')) norm = norm.slice(2);
  else if (norm.startsWith('$')) norm = norm.slice(1);
  return applySegments(json, splitSegments(norm), 0);
}

export interface ParsedOutput {
  name: string;
  type: FieldType;
  /** 顶层对象字段留空（默认 $.<name>）；顶层为数组时给出 $[*].<name> */
  path?: string;
  /** type=object 的子参数 */
  fields?: ParsedOutput[];
  /** type=array 的元素类型 */
  itemType?: FieldType;
  /** 元素为 object 时的子参数 */
  itemFields?: ParsedOutput[];
}

type ParseResult = { ok: true; rows: ParsedOutput[] } | { ok: false; error: string };

/** 由样例值递归推断一个参数（含 object 子字段、array 元素字段） */
function buildParsed(name: string, value: unknown): ParsedOutput {
  const type = inferType(value);
  const po: ParsedOutput = { name, type };
  if (type === 'object') {
    po.fields = Object.entries(value as Record<string, unknown>).map(([k, v]) => buildParsed(k, v));
  } else if (type === 'array') {
    const arr = value as unknown[];
    const firstObj = arr.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as
      | Record<string, unknown>
      | undefined;
    if (firstObj) {
      po.itemType = 'object';
      po.itemFields = Object.entries(firstObj).map(([k, v]) => buildParsed(k, v));
    } else {
      po.itemType = arr.length ? inferType(arr[0]) : 'string';
    }
  }
  return po;
}

/**
 * 「自动解析」：把一段样例响应解析成输出参数树。
 * - 顶层对象 → 逐个顶层键递归（object 展开子字段、array 元素为对象展开元素字段）
 * - 顶层为对象数组 → 取首个元素的字段，路径 $[*].<name>（逐项取值）
 */
export function parseSampleToOutputs(sample: string): ParseResult {
  if (!sample.trim()) return { ok: false, error: '请先粘贴样例响应' };
  let json: unknown;
  try {
    json = JSON.parse(sample);
  } catch (e) {
    return { ok: false, error: `不是合法 JSON：${(e as Error).message}` };
  }

  if (Array.isArray(json)) {
    const first = json.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as
      | Record<string, unknown>
      | undefined;
    if (!first) return { ok: false, error: '数组里没有对象元素，无法解析字段' };
    const rows = Object.entries(first).map(([k, v]) => ({ ...buildParsed(k, v), path: `$[*].${k}` }));
    return rows.length ? { ok: true, rows } : { ok: false, error: '未解析到任何字段' };
  }

  if (json && typeof json === 'object') {
    const rows = Object.entries(json as Record<string, unknown>).map(([k, v]) => buildParsed(k, v));
    return rows.length ? { ok: true, rows } : { ok: false, error: '未解析到任何字段' };
  }

  return { ok: false, error: '样例需要是 JSON 对象或对象数组' };
}
