import dayjs from 'dayjs';
import type {
  ConnectorSemanticRow,
  SemanticEvidence,
  SemanticRowStatus,
  SemanticScope,
  SemanticSource,
  SemanticStatus,
  SemanticVerified,
} from './types';

/**
 * 语义层的取值表与展示口径。
 *
 * 单独成文件（而不是塞进抽屉组件）：列表页要用**连接级**状态映射，抽屉要用**行级**映射，
 * 两处各写一份必然会漂。而这类漂移是静默的——漏掉一个枚举值，界面上就是一格空白，不报错。
 *
 * 三条贯穿本文件的规矩：
 * 1. **每个映射都必须有兜底分支**。后端将来多一个值，这里要退化成「未知（XXX）」而不是空白。
 * 2. **NOT_APPLICABLE 不是错误**，配色上必须和 FAILED 分开（见 STATUS_META 的注释）。
 * 3. **source=HUMAN 要看得见**。它是「这句话能不能当真」的唯一判据，而平台不提供编辑入口，
 *    管理台这一眼是任何人唯一一次可能发现「口径写错了」的机会。
 */

// ---------------------------------------------------------------------------
// 连接级：语义层推导状态
// ---------------------------------------------------------------------------

export interface SemanticStatusMeta {
  label: string;
  /** antd Tag 的 color；留空走默认灰。 */
  color?: string;
  /** antd Alert 的 type，抽屉顶部那条横幅用。 */
  alert: 'info' | 'success' | 'warning' | 'error';
  /** 鼠标悬停/横幅描述里那句解释。要说清「现在该做什么」，不是复述状态名。 */
  hint: string;
}

const STATUS_META: Record<SemanticStatus, SemanticStatusMeta> = {
  NONE: {
    label: '未生成',
    alert: 'info',
    hint: '还没有生成过说明书。新建连接时会自动推一次；这里是空的，通常是推导开关关着、或者建连那次派发没成。',
  },
  RUNNING: {
    label: '生成中',
    color: 'processing',
    alert: 'info',
    hint: '推导正在后台跑。首次推导要先把客户库的结构拉一遍再叫一次模型，几十秒起步。',
  },
  READY: {
    label: '已生成',
    color: 'green',
    alert: 'success',
    hint: '模型现在能读到这条连接的说明书（表用途 / 字段含义 / 表关系 / 业务口径）。',
  },
  FAILED: {
    label: '失败',
    color: 'red',
    alert: 'error',
    hint: '推导没跑成。连接本身照常可用——语义层是叠加上去的注解，不是连接的前置条件；但模型此刻只能靠表名和列名猜。',
  },
  // ★ 刻意不是红色，也刻意不是 error。这种连接器不提供结构自描述（今天的 HTTP 就是，
  //   它只声明 INVOKE / HEALTH），没有结构可推，重跑也不会变。
  //   标成红色会训练人忽略这个字段：一条健康的 HTTP 连接显示「失败」，人第一反应是去修一个没坏的东西，
  //   修不动几次之后，真正 FAILED 的那几条也不会有人看了。
  NOT_APPLICABLE: {
    label: '不适用',
    alert: 'info',
    hint: '这种连接器不提供结构自描述（如 HTTP 接口），没有结构可推，语义层对它本来就不适用。这不是错误，重新生成也不会变。',
  },
};

/** 认不出来的值（含 undefined：后端比前端旧）一律退化成「未知」，绝不留空白。 */
export function semanticStatusMeta(v?: string | null): SemanticStatusMeta {
  const hit = v ? STATUS_META[v as SemanticStatus] : undefined;
  if (hit) return hit;
  if (!v) {
    return {
      label: '未知',
      alert: 'info',
      hint: '这个后端版本还没有返回语义层状态。',
    };
  }
  return {
    label: `未知（${v}）`,
    alert: 'warning',
    hint: '后端返回了本页还不认识的状态值，前端需要补一条映射。',
  };
}

// ---------------------------------------------------------------------------
// 行级：scope / source / evidence / verified / status
// ---------------------------------------------------------------------------

export interface ScopeMeta {
  label: string;
  /** 这一组是干什么的，写在分组标题下面。 */
  desc: string;
}

