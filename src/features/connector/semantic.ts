import dayjs from 'dayjs';
import type {
  ConnectorSemanticRow,
  JoinKind,
  SchemaRemovedImpact,
  SchemaSnapshotResult,
  SemanticEvidence,
  SemanticGapCode,
  SemanticRowStatus,
  SemanticScope,
  SemanticSource,
  SemanticStatus,
  SemanticVerified,
  TableShape,
  TableShapeMeasurementOutcome,
  TableShapeSource,
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

export interface SemanticFailedContext {
  /** semantic_synced_at 能证明此前至少有一次成功生成。 */
  previousSuccessKnown: boolean;
  /** 当前语义查询确实返回了旧行。 */
  storedRowsPresent: boolean;
}

const SEMANTIC_FAILED_SUFFIX = '连接照常可用。';

export function semanticFailedVisibilityContext(
  context?: SemanticFailedContext,
): string {
  if (context?.previousSuccessKnown && context.storedRowsPresent) {
    return '本次生成失败，上一次成功的说明仍保留。';
  }
  if (context?.storedRowsPresent) {
    return '本次生成失败，之前的说明仍保留。';
  }
  if (context?.previousSuccessKnown) {
    return '本次生成失败，之前成功过，但现在没有可显示的说明。';
  }
  return '本次生成失败，之前的说明（如有）仍保留。';
}

const STATUS_META: Record<SemanticStatus, SemanticStatusMeta> = {
  NONE: {
    label: '未生成',
    alert: 'info',
    hint: '还没生成说明书，点「开始生成」。',
  },
  RUNNING: {
    label: '生成中',
    color: 'processing',
    alert: 'info',
    hint: '正在生成，首次至少要几十秒。',
  },
  READY: {
    label: '已生成',
    color: 'green',
    alert: 'success',
    hint: 'AI 已能读到这份说明书。',
  },
  FAILED: {
    label: '失败',
    color: 'red',
    alert: 'error',
    hint: `${semanticFailedVisibilityContext()}${SEMANTIC_FAILED_SUFFIX}`,
  },
  // ★ 刻意不是红色，也刻意不是 error。这种连接器不提供结构自描述（不声明 DESCRIBE），
  //   没有结构可推，重跑也不会变。
  //   标成红色会训练人忽略这个字段：一条健康的连接显示「失败」，人第一反应是去修一个没坏的东西，
  //   修不动几次之后，真正 FAILED 的那几条也不会有人看了。
  NOT_APPLICABLE: {
    label: '不适用',
    alert: 'info',
    hint: '这种连接不支持说明书，不是出错，无需处理。',
  },
};

/** 认不出来的值（含 undefined：后端比前端旧）一律退化成「未知」，绝不留空白。 */
export function semanticStatusMeta(
  v?: string | null,
  failedContext?: SemanticFailedContext,
): SemanticStatusMeta {
  const hit = v ? STATUS_META[v as SemanticStatus] : undefined;
  if (hit) {
    if (v === 'FAILED') {
      return {
        ...hit,
        hint: `${semanticFailedVisibilityContext(failedContext)}${SEMANTIC_FAILED_SUFFIX}`,
      };
    }
    return hit;
  }
  if (!v) {
    return {
      label: '未知',
      alert: 'info',
      hint: '读不到状态，请联系平台管理员。',
    };
  }
  return {
    label: `未知（${v}）`,
    alert: 'warning',
    hint: '状态无法识别，请联系平台管理员。',
  };
}

// ---------------------------------------------------------------------------
// 连接级：说明书是不是全本（残缺信号）
// ---------------------------------------------------------------------------
//
// ★ 这一段解决的**不是「没显示」**。残缺一直显示着——列表悬停的「说明：」、抽屉的
//   「最新说明：」都会把 semanticNote 原样展出来，里面白纸黑字写着「本次只覆盖 9/14 张表」
//   「模型输出疑似被 max_tokens 截断，说明书不完整」。问题是那句话**没有形状**：
//   它是一段中文散文，混在其它说明中间，不引人注意。
//
// ★ 所以这里做的是给它一个**视觉上明确的位置**，而不是换一套文案。semanticNote 一个字不动，
//   点开抽屉照旧看得到全文；这几个函数只负责把 semanticCoverage / semanticGaps 这个
//   结构化信号翻成「一个警示标签 + 一句说清后果的话」。
//
// ★ 后果那句话必须说到底：说明书不完整 = **模型看不到那些表和字段，它不会报错，只会答得不对**。
//   只写「不完整」，读的人会按「少了点锦上添花的东西」理解，然后照常信它给出的数字。

export interface SemanticGapMeta {
  /** 缺在哪，短名。 */
  label: string;
  /** 这条缺口意味着什么。说后果，不复述现象。 */
  desc: string;
}

const GAP_META: Record<SemanticGapCode, SemanticGapMeta> = {
  TABLES_MISSING: {
    label: '有表没进说明书',
    desc: '没覆盖到的表，AI 看不到。',
  },
  TABLES_GAVE_UP: {
    label: '有表反复失败',
    desc: '多次失败已放弃这些表；重新生成多半还会失败，请先检查表本身。',
  },
  SNAPSHOT_TRUNCATED: {
    label: '表结构没读全',
    desc: '库里的表太多，超出上限的没读进来；重新生成无效，请联系平台管理员。',
  },
  MODEL_OUTPUT_TRUNCATED: {
    label: '内容被截断',
    desc: '内容太长被截断，有些表没写到。请联系平台管理员。',
  },
};

/** 认不出来的成因码也要显示出来。静默丢掉一条缺口，等于把「缺了什么」这个问题重新答错一次。 */
export function semanticGapMeta(code: string): SemanticGapMeta {
  return (
    GAP_META[code as SemanticGapCode] ?? {
      label: `未知缺口（${code}）`,
      desc: '原因无法识别，请按「说明书不完整」处理，并联系平台管理员。',
    }
  );
}

export interface SemanticCoverageView {
  /** 这份说明书残缺。**只有它为 true 时才画警示**。 */
  partial: boolean;
  /** 残缺的成因，已翻成中文；后端没给成因时是空数组（仍然是残缺）。 */
  gaps: SemanticGapMeta[];
}

/**
 * 连接级的残缺视图。**三态里只有 PARTIAL 会返回非 null。**
 *
 * - `COMPLETE` → null：完整是应该的，不值得占一个标记位。满屏都是标记时，没有一个标记是有效的。
 * - 空值（null / undefined）→ null：那是**没跑过**（存量连接、或从未成功生成过），
 *   不是残缺。把它也标成残缺，等于上线当天给所有存量连接挂红标，然后所有人一起学会忽略这个标记。
 *   「没跑过」这件事由 semanticStatus=NONE 那一格回答，不在这里重复。
 * - 认不出来的值 → 也返回 null：一个本页不认识的状态**不能被当成残缺**，
 *   否则后端加一个新状态（比如「部分验证」）就会让所有连接凭空变红。
 */
export function semanticCoverageOf(c?: {
  semanticCoverage?: string | null;
  semanticGaps?: string[] | null;
}): SemanticCoverageView | null {
  if (c?.semanticCoverage !== 'PARTIAL') return null;
  return { partial: true, gaps: (c.semanticGaps ?? []).map(semanticGapMeta) };
}

export type SemanticCoverageDisplay =
  | { kind: 'PARTIAL'; label: string; gaps: SemanticGapMeta[] }
  | { kind: 'COMPLETE'; label: string; gaps: [] }
  | { kind: 'EMPTY'; label: string; gaps: [] }
  | { kind: 'UNKNOWN'; label: string; gaps: []; raw: string };

/**
 * coverage 的四种展示结果。null 是「没成功生成过」，未知原值是契约漂移，两者不得互相伪装。
 */
export function semanticCoverageDisplayOf(c?: {
  semanticCoverage?: string | null;
  semanticGaps?: string[] | null;
}): SemanticCoverageDisplay {
  const raw = c?.semanticCoverage;
  if (raw === 'PARTIAL') {
    return {
      kind: 'PARTIAL',
      label: '不完整',
      gaps: (c?.semanticGaps ?? []).map(semanticGapMeta),
    };
  }
  if (raw === 'COMPLETE') return { kind: 'COMPLETE', label: '完整', gaps: [] };
  if (!raw) return { kind: 'EMPTY', label: '尚未成功生成过', gaps: [] };
  return { kind: 'UNKNOWN', label: `未知覆盖度（${raw}）`, gaps: [], raw };
}

/**
 * 残缺意味着什么，一句话。列表悬停和抽屉横幅**共用这一句**——
 * 两处各写一份文案，迟早会漂成两种说法，而这句话正是这个标记存在的全部理由。
 */
export const SEMANTIC_PARTIAL_CONSEQUENCE =
  '说明书不完整，缺的表和字段 AI 看不到，可能答错。';

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
    desc: '人在对话里确认的口径，如「销售额算不算退款」。',
  },
  CAVEAT: {
    label: '待澄清的歧义',
    desc: '拿不准的问题，AI 遇到会问人；有人答了就变成「业务口径」。',
  },
  OBJECT: { label: '表用途', desc: '这张表是干什么的。' },
  FIELD: {
    label: '字段含义',
    desc: '这一列是什么意思。AI 当事实用，错了也不会提示。',
  },
  JOIN: {
    label: '表关系',
    desc: '两张表怎么关联。「未经数据验证」的只是猜测；多态关联、复合键必须带条件。',
  },
};

/** 分组顺序：人要看的排前面。METRIC / CAVEAT 是人的战场，下面三组是机器的批量产出。 */
export const SCOPE_ORDER: SemanticScope[] = ['METRIC', 'CAVEAT', 'OBJECT', 'FIELD', 'JOIN'];

export function scopeMeta(v?: string | null): ScopeMeta {
  const hit = v ? SCOPE_META[v as SemanticScope] : undefined;
  return (
    hit ?? {
      label: v ? `未知分类（${v}）` : '未分类',
      desc: '分类无法识别，请联系平台管理员。',
    }
  );
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
    hint: '业务方在对话里确认的口径，重新生成不会改动；要改请在对话里重答。',
  },
  IMPORTED: {
    label: '库注释',
    color: 'blue',
    hint: '直接采用客户库里的注释，重新生成不会改动。',
  },
  INFERRED: {
    label: '机器推断',
    hint: 'AI 根据表名、列名和注释推出来的，没人确认过；重新生成会更新它。',
  },
};

export function sourceMeta(v?: string | null): TagMeta {
  const hit = v ? SOURCE_META[v as SemanticSource] : undefined;
  return (
    hit ?? { label: v ? `未知来源（${v}）` : '来源不明', hint: '来源无法识别，请联系平台管理员。' }
  );
}

export function isHuman(r: ConnectorSemanticRow): boolean {
  return r.source === 'HUMAN';
}

const EVIDENCE_META: Record<SemanticEvidence, TagMeta> = {
  COMMENT: { label: '库注释', color: 'blue', hint: '依据是客户库里写的注释。' },
  DATA: { label: '数据采样', color: 'green', hint: '依据是真实数据的取值分布。' },
  NAME: { label: '命名推断', color: 'orange', hint: '只凭表名、列名判断，没有别的依据。' },
  GUESS: {
    label: '无依据',
    color: 'red',
    hint: '没有任何依据，请核对。',
  },
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
      hint: '依据是业务方的说法，数据库里查不到。',
    };
  }
  if (!r.evidence) {
    // CAVEAT 刻意不带依据标签：它不是一条断言，恰恰是「没有依据、必须问人」的那一类。
    return { label: '—', hint: '待人回答的问题，没有依据。' };
  }
  const hit = EVIDENCE_META[r.evidence as SemanticEvidence];
  return hit ?? { label: `未知（${r.evidence}）`, hint: '依据无法识别，请联系平台管理员。' };
}

