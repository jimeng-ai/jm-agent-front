// auth_config 表单模型 ⇄ 后端 JSON（snake_case，部分嵌套）双向转换。
//
// 设计要点：
// - 把「写 JSON / 懂 JSONPath / 懂转义」的门槛消化在这里，组件只与扁平/直观的表单模型打交道。
// - 解析失败、或出现表单不认识的额外结构 → 落到 raw 模式（保留原文，不静默丢字段）。
// - token_path / expire_path 对后端是 JSONPath（$.data.token）；UI 展示成点号路径（data.token），
//   仅在序列化/反序列化边界互转。复杂 JSONPath（含过滤/通配）保持原样不强转。

import type { PluginAuthType } from '@/api/types';

export type AuthConfigMode = 'form' | 'raw';

export interface KvRow {
  key: string;
  value: string;
}

export interface ApiKeyForm {
  location: 'header' | 'query';
  key_name: string;
}

export interface HmacPlacement {
  type: 'header' | 'query';
  name: string;
}

export interface HmacForm {
  algorithm: 'HMAC_SHA256' | 'HMAC_SHA1' | 'MD5';
  encoding: 'hex' | 'base64';
  sign_template: string;
  placement: HmacPlacement;
  /** 可选：把时间戳/随机串也注入到某个 header/query（不填则不注入） */
  timestamp_field?: HmacPlacement;
  nonce_field?: HmacPlacement;
}

export interface OAuth2Form {
  token_url: string;
  scope: string;
  client_auth: 'body' | 'basic';
  default_ttl_sec?: number;
  safety_margin_sec?: number;
}

export interface TokenFetchForm {
  request: {
    method: 'POST' | 'GET' | 'PUT';
    url: string;
    content_type: string;
    headers: KvRow[];
    body: string;
  };
  /** 存 JSONPath（$.data.token）；UI 层用点号路径展示 */
  token_path: string;
  expire_path: string;
  expire_unit: 'sec' | 'ms';
  default_ttl_sec?: number;
  inject: {
    location: 'header' | 'query';
    name: string;
    prefix: string;
  };
}

export type AuthForm = ApiKeyForm | HmacForm | OAuth2Form | TokenFetchForm;

export interface ParsedAuthConfig {
  mode: AuthConfigMode;
  /** mode==='form' 时有效 */
  form?: AuthForm;
  /** mode==='raw' 时有效（原始 JSON 文本） */
  raw: string;
}

/** 哪些认证方式走结构化表单 */
export const FORM_AUTH_TYPES: PluginAuthType[] = ['API_KEY', 'HMAC', 'OAUTH2', 'TOKEN_FETCH'];

/** 能跑「测试获取」（服务端换 token）的认证方式 */
export const TESTABLE_AUTH_TYPES: PluginAuthType[] = ['OAUTH2', 'TOKEN_FETCH'];

// ───────────────────────── 路径互转 ─────────────────────────

/** JSONPath（$.data.token / $.items[0].x）→ 点号路径（data.token / items[0].x）；复杂表达式原样返回 */
export function jsonPathToDot(p?: string): string {
  if (!p) return '';
  if (/[*?@()]/.test(p)) return p; // 含通配/过滤，不强转
  return p.replace(/^\$\.?/, '');
}

/** 点号路径 → JSONPath；已是 $ 开头或含复杂表达式则原样返回 */
export function dotToJsonPath(p?: string): string {
  if (!p) return '';
  const t = p.trim();
  if (t === '' || t.startsWith('$')) return t;
  if (/[*?@()]/.test(t)) return t;
  return '$.' + t.replace(/^\./, '');
}