const SCOPE_META: Record<SemanticScope, ScopeMeta> = {
  METRIC: {
    label: '业务口径',
    desc: '「销售额要不要减退款」这类问题的答案。只能由人在对话里答出来，平台不会自己编——所以这一组全是 HUMAN。',
  },
  CAVEAT: {
    label: '待澄清的歧义',
    desc: '推导时发现说不准的地方，模型下次遇到会主动问人。有人答了之后它会变成上面的「业务口径」。',
  },
  OBJECT: { label: '表用途', desc: '这张表是干什么的。' },
  FIELD: { label: '字段含义', desc: '这一列是什么意思。★ 它是被模型当事实读的，错了没有任何地方看得出来。' },
  JOIN: {
    label: '表关系',
    desc: '两张表怎么连。★ 现阶段没有采样验证，每一条都只是推测——join 前要自己核。',
  },
};

/** 分组顺序：人要看的排前面。METRIC / CAVEAT 是人的战场，下面三组是机器的批量产出。 */
export const SCOPE_ORDER: SemanticScope[] = ['METRIC', 'CAVEAT', 'OBJECT', 'FIELD', 'JOIN'];

export function scopeMeta(v?: string | null): ScopeMeta {
  const hit = v ? SCOPE_META[v as SemanticScope] : undefined;
  return hit ?? { label: v ? `未知分类（${v}）` : '未分类', desc: '本页还不认识这个 scope。' };
}

export interface SemanticGroup {
  scope: string;
  meta: ScopeMeta;
  rows: ConnectorSemanticRow[];
}

/**
 * 按 scope 分组，并按 SCOPE_ORDER 排序。
 *
 * 认不出来的 scope **不丢弃**，挂在最后单独成组：丢掉了没有任何人会发现。
 */