const VERIFIED_META: Record<SemanticVerified, TagMeta> = {
  CONFIRMED: { label: '数据已验证', color: 'green', hint: '拿真实数据核过，成立。' },
  WEAK: { label: '弱验证', color: 'orange', hint: '数据上只有弱支持，不足以当结论。' },
  REJECTED: { label: '数据不支持', color: 'red', hint: '拿真实数据核过，不成立。' },
  UNDECIDABLE: { label: '验不出来', color: 'default', hint: '数据不足以判断真假。' },
  NONE: { label: '未验证', hint: '没有做过采样验证。' },
};

const KNOWN_VERIFIED = new Set<SemanticVerified>([
  'CONFIRMED',
  'WEAK',
  'REJECTED',
  'UNDECIDABLE',
  'NONE',
]);

/** 与 ConnectorToolExecutor.normalizedVerified 完全同向：空值是 NONE，已知值忽略大小写，未知值拒绝。 */
export function normalizeSemanticVerified(raw: unknown): SemanticVerified | null {
  if (raw === null || raw === undefined) return 'NONE';
  const text = String(raw).trim();
  if (!text) return 'NONE';
  const normalized = text.toUpperCase() as SemanticVerified;
  return KNOWN_VERIFIED.has(normalized) ? normalized : null;
}

/**
 * 验证结论。
 *
 * ★ JOIN 的 NONE 必须说重话。没用数据核过的表关系只是「名字看着像」，而它和一条外键在界面上
 * 长得一样，就会被当成事实用，错了只会返回一个看起来很正常的数字。其它 scope 的 NONE 是常态，
 * 说成「未验证」即可。
 *
 * ★ 多态关联 / 复合键：**数据核过也不等于能直接 join**。标签照实写验证结论（那是数据说的），
 * 但解释里必须补一句——否则一个绿色的「数据已验证」会把一条漏了类型条件就串表的关系说成可以放心用。
 */
export function verifiedMeta(r: ConnectorSemanticRow): TagMeta {
  const raw = r.verified;
  const normalized = normalizeSemanticVerified(raw);
  const v = normalized ?? (raw ? String(raw) : 'NONE');
  let meta: TagMeta;
  if (r.scope === 'JOIN' && normalized === 'NONE') {
    meta = {
      label: '未经数据验证',
      color: 'orange',
      hint: '没用数据核过，只是按命名推测，用前请先核对。',
    };
  } else {
    const hit: TagMeta | undefined = normalized ? VERIFIED_META[normalized] : undefined;
    meta = hit ?? { label: `未知（${v}）`, hint: '验证结论无法识别，请联系平台管理员。' };
  }
  // 这里只要形态的名字，不要条件——所以走 joinKindMeta，不牵扯档位（条件里的取值给不给模型才看档位）。
  const kind = joinKindMeta(r);
  if (kind && normalized !== 'REJECTED') {
    return {
      ...meta,
      hint: `${meta.hint}另外这是「${kind.label}」，核对过也要带条件才能关联。`,
    };
  }
  return meta;
}

const ROW_STATUS_META: Record<SemanticRowStatus, TagMeta> = {
  CONFIRMED: { label: '已确认', color: 'green', hint: '人确认过的口径。' },
  DRAFT: { label: '草稿', hint: '机器推出来的，还没有人确认。' },
  // ★ 结构变了，挂在上面的这句话可能已经不成立——这是这一列存在的全部理由。
  STALE: {
    label: '结构已变',
    color: 'red',
    hint: '结构变了，说明可能过时，AI 仍会参考。重新生成会更新机器生成的部分。',
  },
};

/**
 * 「结构已变」的业务口径单独一句话。
 *
 * ★ 注入侧对 STALE 是**按 scope 分两种处理**的，提示必须跟着分：口径里带着 SQL 片段，引用的表或列一变
 * 那段 SQL 就是错的，所以口径**整条停止注入**；表用途 / 字段含义 / 表关系 / 待澄清的歧义则**照样注入**，
 * 只多一个「结构已变」的标记。两者说成一句，要么让人以为说明全没了，要么让人以为口径还带着标记在用。
 */
const STALE_METRIC_META: TagMeta = {
  label: '结构已变',
  color: 'red',
  hint: '引用的表或列变了，AI 已停用这条口径。请在对话里重新确认，或表恢复后刷新结构。',
};

export function rowStatusMeta(v?: string | null, scope?: string | null): TagMeta {
  if (v === 'STALE' && scope === 'METRIC') return STALE_METRIC_META;
  const hit = v ? ROW_STATUS_META[v as SemanticRowStatus] : undefined;
  return hit ?? { label: v ? `未知（${v}）` : '—', hint: '状态无法识别，请联系平台管理员。' };
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
  const obj = joinStringOrNull(d.to_object);
  const col = joinStringOrNull(d.to_column);
  return obj && col ? `${obj}.${col}` : null;
}

// ---------------------------------------------------------------------------
// detail 里的两类结构化判断：关系形态（JOIN）与表形态（OBJECT）
// ---------------------------------------------------------------------------
//
// ★ 存量行没有这些键。读不到就返回 null、什么都不画——不画「未知」，也不画空白：
// 「没有这个判断」是这些行的真实状态，不是异常。

function strOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * JOIN detail 专用的字符串读取器，与 ConnectorToolExecutor.stringOrNull 同向：非 null 值先按
 * Java String.valueOf 语义转成字符串再 trim。Jackson 会把 JSON 数组解析为 List、对象解析为
 * LinkedHashMap；它们的 Java toString 分别是 `[a, b]` / `{k=v}`，不能用 JS 默认的 `a,b` /
 * `[object Object]` 代替。不要把它扩大到 OBJECT/FIELD；那些投影有自己更严格的契约。
 */
function javaDetailString(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map((item) => (item === null || item === undefined ? 'null' : javaDetailString(item))).join(', ')}]`;
  }
  if (typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(
        ([key, value]) =>
          `${key}=${value === null || value === undefined ? 'null' : javaDetailString(value)}`,
      )
      .join(', ')}}`;
  }
  return String(v);
}

function joinStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = javaDetailString(v).trim();
  return s ? s : null;
}

function strListOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = strOf(x);
    if (s !== null) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 数据出库档位：第 3 档存下的取值，此刻给不给模型
// ---------------------------------------------------------------------------

/**
 * 这条连接此刻开不开放第 3 档（样本值）。
 *
 * ★ 给模型的工具在**注入那一刻**按连接的当前档位再判一次：写入时是第 3 档、后来降了档（编辑表单漏回填就会静默降档），
 *   库里存着的判别值照样**不给**模型。界面若只看「存没存」，就会把一个模型根本收不到的取值画成「join 时带上的条件」——
 *   人以为模型知道该加哪个类型条件，模型其实只知道有这么一列，要自己去查。
 * ★ 只认 SAMPLE_VALUES 这一个名字；缺省、认不出一律当不开放——与后端 allowsSampleValues「判不了就当不允许」同一个方向。
 *   不按序号比较档位，理由见 types.ts 的 SemanticDataTier。
 */
export function sampleValuesAllowed(tier?: string | null): boolean {
  return tier === 'SAMPLE_VALUES';
}

/**
 * 做对一条 join 必须补上的条件。
 *
 * 拆成结构而不是拼成一句话：列名要用代码样式显示，拼成字符串之后就分不出哪段是列名、哪段是说明。
 */
export type JoinCondition =
  /**
   * 多态：带上判别列的类型条件。`value` 与 `withheldValue` 最多一个非空：
   * - `value`：模型此刻**拿得到**的取值；
   * - `withheldValue`：库里存着、但连接当前档位没开放样本值、所以**不提供给模型**的取值——只给人看，界面必须标明；
   * - 两个都是 null：根本没存（写入时不是第 3 档 / 没过敏感信息筛查 / 几个取值分不出来）。
   * `valuesAllowed` 用来区分最后一种里「档位开着却没记下」和「档位没开」——两句话对人说的是两件事。
   */
  | {
      type: 'DISCRIMINATOR';
      column: string;
      value: string | null;
      withheldValue: string | null;
      valuesAllowed: boolean;
    }
  /** 复合键：这里只记录目标端的键列；不能据此猜本表同名列就是对应列。 */
  | { type: 'COMPOSITE'; target: string | null; columns: string[] };

export interface JoinCare {
  label: string;
  /** 这种关系形态一般意味着什么；只用于标签悬停，不冒充模型实际收到的字段。 */
  hint: string;
  /** ConnectorToolExecutor 此刻实际写进 care_reason 的内容。 */
  careReason: string;
  /** ConnectorToolExecutor 此刻实际写进 condition 的内容。 */
  modelCondition: string;
  /** 卡片上的短版，不改变 condition 的「已确认 / 先核验」分支含义。 */
  conditionSummary: string;
  /**
   * 后端记下的理由被档位挡下了。
   *
   * ★ 验证侧记下判别值时，那句理由是**把取值嵌进去**写的（形如「列 = '取值' 时才指向…」）。档位不开放时，
   *   给模型的工具整句不用、换成按形态兜底的通用说明。照着原句画在「模型读到的」那一栏里，
   *   就是把一句模型读不到、而且带着客户真实取值的话说成了它读到的。原句只在展开详情里、标明后给人看。
   */
  careReasonWithheld: boolean;
  condition: JoinCondition | null;
}

const JOIN_KIND_META: Record<Exclude<JoinKind, 'SIMPLE'>, { label: string; hint: string }> = {
  POLYMORPHIC: {
    label: '多态关联',
    hint: '这一列可能按类型列的取值指向不同的表，关联时要先核对并带上类型条件。',
  },
  COMPOSITE: {
    label: '复合键',
    hint: '目标表要几列合起来才唯一，只按一列关联会把数字放大。',
  },
};

/**
 * JOIN 行的关系形态叫什么、一般意味着什么。普通 SIMPLE 不画；只有后端会放进
 * unreliable_relations 的 SIMPLE + WEAK 保留提醒。只要名字、不要条件的地方用它，不牵扯档位。
 */
function joinKindMeta(
  r: ConnectorSemanticRow,
): { kind: string; label: string; hint: string } | null {
  if (r.scope !== 'JOIN' || !r.detail) return null;
  const rawKind = joinStringOrNull(r.detail.join_kind);
  const kind = rawKind?.toUpperCase() ?? 'SIMPLE';
  if (kind === 'SIMPLE') {
    if (normalizeSemanticVerified(r.verified) !== 'WEAK') return null;
    return {
      kind,
      label: '单列弱关系',
      hint: '只有部分取值对得上。用前先排查多态外键、复合键，并核对行数。',
    };
  }
  if (kind === 'POLYMORPHIC' || kind === 'COMPOSITE') return { kind, ...JOIN_KIND_META[kind] };
  // 认不出来的形态不能当 SIMPLE 放过去：后端特意标出来的，就不是普通关联。
  return {
    kind,
    label: `未知关系形态（${kind}）`,
    hint: '关系形态无法识别，不是普通关联，用前先核对。',
  };
}