/** 由对象树点选路径（["data","token"] / ["items",0,"x"]）构造 JSONPath */
export function segmentsToJsonPath(segments: (string | number)[]): string {
  return segments.reduce<string>((acc, seg) => {
    return typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${seg}`;
  }, '$');
}

// ───────────────────────── 默认表单 ─────────────────────────

export function defaultForm(authType: PluginAuthType): AuthForm {
  switch (authType) {
    case 'API_KEY':
      return { location: 'header', key_name: 'X-API-Key' };
    case 'HMAC':
      return {
        algorithm: 'HMAC_SHA256',
        encoding: 'hex',
        sign_template: '',
        placement: { type: 'header', name: 'X-Sign' },
      };
    case 'OAUTH2':
      return { token_url: '', scope: '', client_auth: 'body' };
    case 'TOKEN_FETCH':
    default:
      return {
        request: {
          method: 'POST',
          url: '',
          content_type: 'application/json',
          headers: [],
          body: '',
        },
        token_path: '$.data.token',
        expire_path: '$.data.expire',
        expire_unit: 'sec',
        inject: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
      };
  }
}

// ───────────────────────── 解析 raw JSON → 表单 ─────────────────────────

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, def = ''): string {
  return v == null ? def : String(v);
}

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** 已知顶层 key —— 出现集合外的 key 视为「表单覆盖不全」，落 raw 以免丢字段 */
const KNOWN_KEYS: Record<PluginAuthType, string[]> = {
  NONE: [],
  BEARER: [],
  BASIC: [],
  API_KEY: ['location', 'key_name'],
  HMAC: ['algorithm', 'encoding', 'sign_template', 'placement', 'timestamp_field', 'nonce_field'],
  OAUTH2: ['token_url', 'scope', 'client_auth', 'default_ttl_sec', 'safety_margin_sec'],
  TOKEN_FETCH: [
    'token_request',
    'token_path',
    'expire_path',
    'expire_unit',
    'default_ttl_sec',
    'safety_margin_sec',
    'inject',
  ],
};

function hasUnknownKeys(authType: PluginAuthType, obj: Json): boolean {
  const known = KNOWN_KEYS[authType];
  return Object.keys(obj).some((k) => !known.includes(k));
}

function placementFrom(v: unknown, def: HmacPlacement): HmacPlacement {
  if (!isPlainObject(v)) return def;
  const type = asStr(v.type, def.type) === 'query' ? 'query' : 'header';
  return { type, name: asStr(v.name, def.name) };
}

function toForm(authType: PluginAuthType, obj: Json): AuthForm | null {
  if (hasUnknownKeys(authType, obj)) return null;
  switch (authType) {
    case 'API_KEY':
      return {
        location: asStr(obj.location, 'header') === 'query' ? 'query' : 'header',
        key_name: asStr(obj.key_name, 'X-API-Key'),
      };
    case 'HMAC': {
      const base = defaultForm('HMAC') as HmacForm;
      const f: HmacForm = {
        algorithm: ['HMAC_SHA256', 'HMAC_SHA1', 'MD5'].includes(asStr(obj.algorithm))
          ? (asStr(obj.algorithm) as HmacForm['algorithm'])
          : 'HMAC_SHA256',
        encoding: asStr(obj.encoding, 'hex') === 'base64' ? 'base64' : 'hex',
        sign_template: asStr(obj.sign_template),
        placement: placementFrom(obj.placement, base.placement),
      };
      if (obj.timestamp_field)
        f.timestamp_field = placementFrom(obj.timestamp_field, base.placement);
      if (obj.nonce_field) f.nonce_field = placementFrom(obj.nonce_field, base.placement);
      return f;
    }
    case 'OAUTH2': {
      const f: OAuth2Form = {
        token_url: asStr(obj.token_url),
        scope: asStr(obj.scope),
        client_auth: asStr(obj.client_auth, 'body') === 'basic' ? 'basic' : 'body',
      };
      const ttl = asNum(obj.default_ttl_sec);
      const margin = asNum(obj.safety_margin_sec);
      if (ttl != null) f.default_ttl_sec = ttl;
      if (margin != null) f.safety_margin_sec = margin;
      return f;
    }
    case 'TOKEN_FETCH': {
      const tr = isPlainObject(obj.token_request) ? obj.token_request : {};
      const headersObj = isPlainObject(tr.headers) ? tr.headers : {};
      const headers: KvRow[] = Object.entries(headersObj).map(([key, v]) => ({
        key,
        value: asStr(v),
      }));
      const def = defaultForm('TOKEN_FETCH') as TokenFetchForm;
      const inj = isPlainObject(obj.inject) ? obj.inject : {};
      const f: TokenFetchForm = {
        request: {
          method: (['POST', 'GET', 'PUT'].includes(asStr(tr.method, 'POST'))
            ? asStr(tr.method, 'POST')
            : 'POST') as TokenFetchForm['request']['method'],
          url: asStr(tr.url),
          content_type: asStr(tr.content_type, 'application/json'),
          headers,
          body: asStr(tr.body),
        },
        token_path: asStr(obj.token_path, def.token_path),
        expire_path: asStr(obj.expire_path),
        expire_unit: asStr(obj.expire_unit, 'sec') === 'ms' ? 'ms' : 'sec',
        inject: {
          location: asStr(inj.location, 'header') === 'query' ? 'query' : 'header',
          name: asStr(inj.name, 'Authorization'),
          prefix: inj.prefix == null ? 'Bearer ' : asStr(inj.prefix),
        },
      };
      const ttl = asNum(obj.default_ttl_sec);
      if (ttl != null) f.default_ttl_sec = ttl;
      return f;
    }
    default:
      return null;
  }
}

/** 解析已存的 authConfig 字符串：空→空表单；合法且结构匹配→表单；否则→raw（保留原文） */
export function parseAuthConfig(authType: PluginAuthType, raw?: string): ParsedAuthConfig {
  const text = raw ?? '';
  if (text.trim() === '') {
    return { mode: 'form', form: defaultForm(authType), raw: '' };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { mode: 'raw', raw: text };
  }
  if (!isPlainObject(obj)) {
    return { mode: 'raw', raw: text };
  }
  const form = toForm(authType, obj);
  if (!form) {
    return { mode: 'raw', raw: text };
  }
  return { mode: 'form', form, raw: text };
}

// ───────────────────────── 序列化 表单 → raw JSON ─────────────────────────

function pruneEmpty<T extends Json>(obj: T): T {
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v === '' || v === undefined) delete obj[k];
  });
  return obj;
}

export function serializeAuthConfig(authType: PluginAuthType, form: AuthForm): string {
  let out: Json;
  switch (authType) {
    case 'API_KEY': {
      const f = form as ApiKeyForm;
      out = { location: f.location, key_name: f.key_name };
      break;
    }
    case 'HMAC': {
      const f = form as HmacForm;
      out = pruneEmpty({
        algorithm: f.algorithm,
        encoding: f.encoding,
        sign_template: f.sign_template,
        placement: { type: f.placement.type, name: f.placement.name },
        timestamp_field: f.timestamp_field
          ? { type: f.timestamp_field.type, name: f.timestamp_field.name }
          : undefined,
        nonce_field: f.nonce_field
          ? { type: f.nonce_field.type, name: f.nonce_field.name }
          : undefined,
      });
      break;
    }
    case 'OAUTH2': {
      const f = form as OAuth2Form;
      out = pruneEmpty({
        token_url: f.token_url,
        scope: f.scope,
        client_auth: f.client_auth,
        default_ttl_sec: f.default_ttl_sec,
        safety_margin_sec: f.safety_margin_sec,
      });
      break;
    }
    case 'TOKEN_FETCH':
    default: {
      const f = form as TokenFetchForm;
      const headers: Json = {};
      f.request.headers.forEach((r) => {
        if (r.key.trim() !== '') headers[r.key] = r.value;
      });
      const tokenRequest = pruneEmpty({
        method: f.request.method,
        url: f.request.url,
        content_type: f.request.content_type,
        body: f.request.body,
      } as Json);
      if (Object.keys(headers).length > 0) tokenRequest.headers = headers;
      out = pruneEmpty({
        token_request: tokenRequest,
        token_path: dotToJsonPath(jsonPathToDot(f.token_path)),
        expire_path: f.expire_path ? dotToJsonPath(jsonPathToDot(f.expire_path)) : '',
        expire_unit: f.expire_unit,
        default_ttl_sec: f.default_ttl_sec,
        inject: { location: f.inject.location, name: f.inject.name, prefix: f.inject.prefix },
      });
      break;
    }
  }
  return JSON.stringify(out);
}