export function groupByScope(rows: ConnectorSemanticRow[]): SemanticGroup[] {
  const buckets = new Map<string, ConnectorSemanticRow[]>();
  for (const r of rows) {
    const key = r.scope || 'UNKNOWN';
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  const out: SemanticGroup[] = [];
  for (const s of SCOPE_ORDER) {
    const list = buckets.get(s);
    if (list?.length) {
      out.push({ scope: s, meta: scopeMeta(s), rows: list });
      buckets.delete(s);
    }
  }
  for (const [scope, list] of buckets) {
    out.push({ scope, meta: scopeMeta(scope), rows: list });
  }
  return out;
}

export interface TagMeta {
  label: string;
  color?: string;
  hint: string;
}

/**
 * 来源。★ 本抽屉最重要的一格。
 *
 * 人答的口径和机器的推断长得一样，就没有人会去核其中任何一条；而平台**没有编辑入口**，
 * 这里是唯一能看出「这条口径是谁说的」的地方。所以 HUMAN 给紫色实心标签 + 回答人 + 时间，
 * 机器推断给最轻的灰色。
 */
const SOURCE_META: Record<SemanticSource, TagMeta> = {
  HUMAN: {
    label: '人工确认',
    color: 'purple',
    hint: '业务方在对话里亲口答的口径。重新生成不会动它（后端只删 source=INFERRED 的行）。要改只能在对话里重新答一次，那会留痕。',
  },
  IMPORTED: {
    label: '库注释',
    color: 'blue',
    hint: '直接采信客户库里的注释，属于一手事实。重新生成同样不动它。',
  },
  INFERRED: {
    label: '机器推断',
    hint: '模型看着表名、列名和注释推出来的，没有人确认过。「重新生成」覆盖的就是这一类。',
  },
};

export function sourceMeta(v?: string | null): TagMeta {
  const hit = v ? SOURCE_META[v as SemanticSource] : undefined;
  return hit ?? { label: v ? `未知来源（${v}）` : '来源不明', hint: '本页还不认识这个 source 取值。' };
}

export function isHuman(r: ConnectorSemanticRow): boolean {
  return r.source === 'HUMAN';
}

const EVIDENCE_META: Record<SemanticEvidence, TagMeta> = {
  COMMENT: { label: '库注释', color: 'blue', hint: '依据是客户库里写的注释。' },
  DATA: { label: '数据采样', color: 'green', hint: '依据是真实数据的取值分布。' },
  NAME: { label: '命名推断', color: 'orange', hint: '依据只有表名/列名的写法，没有别的旁证。' },
  GUESS: { label: '无依据', color: 'red', hint: '没有任何外部依据。推导时这类行本来会被丢掉，出现在这里要当心。' },
};

/**
 * 依据。**必须连 source 一起判**。
 *
 * ★ 后端给人答的口径写的是 `evidence=GUESS`（「人说的」既不是注释也不是数据）。
 * 照着枚举渲染成「无依据 / 纯猜」，就等于把一条**业务方亲口确认过**的口径标成瞎猜——
 * 这是本页最容易犯、且看不出来的一个错。
 */
export function evidenceMeta(r: ConnectorSemanticRow): TagMeta {
  if (isHuman(r)) {
    return {
      label: '人给的定义',
      color: 'purple',
      hint: '这条口径的依据是「业务方说的」——数据库里本来就查不到答案。后端把这类行记成 GUESS，不是「瞎猜」的意思。',
    };
  }
  if (!r.evidence) {
    // CAVEAT 刻意不带依据标签：它不是一条断言，恰恰是「没有依据、必须问人」的那一类。
    return { label: '—', hint: '歧义项不是断言，不带依据标签：它要问的就是「这个没人答过」。' };
  }
  const hit = EVIDENCE_META[r.evidence as SemanticEvidence];
  return hit ?? { label: `未知（${r.evidence}）`, hint: '本页还不认识这个 evidence 取值。' };
}

const VERIFIED_META: Record<SemanticVerified, TagMeta> = {
  CONFIRMED: { label: '数据已验证', color: 'green', hint: '拿真实数据核过，成立。' },
  WEAK: { label: '弱验证', color: 'orange', hint: '数据上只有弱支持，不足以当结论。' },
  REJECTED: { label: '数据不支持', color: 'red', hint: '拿真实数据核过，不成立。' },
  UNDECIDABLE: { label: '验不出来', color: 'default', hint: '数据不足以判断真假。' },
  NONE: { label: '未验证', hint: '没有做过采样验证。' },
};

/**
 * 验证结论。
 *
 * ★ JOIN 的 NONE 必须说重话。现阶段根本没有采样验证这一步，推出来的每一条表关系都只是
 * 「名字看着像」，而一条**没被验证过的 join** 和一条外键在界面上长得一样，就会被当成事实用，
 * 错了只会返回一个看起来很正常的数字。其它 scope 的 NONE 是常态，说成「未验证」即可。
 */
export function verifiedMeta(r: ConnectorSemanticRow): TagMeta {
  const v = r.verified ?? 'NONE';
  if (r.scope === 'JOIN' && v === 'NONE') {
    return {
      label: '未经数据验证',
      color: 'orange',
      hint: '这不是一条确认过的表关系，只是按命名推出来的推测。join 之前请先看该列的取值分布。',
    };
  }
  const hit = VERIFIED_META[v as SemanticVerified];
  return hit ?? { label: `未知（${v}）`, hint: '本页还不认识这个 verified 取值。' };
}

const ROW_STATUS_META: Record<SemanticRowStatus, TagMeta> = {
  CONFIRMED: { label: '已确认', color: 'green', hint: '人确认过的口径。' },
  DRAFT: { label: '草稿', hint: '机器推出来的，还没有人确认。' },
  // ★ 结构变了，挂在上面的这句话可能已经不成立——这是这一列存在的全部理由。
  STALE: {
    label: '结构已变',
    color: 'red',
    hint: '它锚的表/列结构已经变了，这条说明可能已经过时。重新生成会重推机器推断的那部分；人答的口径需要在对话里重新确认。',
  },
};

export function rowStatusMeta(v?: string | null): TagMeta {
  const hit = v ? ROW_STATUS_META[v as SemanticRowStatus] : undefined;
  return hit ?? { label: v ? `未知（${v}）` : '—', hint: '本页还不认识这个 status 取值。' };
}

export function isStale(r: ConnectorSemanticRow): boolean {
  return r.status === 'STALE';
}

// ---------------------------------------------------------------------------
// 取值工具
// ---------------------------------------------------------------------------

/**
 * 置信度。
 *
 * ★ 后端全局 `write_numbers_as_strings=true`，这个字段到前端是**字符串**。
 * 直接 `r.confidence >= 80` 或 `=== 0` 都会静默失效，必须先 Number()。
 */
export function confidenceOf(r: ConnectorSemanticRow): number | null {
  if (r.confidence === null || r.confidence === undefined || r.confidence === '') return null;
  const n = Number(r.confidence);
  return Number.isFinite(n) ? n : null;
}

/** 这条断言挂在哪：表 / 表.列 / 业务词条。 */
export function rowAnchor(r: ConnectorSemanticRow): string {
  if (r.term) return r.term;
  if (r.objectName && r.fieldName) return `${r.objectName}.${r.fieldName}`;
  return r.objectName || r.fieldName || '—';
}

/** JOIN 的另一端（detail 里的 to_object / to_column）。不是 JOIN 或 detail 坏了时返回 null。 */
export function joinTarget(r: ConnectorSemanticRow): string | null {
  const d = r.detail;
  if (!d) return null;
  const obj = typeof d.to_object === 'string' ? d.to_object : null;
  if (!obj) return null;
  const col = typeof d.to_column === 'string' ? d.to_column : null;
  return col ? `${obj}.${col}` : obj;
}

/** detail 里已知键的中文名。认不出来的键原样显示——藏起来等于假装它不存在。 */
const DETAIL_LABEL: Record<string, string> = {
  to_object: '关联到表',
  to_column: '关联到列',
  cardinality: '基数',
  basis: '依据',
  note: '备注',
  applies_to: '涉及的表',
};

export interface DetailEntry {
  key: string;
  label: string;
  value: string;
}

/** 把 detail 摊成可渲染的键值对。空值直接跳过（后端会写 `cardinality: null`）。 */
export function detailEntries(r: ConnectorSemanticRow): DetailEntry[] {
  const d = r.detail;
  if (!d) return [];
  const out: DetailEntry[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out.push({
      key: k,
      label: DETAIL_LABEL[k] ?? k,
      value: Array.isArray(v)
        ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('、')
        : typeof v === 'string'
          ? v
          : JSON.stringify(v),
    });
  }
  return out;
}

/** 口径覆盖留痕里的一条（history_json 的元素）。后端写的是 snake_case。 */
export interface SemanticHistoryEntry {
  at?: string;
  byName?: string;
  fromGloss?: string;
  traceId?: string;
}

/**
 * 解析留痕。history 是 `unknown[]`（后端解析失败时为 null），坏掉的元素跳过而不是整条报错：
 * 留痕是取证材料，少一条也比整块看不见强。
 */
export function historyEntries(r: ConnectorSemanticRow): SemanticHistoryEntry[] {
  if (!Array.isArray(r.history)) return [];
  const out: SemanticHistoryEntry[] = [];
  for (const item of r.history) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    out.push({
      at: typeof o.at === 'string' || typeof o.at === 'number' ? String(o.at) : undefined,
      byName: typeof o.by_name === 'string' ? o.by_name : undefined,
      fromGloss: typeof o.from_gloss === 'string' ? o.from_gloss : undefined,
      traceId: typeof o.trace_id === 'string' ? o.trace_id : undefined,
    });
  }
  return out;
}

/**
 * 时间展示。兼容 ISO 字符串与 epoch 毫秒（数字或**数字字符串**）——
 * 后端 java.util.Date 的序列化形态取决于 Nacos 里的 jackson 配置，而 numbers-as-strings
 * 会把时间戳那一种变成一串数字字符串，`new Date(那串)` 直接是 Invalid Date。
 */
export function formatTime(v?: string | null, fmt = 'YYYY-MM-DD HH:mm:ss'): string {
  if (!v) return '-';
  const n = Number(v);
  const d = Number.isFinite(n) && String(n) === String(v).trim() ? dayjs(n) : dayjs(v);
  return d.isValid() ? d.format(fmt) : '-';
}