/**
 * 这一行存着的判别值（以及嵌着它写的那句 care_reason）此刻被档位挡下、**不给模型**。
 *
 * 与给模型的工具同一条判据：多态关联 + 第 3 档探查可能跑过（或判别值键仍存在）+
 * 连接当前档位没开放样本值。值即使已清成 null，也不能据此断言旧 care_reason 没嵌过真实取值；
 * joinCare 与 detailEntries 都走这里，两处不许各写一份。
 */
function storedValueWithheld(r: ConnectorSemanticRow, tier: string | null | undefined): boolean {
  if (r.scope !== 'JOIN' || !r.detail) return false;
  const probed = r.detail.probed_with_sample_values;
  const probeMayHaveRun =
    probed !== null && probed !== undefined && booleanOf(probed) !== false;
  const storedCareMayHoldValues =
    probeMayHaveRun || Object.prototype.hasOwnProperty.call(r.detail, 'discriminator_value');
  return (
    joinStringOrNull(r.detail.join_kind)?.toUpperCase() === 'POLYMORPHIC' &&
    storedCareMayHoldValues &&
    !sampleValuesAllowed(tier)
  );
}

function lenientStringListOf(v: unknown): string[] {
  if (typeof v === 'string') {
    const single = joinStringOrNull(v);
    return single === null ? [] : [single];
  }
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) => {
    const value = joinStringOrNull(item);
    return value === null ? [] : [value];
  });
}

function compositeFromCareReason(
  careReason: string | null,
  toObject: string,
  toColumn: string,
): string[] | null {
  if (!careReason) return null;
  const marker = `${toObject}.${toColumn} 只是组合唯一键 (`;
  const at = careReason.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (at < 0) return null;
  const open = at + marker.length;
  const close = careReason.indexOf(')', open);
  if (close < 0) return [];
  const columns = careReason
    .slice(open, close)
    .split(',')
    .map((column) => column.trim());
  return columns.every((column) => /^[A-Za-z0-9_$]{1,64}$/.test(column)) ? columns : [];
}

/** 与 ConnectorToolExecutor.compositeOf 同向：null=不是组合键，空数组=是，但完整键列未知。 */
function compositeColumnsOf(
  detail: Record<string, unknown>,
  kind: string,
  toObject: string,
  toColumn: string,
): string[] | null {
  if (kind !== 'POLYMORPHIC' && kind !== 'COMPOSITE') return null;
  const stored = lenientStringListOf(detail.composite_columns);
  if (stored.length > 0) return stored;
  const fromReason = compositeFromCareReason(
    joinStringOrNull(detail.care_reason),
    toObject,
    toColumn,
  );
  if (fromReason !== null) return fromReason;
  return kind === 'COMPOSITE' ? [] : null;
}

function namedCompositeKey(columns: string[], toColumn: string): string[] | null {
  if (columns.length < 2) return null;
  return columns.some((column) => column.toLowerCase() === toColumn.toLowerCase()) ? columns : null;
}

function compositeCare(columns: string[], toObject: string, toColumn: string): string {
  const target = `${toObject}.${toColumn}`;
  const key = namedCompositeKey(columns, toColumn);
  return (
    (key === null
      ? `${target} 只是某个多列唯一键的一部分（平台没记下完整的键列）`
      : `${target} 只是组合唯一键 (${key.join(', ')}) 的一部分`) +
    '，单独没有唯一约束：只按这一列关联，可能一行连出对面多行，SUM / COUNT 被放大且不报错'
  );
}

function compositeCondition(
  fromColumn: string | null,
  columns: string[],
  toObject: string,
  toColumn: string,
): string {
  const target = `${toObject}.${toColumn}`;
  const pair = `${fromColumn ? `本表 ${fromColumn}` : '本表这一列'} → ${target}`;
  const key = namedCompositeKey(columns, toColumn);
  const known =
    key === null
      ? `${target} 只是某个多列唯一键的一部分（平台没记下完整的键列），单独没有唯一约束。` +
        `平台只确认了 ${pair} 这一对；键里其余的列是哪几列、在本表对应哪一列，平台都不知道。`
      : `${target} 只是组合唯一键 (${key.join(', ')}) 的一部分，单独没有唯一约束。` +
        `平台只确认了 ${pair} 这一对；其余键列 ${key
          .filter((column) => column.toLowerCase() !== toColumn.toLowerCase())
          .join(', ')} 在本表对应哪一列，平台不知道。`;
  return (
    known +
    '不要按同名列去配，也不要没确认就把它们写进关联条件：同名列不一定是同一件事' +
    '（分区表被迫放进主键的时间列，在本表往往是本表自己的时间，照着连会把行静默连丢）。' +
    `要用先查 ${toObject} 的 COUNT(*) 与 COUNT(DISTINCT ${toColumn})：` +
    `相等说明 ${toColumn} 实际一行一个，可以只按这一对关联；` +
    '不相等时只按这一对关联会一行连出多行、SUM / COUNT 被放大，' +
    '要先向用户确认其余键列在本表对应哪一列，确认不了就不要用'
  );
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function longOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function measuredSentence(detail: Record<string, unknown>): string | null {
  const sample = longOf(detail.sample_n);
  const match = longOf(detail.match_n);
  if (sample === null || match === null) return null;
  const containment = countOf(detail.containment);
  return (
    `采样 ${sample} 个取值，命中 ${match}` +
    (containment === null ? '' : `（包含率 ${(containment * 100).toFixed(1)}%）`)
  );
}

function polymorphicCondition(
  fromColumn: string | null,
  detail: Record<string, unknown>,
  toObject: string,
  valuesAllowed: boolean,
  confirmed: boolean,
): string {
  const from = fromColumn ?? '这一列';
  const discriminatorColumn = joinStringOrNull(detail.discriminator_column);
  const discriminatorValue =
    discriminatorColumn && valuesAllowed ? joinStringOrNull(detail.discriminator_value) : null;
  if (discriminatorValue !== null) {
    return (
      `必须同时加上 ${discriminatorColumn} = ${sqlLiteral(discriminatorValue)} 条件。只按 ${from} ` +
      '一列 join，别的类型里恰好同号的行也会被连上，数不报错但是错的'
    );
  }
  if (discriminatorColumn && !confirmed) {
    const why = valuesAllowed
      ? '平台没有记下它的取值'
      : '这条连接当前没有确认开放第 3 档（样本值），平台不提供判别列的取值';
    return (
      `疑似多态外键：${from} 指向哪张表可能由判别列 ${discriminatorColumn} 决定，平台没有确认；${why}。` +
      `要用就先查出 ${discriminatorColumn} 有哪些取值、各自代表什么（不要拿 join 连不连得上来判断，几张表的自增 id 常常重叠）：` +
      `只有其中一个取值对应 ${toObject} 时，才必须加上这个取值的条件，否则别的类型里恰好同号的行也会被连上；` +
      `每个取值都指向 ${toObject} 时它只是分类列，不要加这个条件，加了会把其余取值的行静默漏掉。` +
      '拿不准就问用户，不要猜'
    );
  }
  if (discriminatorColumn) {
    const why = valuesAllowed
      ? `平台没有记下哪个取值对应 ${toObject}`
      : '这条连接当前没有确认开放第 3 档（样本值），平台不提供判别列的取值';
    return (
      `存在判别列 ${discriminatorColumn}，不加它的条件就 join 会匹配到别的类型的行；${why}。` +
      `要用就先查出 ${discriminatorColumn} 有哪些取值，哪一个对应 ${toObject} 拿不准就问用户，不要猜`
    );
  }
  return (
    '这是多态外键，但平台没记下判别列是哪一列：不加类型条件就 join 会匹配到别的类型的行。' +
    `先从本表结构里找出类型列、确认哪个取值对应 ${toObject}，确认不了就不要用`
  );
}

/**
 * JOIN 行「需要当心」的那部分：**模型此刻读得到的**理由与条件。非 JOIN、SIMPLE、存量行（没有 join_kind）一律返回 null。
 *
 * ★ `tier` 是连接的当前档位（ConnectorView.semanticDataTier），**刻意是必填参数**：存着的判别值给不给模型取决于它，
 *   漏传就会退回「存了就画成模型在用」——正是这里要堵的那种不报错的错。
 * ★ SIMPLE 刻意不画：满屏「普通关联」是纯噪声，会把真正要带条件的那几条淹掉。
 */
export function joinCare(
  r: ConnectorSemanticRow,
  tier: string | null | undefined,
): JoinCare | null {
  // care_reason / condition 只存在于 relationPayload 已接纳的关系里。卡片和 Inspector 共用本函数，
  // 所以入口闸必须也放在这里：否则 REJECTED、未知 verified 或残缺端点虽然不进模型，卡片仍会把
  // 原始 care_reason / discriminator_value 画成“模型当前能读到”。
  if (r.scope !== 'JOIN' || joinInjectionDecision(r).hiddenReason) return null;
  const km = joinKindMeta(r);
  if (!km || !r.detail) return null;
  const d = r.detail;
  const { label, hint } = km;
  const storedReason = joinStringOrNull(d.care_reason);
  const toObject = joinStringOrNull(d.to_object) ?? '目标表';
  const toColumn = joinStringOrNull(d.to_column) ?? '目标列';
  const fromColumn = joinStringOrNull(r.fieldName);
  const verified = normalizeSemanticVerified(r.verified);
  const confirmed = verified === 'CONFIRMED';
  const composite = compositeColumnsOf(d, km.kind, toObject, toColumn);
  if (km.kind === 'SIMPLE') {
    const measured = measuredSentence(d);
    return {
      label,
      hint,
      careReason: storedReason ?? '采样验证只有一部分取值能在对面找到',
      modelCondition:
        `${measured ?? '采样只有一部分取值对得上'}：数据只部分支持，常见成因是多态外键或复合键。` +
        '那两种情况下按单列 join 连上的行本身就可能是错的，不是「少连了一部分」。' +
        `要用先查清本表有没有类型列、${toObject} 是不是复合键，带上完整条件再自己跑 COUNT 核对；查不清就不要用`,
      conditionSummary: '先排查类型列和复合键，带上条件后核对行数。',
      careReasonWithheld: false,
      condition: null,
    };
  }
  if (km.kind === 'POLYMORPHIC') {
    const column = joinStringOrNull(d.discriminator_column);
    const stored = joinStringOrNull(d.discriminator_value);
    const allowed = sampleValuesAllowed(tier);
    const withheld = storedValueWithheld(r, tier);
    const genericReason = confirmed
      ? '多态外键：这一列按另一列的类型取值指向不同的表。包含率只能说明这个 id 在对面存在，说明不了连上的是不是同一类行'
      : '疑似多态外键：这一列指向哪张表可能由另一列的类型取值决定，平台没有确认——那一列也可能只是分类列，每个取值都指向同一张表。包含率只能说明这个 id 在对面存在，说明不了连上的是不是同一类行';
    const storedReasonVisible = storedReason !== null && !withheld;
    const baseReason = storedReasonVisible ? storedReason : genericReason;
    const modelCondition = polymorphicCondition(fromColumn, d, toObject, allowed, confirmed);
    const fullCondition =
      composite === null
        ? modelCondition
        : `${modelCondition}。另外，${compositeCondition(fromColumn, composite, toObject, toColumn)}`;
    return {
      label,
      hint,
      careReason: storedReasonVisible
        ? baseReason
        : composite === null
          ? baseReason
          : `${baseReason}。另外，${compositeCare(composite, toObject, toColumn)}`,
      modelCondition: fullCondition,
      conditionSummary:
        column && stored && allowed
          ? `必须加上 ${column} = ${sqlLiteral(stored)} 的类型条件。`
          : column && !confirmed
            ? `先核 ${column} 的各个取值是否都指向 ${toObject}，再决定是否加类型条件。`
            : column
              ? `先查明 ${column} 中哪个取值对应 ${toObject}，再加类型条件。`
              : '先找出判别列和对应取值；确认不了就不要使用这条关系。',
      careReasonWithheld: withheld && storedReason !== null,
      condition: column
        ? {
            type: 'DISCRIMINATOR',
            column,
            value: allowed ? stored : null,
            withheldValue: allowed ? null : stored,
            valuesAllowed: allowed,
          }
        : null,
    };
  }
  if (km.kind === 'COMPOSITE') {
    const columns = composite ?? [];
    return {
      label,
      hint,
      careReason: storedReason ?? compositeCare(columns, toObject, toColumn),
      modelCondition: compositeCondition(fromColumn, columns, toObject, toColumn),
      conditionSummary: `平台只确认 ${fromColumn ?? '本表这一列'} → ${toObject}.${toColumn}；先核对目标列是否唯一，别按同名列补条件。`,
      careReasonWithheld: false,
      condition: { type: 'COMPOSITE', target: joinStringOrNull(d.to_object), columns },
    };
  }
  return {
    label,
    hint,
    careReason: storedReason ?? '平台给这条关系标了本版本认不出的形态',
    modelCondition: `平台给这条关系标了本版本认不出的形态（${km.kind}），不能当成普通的单列关联直接 join；要用先查清它还缺什么条件，查不清就不要用`,
    conditionSummary: '先查清这条关系缺少的条件；查不清就不要使用。',
    careReasonWithheld: false,
    condition: null,
  };
}

const TABLE_SHAPE_META: Record<TableShape, TagMeta> = {
  DETAIL: { label: '明细表', hint: '一行是一条业务记录，可以直接按行计数、求和。' },
  MULTI_METRIC_PERIOD: {
    label: '多指标周期表',
    color: 'blue',
    hint: '一行是一个周期（天 / 月…）的汇总指标，按行计数数的是周期数。',
  },
  // ★ 本组唯一需要一眼看出来的形态：当成明细表处理时所有聚合都是错的，而且不报错。
  KEY_VALUE: {
    label: '键值对表',
    color: 'volcano',
    hint: '一行是一对「指标名 = 值」。先按指标名筛出一个指标再聚合，直接求和会全错。',
  },
  OTHER: { label: '其他形态', hint: '不属于明细表 / 多指标周期表 / 键值对表。' },
};

const TABLE_SHAPE_SOURCE_META: Record<TableShapeSource, TagMeta> = {
  MEASURED: { label: '实测', color: 'green', hint: '用真实数据测出来的，不只是看名字判断。' },
  MODEL: { label: 'AI 判断', hint: 'AI 看表名、列名和注释判断的，没用数据测过。' },
};

/**
 * OBJECT 行的表形态，三种情况界面上长得不一样：
 * - SHAPE：`table_shape_source` **恰好是** MODEL / MEASURED、且取值**恰好是**四种形态之一——
 *   唯一会提供给模型的一种，也是唯一准画聚合语义（键值对表警示）的一种；
 * - UNRECOGNIZED：带着 source，但 source 或取值有一样不是契约里的值（后端比前端新，或写坏了）；
 * - LEGACY：**没有 source** 的旧行。
 *
 * ★ 后两种给模型的工具**一个字都不给**（形态、来源、键值对告警全不出），界面上也就不许画成任何形态。
 */
export type TableShapeView =
  | {
      kind: 'SHAPE';
      shape: TagMeta;
      keyValue: boolean;
      /** 形态是怎么定的。 */
      source: TagMeta;
      measured: boolean;
      /** 模型原来的判断（已转成中文）。和最终形态相同、或没有时为 null——相同就没有信息量。 */
      modelGuess: string | null;
      /** 仅 KEY_VALUE 且**实测**时有：没测过的列名是模型猜的，照着它写「先按这一列筛」就是把猜测说成了事实。 */
      kvNameColumn: string | null;
      kvValueColumn: string | null;
    }
  /** `source` 为 null = 来源本身认不出（`sourceRaw` 是原文）；非 null = 来源认得、形态取值认不出。 */
  | { kind: 'UNRECOGNIZED'; raw: string; sourceRaw: string; source: TagMeta | null }
  | { kind: 'LEGACY'; raw: string };

/**
 * 按键查表，只认表里**自己的**键。
 *
 * ★ 对象字面量带原型：`TABLE_SHAPE_META['constructor']` 是个函数、为真，直接下标会把它当成「认得」。
 *   「原样匹配契约值」的地方（表形态、形态来源）必须排除这种脏值，否则它会被画成一个形态。
 */
function ownEntry<V>(table: Record<string, V>, key: string | null): V | undefined {
  return key !== null && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * OBJECT 行的表形态。非 OBJECT、没有 table_shape 的行返回 null。
 *
 * ★ **判据与给模型的工具逐字相同**：`table_shape_source` 去掉首尾空白后恰好是 `MODEL` / `MEASURED`，
 *   `table_shape` 恰好是四个枚举名之一，都区分大小写。任一不成立，工具就把整行形态丢掉——
 *   上一版对「有 source 但认不出来」的行照样当 SHAPE 处理，一张来源写坏了的表会在这里画出键值对表警示和
 *   「先按这一列筛」，而模型那边什么都没收到：人以为模型被警告过，模型照明细表去聚合。
 * ★ 新旧行只按有没有 source 分，不按取值长什么样猜：旧行里恰好写成 `FACT` / `KEY_VALUE` 的，照样是旧行。
 */
export function tableShapeOf(r: ConnectorSemanticRow): TableShapeView | null {
  if (r.scope !== 'OBJECT' || !r.detail) return null;
  const d = r.detail;
  const raw = strOf(d.table_shape);
  if (!raw) return null;

  const srcRaw = strOf(d.table_shape_source);
  if (!srcRaw) return { kind: 'LEGACY', raw };
  const source = ownEntry<TagMeta>(TABLE_SHAPE_SOURCE_META, srcRaw) ?? null;
  const known = ownEntry<TagMeta>(TABLE_SHAPE_META, raw);
  if (!source || !known) return { kind: 'UNRECOGNIZED', raw, sourceRaw: srcRaw, source };

  const guessRaw = strOf(d.table_shape_model_guess);
  const guessMeta = ownEntry<TagMeta>(TABLE_SHAPE_META, guessRaw);

  const measured = srcRaw === 'MEASURED';
  const keyValue = raw === 'KEY_VALUE';
  const namedColumns = keyValue && measured;
  return {
    kind: 'SHAPE',
    shape: known,
    keyValue,
    source,
    measured,
    modelGuess: guessRaw && guessRaw !== raw ? (guessMeta?.label ?? guessRaw) : null,
    kvNameColumn: namedColumns ? strOf(d.kv_name_column) : null,
    kvValueColumn: namedColumns ? strOf(d.kv_value_column) : null,
  };
}

/** 这一行是不是（新版判定下的）键值对表。旧行、认不出来的取值一律不是。 */
export function isKeyValueTable(r: ConnectorSemanticRow): boolean {
  const v = tableShapeOf(r);
  return v?.kind === 'SHAPE' && v.keyValue;
}

/** detail 里已知键的中文名。认不出来的键原样显示——藏起来等于假装它不存在。 */
const DETAIL_LABEL: Record<string, string> = {
  to_object: '关联到表',
  to_column: '关联到列',
  cardinality: '基数',
  basis: '依据',
  note: '备注',
  applies_to: '涉及的表',
  join_kind: '关系形态',
  care_reason: '为什么要当心',
  discriminator_column: '类型判别列',
  discriminator_value: '判别值',
  probed_with_sample_values: '曾用样本值探查',
  composite_columns: '目标表的复合键列',
  table_shape: '表形态',
  table_shape_source: '形态怎么定的',
  table_shape_model_guess: 'AI 原判',
  kv_name_column: '指标名列',
  kv_value_column: '指标值列',
  // ── 采样验证（JOIN）的细账。原样显示英文键名等于没显示：看这里的是企业超管，不是写这段代码的人 ──
  auto_joinable: '可直接关联',
  sample_n: '采样的去重取值数',
  match_n: '在目标表命中的',
  containment: '包含率',
  verify_note: '验证说明',
  // ── 表形态实测（OBJECT）──
  table_shape_measurement: '形态实测',
  // ── 口径 / 歧义（METRIC / CAVEAT）──
  stale_removed_objects: '已消失的表',
};

/** 旧行（没有 table_shape_source）上 table_shape 的标签：原文是一句旧描述，不是四种形态之一，工具也不给模型。 */
const LEGACY_TABLE_SHAPE_LABEL = '表形态（旧版，AI 看不到）';

/** 来源或取值认不出的 table_shape 的标签。工具同样整行丢掉，模型读不到。 */
const UNRECOGNIZED_TABLE_SHAPE_LABEL = '表形态（未识别，AI 看不到）';

const MEASUREMENT_OUTCOME_LABEL: Record<TableShapeMeasurementOutcome, string> = {
  KEY_VALUE: '测出来是键值对表',
  // ★ 不写成「不是键值对表」：两列是平台按结构挑的，挑错了列测出来的「不是」说明不了整张表。
  NOT_KEY_VALUE: '按下面这两列测，不是「指标名 + 指标值」',
  INCONCLUSIVE: '形态像键值对表，但证据不够下结论',
  UNDECIDABLE: '判不出来（样本太少 / 超时 / 没权限），下一轮会重测',
};

const MEASUREMENT_KNOWN_KEYS = new Set(['outcome', 'name_column', 'value_column', 'basis']);

function plainValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** 实测留痕是个对象。摊成几行人话；认不出来的键原样附在后面，不藏。 */
function measurementText(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const lines: string[] = [];
  const outcome = strOf(m.outcome);
  if (outcome) {
    const label: string | undefined =
      MEASUREMENT_OUTCOME_LABEL[outcome as TableShapeMeasurementOutcome];
    lines.push(`结论：${label ?? `未知（${outcome}）`}`);
  }
  const nameCol = strOf(m.name_column);
  const valueCol = strOf(m.value_column);
  if (nameCol || valueCol) {
    lines.push(`测的两列：指标名 ${nameCol ?? '—'}，值 ${valueCol ?? '—'}`);
  }
  const basis = strOf(m.basis);
  if (basis) lines.push(`依据：${basis}`);
  for (const [k, x] of Object.entries(m)) {
    if (MEASUREMENT_KNOWN_KEYS.has(k) || x === null || x === undefined || x === '') continue;
    lines.push(`${k}：${plainValue(x)}`);
  }
  return lines.length ? lines.join('\n') : null;
}

function booleanOf(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

/**
 * 需要专门转写的取值。返回 null = 读不懂，退回通用显示（原样），不吞掉。
 *
 * ★ 数值一律走 countOf：numbers-as-strings 下 `containment` 到前端是 `"0.97"`。
 */
const DETAIL_FORMAT: Record<string, ((v: unknown) => string | null) | undefined> = {
  // false 不只是「右侧确实不唯一」：没测出唯一性时也是 false。所以只说「没确认唯一」，不说「不唯一」。
  auto_joinable: (v) => {
    const b = booleanOf(v);
    if (b === null) return null;
    return b ? '是（目标列唯一）' : '否（目标列不一定唯一，关联可能放大行数）';
  },
  containment: (v) => {
    const n = countOf(v);
    if (n === null || n < 0 || n > 1) return null;
    return `${(n * 100).toFixed(1)}%`;
  },
  table_shape_measurement: measurementText,
};

function labelsOf(meta: Record<string, { label: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, m] of Object.entries(meta)) out[k] = m.label;
  return out;
}

/**
 * 枚举型取值的中文，与上面几张 META 表同源（抄一份就会漂）。
 * 认不出来的值原样显示——存量行的自由文本 table_shape 就走这条。
 */
const DETAIL_VALUE_LABEL: Record<string, Record<string, string> | undefined> = {
  join_kind: { SIMPLE: '普通关联', ...labelsOf(JOIN_KIND_META) },
  table_shape: labelsOf(TABLE_SHAPE_META),
  table_shape_model_guess: labelsOf(TABLE_SHAPE_META),
  table_shape_source: labelsOf(TABLE_SHAPE_SOURCE_META),
};

export interface DetailEntry {
  key: string;
  label: string;
  value: string;
}

/**
 * 把 detail 摊成可渲染的键值对。空值直接跳过（后端会写 `cardinality: null`）。
 *
 * `value` 可能含换行（实测留痕是多行），渲染处要保留换行。
 *
 * `tier` 是连接的当前档位，必填，理由同 {@link joinCare}：展开详情里存着的判别值和嵌着它的理由，
 * 档位不开放时要标明「不提供给模型」，不能和模型真在用的那几条长得一样。
 */
export function detailEntries(
  r: ConnectorSemanticRow,
  tier: string | null | undefined,
): DetailEntry[] {
  const d = r.detail;
  if (!d) return [];
  // 工具没认下的 table_shape（旧行 / 来源或取值认不出）：原文照实显示，不套形态的中文名（哪怕它恰好写成 KEY_VALUE），
  // 标签里说清模型读不到。判据只走 tableShapeOf 一处，与卡片上的画法不许分叉。
  const shape = tableShapeOf(r);
  const shapeLabel =
    shape?.kind === 'LEGACY'
      ? LEGACY_TABLE_SHAPE_LABEL
      : shape?.kind === 'UNRECOGNIZED'
        ? UNRECOGNIZED_TABLE_SHAPE_LABEL
        : null;
  const withheld = storedValueWithheld(r, tier);
  const out: DetailEntry[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'table_shape' && shapeLabel) {
      out.push({ key: k, label: shapeLabel, value: plainValue(v) });
      continue;
    }
    // 存着、但当前档位不给模型的真实取值：原样给人看（这一页只有企业超管），标签上说清它没进模型。
    if (withheld && k === 'discriminator_value') {
      out.push({ key: k, label: '判别值（AI 看不到）', value: plainValue(v) });
      continue;
    }
    if (withheld && k === 'care_reason') {
      out.push({
        key: k,
        label: '为什么要当心（含取值，AI 看不到）',
        value: plainValue(v),
      });
      continue;
    }
    const formatted = DETAIL_FORMAT[k]?.(v) ?? null;
    out.push({
      key: k,
      label: DETAIL_LABEL[k] ?? k,
      value:
        formatted !== null
          ? formatted
          : Array.isArray(v)
            ? v.map(plainValue).join('、')
            : typeof v === 'string'
              ? (DETAIL_VALUE_LABEL[k]?.[v] ?? v)
              : typeof v === 'boolean'
                ? v
                  ? '是'
                  : '否'
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

// ---------------------------------------------------------------------------
// 工作台纯派生视图：需关注 + 模型可见性
// ---------------------------------------------------------------------------

export type SemanticAttentionTone = 'danger' | 'warning' | 'info';

export interface SemanticAttentionReason {
  code: string;
  label: string;
  hint: string;
  tone: SemanticAttentionTone;
}

/**
 * 与后端注入器相同的词条归一：去首尾空白后转小写。
 *
 * Java 侧使用 Locale.ROOT；JavaScript 的 String#toLowerCase 不受浏览器 locale 影响，
 * 因此这里不能换成 toLocaleLowerCase（那会在土耳其语环境重新制造 ROI / roi 不匹配）。
 */
export function normalizeSemanticTerm(term?: string | null): string {
  return term?.trim().toLowerCase() ?? '';
}

/** 本次模型上下文里确实能作为答案注入的 METRIC 词条。 */
export function answeredSemanticTerms(rows: ConnectorSemanticRow[]): ReadonlySet<string> {
  const answered = new Set<string>();
  for (const row of rows) {
    if (row.scope !== 'METRIC' || row.status === 'STALE') continue;
    if (!row.gloss?.trim()) continue;
    const term = normalizeSemanticTerm(row.term);
    if (term) answered.add(term);
  }
  return answered;
}

/** 已有有效 METRIC 回答时，同名 CAVEAT 仍留库供审计，但不再注入或要求人重复回答。 */
export function isAnsweredCaveat(
  row: ConnectorSemanticRow,
  answeredTerms?: ReadonlySet<string>,
): boolean {
  if (row.scope !== 'CAVEAT' || !answeredTerms) return false;
  const term = normalizeSemanticTerm(row.term);
  return Boolean(term && answeredTerms.has(term));
}

/**
 * 后端契约 K-3 的值域阶段行判据。
 *
 * 新行认 origin=value_profile（不看来源）；旧行认 INFERRED + FIELD + DATA，并要求 detail
 * 带 value_domain。detail 解析失败时后端为防真实取值漏出而保守地也当成值域行；管理端只拿到
 * 解析后的 detail/null，所以这里同样把 null 往“需要拦截”的方向处理。
 */
export function isValueProfileRow(row: ConnectorSemanticRow): boolean {
  const detail = row.detail;
  const origin = detail ? strOf(detail.origin) : null;
  if (origin?.toLowerCase() === 'value_profile') return true;

  const legacyShape =
    strOf(row.source)?.toUpperCase() === 'INFERRED' &&
    strOf(row.scope)?.toUpperCase() === 'FIELD' &&
    strOf(row.evidence)?.toUpperCase() === 'DATA';
  if (!legacyShape) return false;
  return (
    detail === null ||
    detail === undefined ||
    Object.prototype.hasOwnProperty.call(detail, 'value_domain')
  );
}

/**
 * 工作台左侧「需关注」是纯前端视图，不是第六种 scope，也不写回后端。
 *
 * 所有判断继续落到本文件已有的单一真相源：结构失效走 isStale，复杂关系走 joinCare，
 * 表形态走 tableShapeOf，验证措辞走 verifiedMeta。组件只消费结果，不再自己拼一套 if/else。
 */
export function semanticAttentionReasons(
  r: ConnectorSemanticRow,
  tier: string | null | undefined,
  answeredTerms?: ReadonlySet<string>,
): SemanticAttentionReason[] {
  // 后端 ambiguityPayload 会把同名问题整条过滤；“需关注”也必须同步退场，不能继续催人回答。
  if (isAnsweredCaveat(r, answeredTerms)) return [];

  const reasons: SemanticAttentionReason[] = [];
  const add = (reason: SemanticAttentionReason) => {
    if (!reasons.some((item) => item.code === reason.code)) reasons.push(reason);
  };

  if (!SCOPE_ORDER.includes(r.scope as SemanticScope)) {
    add({
      code: 'UNKNOWN_SCOPE',
      label: '未知分类',
      hint: scopeMeta(r.scope).desc,
      tone: 'warning',
    });
  }
  if (r.scope === 'CAVEAT') {
    add({
      code: 'CAVEAT',
      label: '等待业务方回答',
      hint: scopeMeta('CAVEAT').desc,
      tone: 'warning',
    });
  }
  if (isStale(r)) {
    const stale = rowStatusMeta(r.status, r.scope);
    add({ code: 'STALE', label: stale.label, hint: stale.hint, tone: 'danger' });
  }

  const normalizedVerified = normalizeSemanticVerified(r.verified);
  if (r.scope === 'JOIN' && normalizedVerified === null) {
    add({
      code: 'UNKNOWN_VERIFIED',
      label: '未知验证结论',
      hint: `验证结论「${String(r.verified)}」未识别，AI 不会使用这条关系。`,
      tone: 'danger',
    });
  } else if (normalizedVerified === 'REJECTED') {
    const rejected = verifiedMeta(r);
    add({ code: 'REJECTED', label: rejected.label, hint: rejected.hint, tone: 'danger' });
  } else if (normalizedVerified === 'WEAK' || normalizedVerified === 'UNDECIDABLE') {
    const weak = verifiedMeta(r);
    add({ code: `VERIFIED_${normalizedVerified}`, label: weak.label, hint: weak.hint, tone: 'warning' });
  } else if (r.scope === 'JOIN' && normalizedVerified === 'NONE') {
    const unverified = verifiedMeta(r);
    add({
      code: 'JOIN_UNVERIFIED',
      label: unverified.label,
      hint: unverified.hint,
      tone: 'warning',
    });
  }

  const care = joinCare(r, tier);
  if (care && normalizedVerified !== 'REJECTED') {
    add({ code: 'JOIN_CARE', label: care.label, hint: care.hint, tone: 'warning' });
    if (care.careReasonWithheld || care.condition?.type === 'DISCRIMINATOR') {
      const condition = care.condition?.type === 'DISCRIMINATOR' ? care.condition : null;
      if (condition?.withheldValue !== null || care.careReasonWithheld) {
        add({
          code: 'VALUE_WITHHELD',
          label: 'AI 看不到取值',
          hint: '判别值已留存，但当前档位不开放样本值。',
          tone: 'warning',
        });
      } else if (condition?.valuesAllowed && condition.value === null) {
        add({
          code: 'VALUE_MISSING',
          label: '取值尚未取得',
          hint: '档位允许样本值，但没取到可用的判别值。',
          tone: 'warning',
        });
      }
    }
  }

  const shape = tableShapeOf(r);
  if (shape?.kind === 'SHAPE' && shape.keyValue) {
    add({
      code: 'KEY_VALUE_TABLE',
      label: shape.shape.label,
      hint: shape.shape.hint,
      tone: 'danger',
    });
  } else if (shape?.kind === 'LEGACY' || shape?.kind === 'UNRECOGNIZED') {
    add({
      code: 'SHAPE_NOT_VISIBLE',
      label: shape.kind === 'LEGACY' ? '旧版表形态' : '未认出的表形态',
      hint: '形态描述已留存，但 AI 看不到。',
      tone: 'warning',
    });
  }

  const source = sourceMeta(r.source);
  if (!r.source || !['HUMAN', 'IMPORTED', 'INFERRED'].includes(r.source)) {
    add({ code: 'UNKNOWN_SOURCE', label: source.label, hint: source.hint, tone: 'warning' });
  }
  return reasons;
}

export interface SemanticVisibilityFact {
  key: string;
  label: string;
  value: string;
}

export interface SemanticModelVisibilityView {
  /** 连接级状态对本行可见性的补充说明；不替代下面的行级判定。 */
  connectionContext: string | null;
  /** 整条断言此刻是否进入模型上下文。 */
  visible: boolean;
  /** 整条不进入时的原因；null 表示正常注入。 */
  hiddenReason: string | null;
  /** 模型此刻实际读到的内容。 */
  current: SemanticVisibilityFact[];
  /** 平台仍留存，但当前工具刻意不提供给模型的内容。 */
  retained: SemanticVisibilityFact[];
  /** 当前档位允许取得、但这次没有安全取得的内容。 */
  allowedMissing: SemanticVisibilityFact[];
}

export interface SemanticTierVisibilityView {
  modelVisible: string;
  retainedHidden: string;
  hint: string;
}

/** 连接级档位的常驻说明。具体客户承诺仍优先展示后端下发的 semanticDataTierEgress。 */
export function semanticTierVisibility(tier?: string | null): SemanticTierVisibilityView {
  if (tier === 'SAMPLE_VALUES') {
    return {
      modelVisible: '元数据、派生统计，以及通过敏感信息筛查的样本值',
      retainedHidden: '没有因档位隐藏的内容',
      hint: '允许取值不等于已取得；没取到的判别值会在详情里标出。',
    };
  }
  if (tier === 'DERIVED_STATS') {
    return {
      modelVisible: '元数据和派生统计；逐行业务记录不出库',
      retainedHidden: '旧结果里的样本值，以及含取值的原话',
      hint: '这是默认档；详情里会分开列出 AI 看得到和看不到的内容。',
    };
  }
  if (tier === 'METADATA_ONLY') {
    return {
      modelVisible: '表名、列名、类型、索引和客户自己写的注释',
      retainedHidden: '派生统计、样本值，以及含具体取值的原话',
      hint: '仅凭名字推关系更易出错，未经数据验证的关系会一直标为需关注。',
    };
  }
  return {
    modelVisible: '档位无法识别，按不开放样本值处理',
    retainedHidden: '无法确认的样本值不给 AI',
    hint: '档位无法识别，请联系平台管理员。',
  };
}

interface JoinInjectionDecision {
  verified: SemanticVerified | null;
  toObject: string | null;
  toColumn: string | null;
  hiddenReason: string | null;
}

/**
 * 与 ConnectorToolExecutor.relationPayload 的三道入口闸一致：verified 必须是已知枚举且不能是
 * REJECTED，右端表/列必须同时存在。任一不满足，关系整条不进入 joins / unreliable_relations。
 */
function joinInjectionDecision(r: ConnectorSemanticRow): JoinInjectionDecision {
  const rawVerified = r.verified;
  const verified = normalizeSemanticVerified(rawVerified);
  const toObject = joinStringOrNull(r.detail?.to_object);
  const toColumn = joinStringOrNull(r.detail?.to_column);
  let hiddenReason: string | null = null;

  if (verified === null) {
    hiddenReason = `验证结论「${String(rawVerified)}」未识别，AI 不会使用这条关系。`;
  } else if (verified === 'REJECTED') {
    hiddenReason = '真实数据不支持这条关系，AI 不会使用。';
  } else if (!toObject || !toColumn) {
    const missing = [!toObject ? '目标表' : null, !toColumn ? '目标列' : null]
      .filter(Boolean)
      .join('、');
    hiddenReason = `关系不完整：缺少${missing}，AI 不会使用这条关系。`;
  }
  return { verified, toObject, toColumn, hiddenReason };
}

/** 与 ConnectorToolExecutor.joinKind 相同：旧行缺省为 SIMPLE，未知值只转大写、不擅自降级。 */
function joinKindOf(detail: Record<string, unknown>): string {
  return joinStringOrNull(detail.join_kind)?.toUpperCase() ?? 'SIMPLE';
}

/** 与 ConnectorToolExecutor.joinBasis 的 evidence 分支逐字一致；source=HUMAN 不改变模型收到的依据。 */
function joinEvidenceSentence(evidence: unknown): string {
  if (evidence === 'COMMENT') return '客户库自己的注释';
  if (evidence === 'DATA') return '库里的数据';
  if (evidence === 'NAME') return '列名本身';
  return '常识推测，没有外部依据';
}

function undecidableWhy(detail: Record<string, unknown>): string {
  return joinStringOrNull(detail.verify_note) ?? '样本不足或探查未能完成';
}

/** 可靠单列关系进入 joins 时，basis 中实际携带的验证结论与动作。 */
function reliableVerificationSentence(
  verified: SemanticVerified,
  detail: Record<string, unknown>,
): string {
  const measured = measuredSentence(detail);
  const suffix = measured === null ? '' : `（${measured}）`;
  if (verified === 'CONFIRMED') {
    return `已用真实数据采样验证通过${suffix}，可以直接使用，不必再为它单跑一次 COUNT 自验`;
  }
  if (verified === 'UNDECIDABLE') {
    return (
      `已经用真实数据查过了，但判不出来（${undecidableWhy(detail)}）。` +
      '这不等于这条关系不成立，只是这次没能判定；依赖它之前先自己跑一条 COUNT 核一次'
    );
  }
  return '未经数据验证，依赖它之前先跑一条 COUNT 自验';
}

/** 不可靠关系进入 unreliable_relations 时，basis 只陈述验证事实，动作由 condition 承担。 */
function unreliableVerificationSentence(
  verified: SemanticVerified,
  detail: Record<string, unknown>,
): string {
  const measured = measuredSentence(detail);
  const suffix = measured === null ? '' : `（${measured}）`;
  if (verified === 'CONFIRMED') {
    return (
      `已用真实数据采样验证，取值基本都能在对面找到${suffix}。` +
      '但包含率只说明这些取值在对面存在，说明不了连上的是不是对的那一行'
    );
  }
  if (verified === 'WEAK') {
    return `已用真实数据采样验证，但只有一部分取值能在对面找到${suffix}`;
  }
  if (verified === 'UNDECIDABLE') {
    return `已经用真实数据查过，但判不出来（${undecidableWhy(detail)}）`;
  }
  return '没有用数据验证过';
}

function joinBasis(
  r: ConnectorSemanticRow,
  detail: Record<string, unknown>,
  verified: SemanticVerified,
  reliable: boolean,
): string {
  const verification = reliable
    ? reliableVerificationSentence(verified, detail)
    : unreliableVerificationSentence(verified, detail);
  return `依据：${joinEvidenceSentence(r.evidence)}；${verification}`;
}

/** 与 ConnectorToolExecutor.fanoutWarning 的优先级和措辞逐字一致。 */
function fanoutWarning(autoJoinable: boolean | null, cardinality: string | null): string | null {
  if (cardinality === 'N:N') {
    return (
      '两侧都不唯一（N:N）：直接 join 会让左表的一行匹配到右表的多行，行数成倍放大，' +
      'SUM / COUNT 出来的数会凭空变大而且不会报错。只把它当线索，不要直接 join；' +
      '确实要用就先在一侧按连接键聚合或去重，再连。'
    );
  }
  if (cardinality === '1:N') {
    return (
      '右侧不是唯一键（1:N）：左表一行会匹配到右表多行，join 之后行数被放大，' +
      '再做 SUM / AVG 就会算错而且不报错。先在右表上按连接键聚合，再拿聚合结果去 join。'
    );
  }
  if (autoJoinable === false) {
    return (
      '平台没能确认右侧这一列是唯一的：一行可能匹配到多行，join 会放大行数，' +
      'SUM / COUNT 会跟着变大而不报错。动手前先用 COUNT 对一下 join 前后的行数。'
    );
  }
  return null;
}

const JOIN_STALE_NOTE =
  '结构已变，这条说明可能过时——请以本次返回的 type / comment 为准，不要直接采信它';

interface JoinPayloadProjection {
  facts: SemanticVisibilityFact[];
  care: JoinCare | null;
}

/**
 * 把一条已通过入口闸的 JOIN 按 relationPayload 的字段顺序投影出来。
 * 这里不追加摘要或解释；Inspector 的「模型此刻读到」必须能与真实 JSON payload 一项项对上。
 */
function joinPayloadProjection(
  r: ConnectorSemanticRow,
  tier: string | null | undefined,
  decision: JoinInjectionDecision,
): JoinPayloadProjection {
  const detail = r.detail;
  if (!detail || !decision.toObject || !decision.toColumn || !decision.verified) {
    return { facts: [], care: null };
  }

  const kind = joinKindOf(detail);
  const reliable = kind === 'SIMPLE' && decision.verified !== 'WEAK';
  const care = reliable ? null : joinCare(r, tier);
  const facts: SemanticVisibilityFact[] = [
    {
      key: 'join-column',
      label: '本表列（column）',
      value: r.fieldName === null || r.fieldName === undefined ? 'null' : String(r.fieldName),
    },
    { key: 'join-to-object', label: '目标表（to_object）', value: decision.toObject },
    { key: 'join-to-column', label: '目标列（to_column）', value: decision.toColumn },
  ];

  if (!reliable && care) {
    facts.push(
      { key: 'join-kind', label: '关系形态（join_kind）', value: kind },
      { key: 'join-care', label: '需当心理由（care_reason）', value: care.careReason },
      { key: 'join-condition', label: '使用条件（condition）', value: care.modelCondition },
    );
    if (kind === 'POLYMORPHIC') {
      const discriminatorColumn = joinStringOrNull(detail.discriminator_column);
      if (discriminatorColumn) {
        facts.push({
          key: 'join-discriminator-column',
          label: '判别列（discriminator_column）',
          value: discriminatorColumn,
        });
        const discriminatorValue = sampleValuesAllowed(tier)
          ? joinStringOrNull(detail.discriminator_value)
          : null;
        if (discriminatorValue) {
          facts.push({
            key: 'join-discriminator-value',
            label: '判别值（discriminator_value）',
            value: discriminatorValue,
          });
        }
      }
    } else if (kind === 'COMPOSITE') {
      const columns = lenientStringListOf(detail.composite_columns);
      if (columns.length > 0) {
        facts.push({
          key: 'join-composite-columns',
          label: '复合键列（composite_columns）',
          value: JSON.stringify(columns),
        });
      }
    }
  }

  const cardinality = joinStringOrNull(detail.cardinality);
  if (cardinality) {
    facts.push({ key: 'join-cardinality', label: '基数（cardinality）', value: cardinality });
  }
  const autoJoinable = booleanOf(detail.auto_joinable);
  if (autoJoinable !== null) {
    facts.push({
      key: 'join-auto-joinable',
      label: '可自动 JOIN（auto_joinable）',
      value: String(autoJoinable),
    });
  }
  if (r.confidence !== null && r.confidence !== undefined) {
    facts.push({
      key: 'join-confidence',
      label: '置信度（confidence）',
      value: String(r.confidence),
    });
  }
  if (r.verified !== null && r.verified !== undefined && String(r.verified).trim() !== '') {
    facts.push({
      key: 'join-verified',
      label: '验证结论（verified）',
      value: decision.verified,
    });
  }
  facts.push({
    key: 'join-basis',
    label: '依据（basis）',
    value: joinBasis(r, detail, decision.verified, reliable),
  });
  const warning = fanoutWarning(autoJoinable, cardinality);
  if (warning) {
    facts.push({ key: 'join-fanout-warning', label: '风险（fanout_warning）', value: warning });
  }
  if (r.status === 'STALE') {
    facts.push({ key: 'join-stale-note', label: '结构漂移（stale_note）', value: JOIN_STALE_NOTE });
  }
  return { facts, care };
}

function valueDomainFragment(r: ConnectorSemanticRow): Record<string, unknown> | null {
  if (r.scope !== 'FIELD' || !r.detail) return null;
  const raw = r.detail.value_domain;
  return raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length > 0
    ? (raw as Record<string, unknown>)
    : null;
}

function valueDomainValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value) => value !== null && value !== undefined).map(String);
}

function storedValueDomainFacts(fragment: Record<string, unknown>): SemanticVisibilityFact[] {
  const facts: SemanticVisibilityFact[] = [];
  const values = valueDomainValues(fragment.values);
  const distinct = countOf(fragment.distinct_count);
  const note = strOf(fragment.note);
  if (values.length > 0) {
    facts.push({ key: 'value-domain-values', label: '实际取值', value: values.join('、') });
  }
  if (distinct !== null) {
    facts.push({ key: 'value-domain-distinct', label: '去重取值数', value: String(distinct) });
  }
  if (note) {
    facts.push({ key: 'value-domain-note', label: '采集说明', value: note });
  }
  return facts;
}

const VALUE_DOMAIN_STALE_VISIBILITY =
  '这一列的结构已经变过，平台此前采集到的取值集合属于旧的列形状，已经不再展示。' +
  '这不等于这一列没有枚举值——需要确切取值时自己查一次，或向用户确认。';
const VALUE_DOMAIN_BROKEN_VISIBILITY =
  '平台这一列的取值记录不完整（标着已采全，却没有取值），按【没有拿到】处理。' +
  '不要假设这一列只有某几个取值。';
const VALUE_DOMAIN_COMPLETE_VISIBILITY =
  '以下是该列在客户库中的全部实际取值。平台【不知道】每个取值代表什么业务含义，' +
  '也不会去猜——需要用到含义时请向用户确认。';
const VALUE_DOMAIN_UNKNOWN_VISIBILITY =
  '平台没有这一列的完整取值集合。这不等于它没有枚举值——不要据此写死查询条件，' +
  '需要确切取值时自己查一次，或向用户确认。';
const VALUE_DOMAIN_WITHHELD_VISIBILITY =
  '这条连接当前没有确认开放第 3 档（样本值），平台记下的这一列取值不向你展示。' +
  '这不等于这一列没有枚举值——不要据此写死查询条件，需要确切取值时自己查一次，或向用户确认。';
const VALUE_DOMAIN_TIER_DISABLED_VISIBILITY =
  '未启用样本值采集（数据出库档位第 3 档默认关闭），平台【没有去查】这一列的取值集合。' +
  '这不等于这一列没有枚举值——不要据此写死查询条件。';

/** 与 SemanticValueProfiler.Outcome.modelNote() 同表；未知 outcome 不猜，走通用兜底。 */
const VALUE_DOMAIN_OUTCOME_VISIBILITY: Record<string, string> = {
  ENUMERATED: VALUE_DOMAIN_COMPLETE_VISIBILITY,
  EMPTY: '该列当前一条非空取值都没有。这不等于它没有枚举值，只说明此刻是空的。',
  HIGH_CARDINALITY:
    '该列取值种类过多，平台【没有】采集它的取值集合。不要假设它只有某几个取值。',
  CARDINALITY_UNKNOWN:
    '平台没能测出该列有多少种取值（查询超时或失败），因此【没有】采集它的取值集合。' +
    '不要假设它只有某几个取值。',
  INCOMPLETE:
    '采集过程中该列的取值集合发生了变化，平台拿到的不是完整集合，因此【不采用】。' +
    '不要把它当成全集。',
  PII_BLOCKED: '该列疑似个人信息，平台【不采集】它的取值。',
  NOT_ELIGIBLE: '该列的类型或结构决定了它不会有有意义的枚举取值，平台【没有】去查。',
  TIER_DISABLED: VALUE_DOMAIN_TIER_DISABLED_VISIBILITY,
  FAILED: '采集该列取值时查询失败，平台【没有】拿到取值集合。不要假设它只有某几个取值。',
};

function valueDomainModelNote(
  fragment: Record<string, unknown>,
  claimsComplete: boolean,
  complete: boolean,
): string {
  if (claimsComplete !== complete) return VALUE_DOMAIN_BROKEN_VISIBILITY;
  const stored = strOf(fragment.note);
  if (stored) return stored;
  const outcome = strOf(fragment.outcome);
  if (outcome && VALUE_DOMAIN_OUTCOME_VISIBILITY[outcome]) {
    return VALUE_DOMAIN_OUTCOME_VISIBILITY[outcome];
  }
  return complete ? VALUE_DOMAIN_COMPLETE_VISIBILITY : VALUE_DOMAIN_UNKNOWN_VISIBILITY;
}

/**
 * 一条语义在「平台存着」与「模型此刻收到」之间的边界。
 *
 * 这不是另一套注入器：关系条件仍从 joinCare 取，表形态仍从 tableShapeOf 取，展开细账仍从
 * detailEntries 取。这里仅把三者归到工作台的三个可见性口袋里。
 */
export function semanticModelVisibility(
  r: ConnectorSemanticRow,
  tier: string | null | undefined,
  connectionStatus?: string | null,
  failedContext?: SemanticFailedContext,
  answeredTerms?: ReadonlySet<string>,
): SemanticModelVisibilityView {
  let hiddenReason: string | null = null;
  const joinDecision = r.scope === 'JOIN' ? joinInjectionDecision(r) : null;
  if (r.status === 'STALE' && r.scope === 'METRIC') {
    hiddenReason = rowStatusMeta(r.status, r.scope).hint;
  } else if (joinDecision?.hiddenReason) {
    hiddenReason = joinDecision.hiddenReason;
  } else if (normalizeSemanticVerified(r.verified) === 'REJECTED') {
    hiddenReason = verifiedMeta(r).hint;
  } else if (isAnsweredCaveat(r, answeredTerms)) {
    hiddenReason = '已有口径回答了这个问题，AI 不再使用这条。';
  } else if (isValueProfileRow(r) && !sampleValuesAllowed(tier)) {
    hiddenReason = '这条说明来自取值采集，只有第 3 档 · 样本值才提供给 AI；目前仅留存。';
  }
  const visible = hiddenReason === null;
  const current: SemanticVisibilityFact[] = [];
  const retained: SemanticVisibilityFact[] = [];
  const allowedMissing: SemanticVisibilityFact[] = [];
  const put = (fact: SemanticVisibilityFact) => (visible ? current : retained).push(fact);
  let projectedJoinCare: JoinCare | null = null;

  if (r.scope === 'JOIN') {
    if (r.gloss) {
      retained.push({
        key: 'join-gloss-retained',
        label: '关系说明',
        value: r.gloss,
      });
    }
    if (joinDecision?.hiddenReason) {
      retained.push({
        key: 'join-withheld-reason',
        label: '未使用的原因',
        value: joinDecision.hiddenReason,
      });
      const endpointParts = [
        r.fieldName ? `${r.objectName || '—'}.${r.fieldName}` : null,
        joinDecision.toObject || joinDecision.toColumn
          ? `${joinDecision.toObject || '缺目标表'}.${joinDecision.toColumn || '缺目标列'}`
          : null,
      ].filter(Boolean);
      if (endpointParts.length > 0) {
        retained.push({
          key: 'join-endpoint-retained',
          label: '留存端点',
          value: endpointParts.join(' → '),
        });
      }
      retained.push({
        key: 'join-verified-retained',
        label: '留存的验证结论',
        value: r.verified === null || r.verified === undefined || String(r.verified).trim() === ''
          ? '未验证'
          : String(r.verified),
      });
    } else if (joinDecision) {
      const projection = joinPayloadProjection(r, tier, joinDecision);
      current.push(...projection.facts);
      projectedJoinCare = projection.care;
    }
  } else if (r.gloss) {
    put({ key: 'gloss', label: '说明', value: r.gloss });
  }

  // 这里只有给管理员看的留存/缺失信息；真实 care_reason / condition 已按 payload 顺序投影进 current。
  // 未通过入口闸的关系绝不调用 joinCare，避免把畸形行的 care_reason 或判别值侧漏进 retained。
  const care = projectedJoinCare;
  if (care) {
    const condition = care.condition;
    if (condition?.type === 'DISCRIMINATOR') {
      if (condition.withheldValue !== null) {
        retained.push({
          key: 'withheld-value',
          label: '判别值（AI 看不到）',
          value: `${condition.column} = ${condition.withheldValue}`,
        });
      } else if (condition.valuesAllowed) {
        allowedMissing.push({
          key: 'missing-value',
          label: '判别值未取得',
          value: `${condition.column} 的取值还没取到；AI 会先去查，拿不准就问人。`,
        });
      }
    }
    if (care.careReasonWithheld) {
      const storedReason = detailEntries(r, tier).find((entry) => entry.key === 'care_reason');
      if (storedReason) retained.push(storedReason);
    }
  }

  const valueDomain = valueDomainFragment(r);
  if (valueDomain) {
    const storedFacts = storedValueDomainFacts(valueDomain);
    if (r.status === 'STALE') {
      current.push({
        key: 'value-domain-state',
        label: '值域状态',
        value: VALUE_DOMAIN_STALE_VISIBILITY,
      });
      retained.push(...storedFacts.map((fact) => ({ ...fact, key: `retained-${fact.key}` })));
    } else if (!sampleValuesAllowed(tier)) {
      current.push({
        key: 'value-domain-state',
        label: '值域状态',
        value: VALUE_DOMAIN_WITHHELD_VISIBILITY,
      });
      retained.push(...storedFacts.map((fact) => ({ ...fact, key: `retained-${fact.key}` })));
    } else {
      const values = valueDomainValues(valueDomain.values);
      const claimsComplete = valueDomain.complete === true;
      const complete = claimsComplete && values.length > 0;
      const distinct = countOf(valueDomain.distinct_count);
      current.push({
        key: 'value-domain-complete',
        label: '值域完整性',
        value: complete ? '已取得完整集合' : '没有取得完整集合',
      });
      if (complete) {
        current.push({ key: 'value-domain-values', label: '实际取值', value: values.join('、') });
      }
      if (distinct !== null) {
        current.push({ key: 'value-domain-distinct', label: '去重取值数', value: String(distinct) });
      }
      current.push({
        key: 'value-domain-note',
        label: '采集说明',
        value: valueDomainModelNote(valueDomain, claimsComplete, complete),
      });
    }
  }

  const shape = tableShapeOf(r);
  if (shape?.kind === 'SHAPE') {
    put({
      key: 'table-shape',
      label: '表形态',
      value: `${shape.shape.label} · ${shape.source.label}`,
    });
    if (shape.keyValue) {
      put({
        key: 'key-value-care',
        label: '聚合约束',
        value: `先按${shape.kvNameColumn ?? '指标名列'}筛出一个指标，再对${shape.kvValueColumn ?? '值列'}聚合。`,
      });
    }
  } else if (shape) {
    retained.push({
      key: 'table-shape-retained',
      label: shape.kind === 'LEGACY' ? '旧版表形态描述' : '未认出的表形态',
      value: shape.raw,
    });
  }

  return {
    connectionContext:
      connectionStatus === 'FAILED' ? semanticFailedVisibilityContext(failedContext) : null,
    visible,
    hiddenReason,
    current,
    retained,
    allowedMissing,
  };
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

// ---------------------------------------------------------------------------
// 结构刷新对语义层的影响（漂移处置）
// ---------------------------------------------------------------------------

/**
 * 可能为空的计数 → 数字。
 *
 * ★ 顺序不能反：**先判空，再 Number()**。`Number(null) === 0`、`Number('') === 0`，
 * 先转再判会把「漂移处置没跑成」（null）静默变成「没有影响」（0）——恰好抹掉后端刻意保留的那个区分。
 * 认不出来的值同样返回 null（「不知道」），不当成 0。
 */
export function countOf(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 一张消失的表确实带走了说明。 */
export interface RemovedHit {
  objectName: string;
  /** 失效的说明条数；读不出来时为 null。 */
  rows: number | null;
  /** 受波及的口径条数；读不出来时为 null。 */
  metrics: number | null;
  metricTerms: string[];
}

/**
 * 一张 REMOVED 的表对语义层的影响。**三态，界面上必须长得不一样：**
 * - HIT：有说明因此失效；
 * - NONE：核对过，本次没有说明因此失效；
 * - UNKNOWN：不知道。FAILED = 漂移处置没跑成；UNATTRIBUTED = 核对跑了，但分不清落在这张表上的有几条。
 */
export type RemovedTableImpact =
  | { kind: 'HIT'; hit: RemovedHit }
  | { kind: 'NONE' }
  | { kind: 'UNKNOWN'; reason: 'FAILED' | 'UNATTRIBUTED' };

export interface RefreshSemanticImpact {
  /** ★ 漂移处置没跑成。与 `staled === 0` 是两件事，任何地方都不能把两者合并。 */
  failed: boolean;
  /** 本次新标成「结构已变」的条数；failed 时为 null。 */
  staled: number | null;
  /** 本次恢复的条数；failed 或读不出来时为 null。 */
  revived: number | null;
  /** 按表明细；null = 没有这份明细（失败，或后端版本还没有这个字段）。 */
  byObject: SchemaRemovedImpact[] | null;
  /** 确实带走了说明的那些表。 */
  hits: RemovedHit[];
  /** 失效口径的词条，跨表去重、保序。 */
  lostTerms: string[];
  /** 失效口径条数：有词条的按去重后的词条数（一条口径可能涉及两张消失的表），只给了数没给词条的按数补上。 */
  lostMetricCount: number;
  /** 按表明细里条目在、数却读不出来的表数。它们是「不知道」，不是「没有」。 */
  unattributedTables: number;
}

function parseRemovedEntry(e: SchemaRemovedImpact): RemovedTableImpact {
  const rows = countOf(e.staledRows);
  const metrics = countOf(e.staledMetrics);
  const metricTerms = strListOf(e.metricTerms);
  if ((rows ?? 0) > 0 || (metrics ?? 0) > 0 || metricTerms.length > 0) {
    return { kind: 'HIT', hit: { objectName: e.objectName, rows, metrics, metricTerms } };
  }
  // 条目在、数却读不出来：不能说「没有」。
  if (rows === null) return { kind: 'UNKNOWN', reason: 'UNATTRIBUTED' };
  return { kind: 'NONE' };
}

function validEntries(list: SchemaRemovedImpact[] | null): SchemaRemovedImpact[] {
  return (list ?? []).filter((e) => !!e && typeof e.objectName === 'string');
}

/**
 * 汇总一次刷新对语义层的影响。
 *
 * 「有没有跑成」**只看 semanticStaled**，不看 semanticStaledByObject：前者是已经上线的字段，
 * 后者缺省既可能是失败、也可能只是后端比前端旧。拿后者判失败，前后端部署错开的那段时间里
 * 每一次刷新都会报「语义层没核对」——一个天天喊狼来了的提示，真失败那次就没人看了。
 */
export function refreshSemanticImpact(r: SchemaSnapshotResult): RefreshSemanticImpact {
  const staled = countOf(r.semanticStaled);
  const failed = staled === null;
  const byObject =
    !failed && Array.isArray(r.semanticStaledByObject) ? r.semanticStaledByObject : null;

  const hits: RemovedHit[] = [];
  let unattributedTables = 0;
  for (const e of validEntries(byObject)) {
    const p = parseRemovedEntry(e);
    if (p.kind === 'HIT') hits.push(p.hit);
    else if (p.kind === 'UNKNOWN') unattributedTables++;
  }

  const seen = new Set<string>();
  const lostTerms: string[] = [];
  let unnamedMetrics = 0;
  for (const h of hits) {
    for (const t of h.metricTerms) {
      if (!seen.has(t)) {
        seen.add(t);
        lostTerms.push(t);
      }
    }
    unnamedMetrics += Math.max((h.metrics ?? 0) - h.metricTerms.length, 0);
  }

  return {
    failed,
    staled,
    revived: failed ? null : countOf(r.semanticRevived),
    byObject,
    hits,
    lostTerms,
    lostMetricCount: lostTerms.length + unnamedMetrics,
    unattributedTables,
  };
}

/** 一次刷新对语义层的影响，拼成几段话。`quiet` 与 `clauses` 为空**互为充要**。 */
export interface RefreshImpactWording {
  /** 按轻重排：口径停用 → 说明标成「结构已变」→ 条数不明的表。 */
  clauses: string[];
  /** 核对过、确实没有任何说明受影响。★ 只有它为 true 时，界面才准说「没有说明受影响」。 */
  quiet: boolean;
}

/**
 * 差异标题、toast、「结构没变」那条横幅的措辞，**全部从这里取**。
 *
 * ★ 读的是与口径红条、各表影响标记**同一份按表明细**（hits / lostMetricCount），不只看总数 semanticStaled。
 *   按表的数是「本次**新归到**这张表上的」，不等于「本次**新标成**结构已变的」：一条早就「结构已变」的口径，
 *   这次又因另一张表消失归到它名下，总数 semanticStaled 是 0，红条却在说它停止提供给模型了。
 *   从前标题只看总数，同一屏上就会一边说「没有说明受影响」、一边说「口径已停用」。
 * ★ 漂移处置没跑成时返回 `quiet: false` 且没有任何一段——那种情况什么都说不了，更不能说「没有」，调用方另有专门的提示。
 */
export function refreshImpactWording(impact: RefreshSemanticImpact): RefreshImpactWording {
  if (impact.failed) return { clauses: [], quiet: false };
  const clauses: string[] = [];
  if (impact.lostMetricCount > 0) {
    clauses.push(`${impact.lostMetricCount} 条业务口径已停用`);
  }
  if (impact.staled !== null && impact.staled > 0) {
    clauses.push(`${impact.staled} 条说明被标成「结构已变」`);
  } else {
    // 总数是 0，按表明细里却有表带走了说明（早就是「结构已变」、这次才归到它名下）。
    // 不单说一句，各表标记上的「N 条说明结构已变」在标题里就找不到对应。
    const tables = impact.hits.filter((h) => h.rows !== null && h.rows > 0).length;
    if (tables > 0) clauses.push(`${tables} 张消失的表上有说明结构已变`);
  }
  if (impact.unattributedTables > 0) {
    clauses.push(`${impact.unattributedTables} 张消失的表影响条数不明`);
  }
  // 按构造每一条 hit 都已落进上面某一段（有口径的进 lostMetricCount，有说明的进总数或单独那段）。
  // 仍兜一层：将来谁改了 hit 的判定，也不许让一条 hit 被说成「没有说明受影响」。
  if (clauses.length === 0 && impact.hits.length > 0) {
    clauses.push(`${impact.hits.length} 张消失的表上有说明失效`);
  }
  return { clauses, quiet: clauses.length === 0 };
}

/** 某一张 REMOVED 的表的影响。 */
export function removedTableImpact(
  impact: RefreshSemanticImpact,
  objectName: string,
): RemovedTableImpact {
  if (impact.failed) return { kind: 'UNKNOWN', reason: 'FAILED' };
  if (impact.byObject === null) {
    // 没有按表明细：只有总数是 0 才能说「没有」；否则那几条落在哪张表上是「不知道」。
    return impact.staled === 0 ? { kind: 'NONE' } : { kind: 'UNKNOWN', reason: 'UNATTRIBUTED' };
  }
  const list = validEntries(impact.byObject);
  // 先精确匹配；大小写不同的兜底只在精确匹配不到时才用（表名分不分大小写取决于客户库的配置）。
  const lower = objectName.toLowerCase();
  const e =
    list.find((x) => x.objectName === objectName) ??
    list.find((x) => x.objectName.toLowerCase() === lower);
  return e ? parseRemovedEntry(e) : { kind: 'NONE' };
}

// ---------------------------------------------------------------------------
// 刷新被拒 / 截断 / 差异列表之外的影响
// ---------------------------------------------------------------------------

/**
 * 刷新被拒绝的原因（后端原话）。空串、非字符串一律当没有。
 *
 * ★ 非空时这次返回里的其它字段都不描述一份已保存的快照，调用方必须**先判它**再往下走：
 * `semanticStaled` 为 null 在这里不是「漂移处置没跑成」，`diffs` 为空也不是「结构没有变化」。
 */
export function guardNoteOf(r: SchemaSnapshotResult): string | null {
  return typeof r.guardNote === 'string' ? strOf(r.guardNote) : null;
}

/**
 * 截断说明。没截断返回 null。
 *
 * 优先用后端原话：只有后端知道快照按什么排的序。后端比前端旧、没给时的兜底**不许出现「前 N 个」**——
 * 快照按重要性排，不按表名，一个「前」字就会让人按字母序去脑补漏掉的是哪些表。
 */
export function truncationNoteOf(r: SchemaSnapshotResult): string | null {
  if (r.truncated !== true) return null;
  const note = typeof r.truncationNote === 'string' ? strOf(r.truncationNote) : null;
  return (
    note ??
    `共 ${r.totalObjects} 个对象，本次只覆盖 ${r.objectCount} 个，其余没有检测结构变化。`
  );
}

/**
 * 按表明细里、**不在本次 REMOVED 差异里**的那些表。
 *
 * 为什么会有：删除已经在更早的一次刷新里随快照存下了，而那次语义层没能跟着核对。后端把那次没处置成的删除记下，
 * 在下一次刷新（手动或定时，谁先跑谁处置）重新应用——这一次的 diff 里却不会再有它们的「删除」。
 * 只沿着差异列表去找这些明细，它们就只剩一个总数、说不出是哪张表带走的，
 * 「下一次刷新会补上处置、按表列出」那句承诺在界面上就落了空。
 */
export function unlistedRemovedHits(
  impact: RefreshSemanticImpact,
  diffs: ReadonlyArray<{ objectName: string; change: string }>,
): RemovedHit[] {
  if (impact.failed || impact.hits.length === 0) return [];
  // 与 removedTableImpact 同一条匹配规则：表名分不分大小写取决于客户库，两边都按不分处理才不会一张表算两次。
  const listed = new Set(
    diffs
      .filter((d) => d.change === 'REMOVED' && typeof d.objectName === 'string')
      .map((d) => d.objectName.toLowerCase()),
  );
  return impact.hits.filter((h) => !listed.has(h.objectName.toLowerCase()));
}
