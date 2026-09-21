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
    desc: '本次该覆盖的表没覆盖全。没覆盖到的那些表，模型完全看不到——它不会说「我不知道这张表」，只会用看得到的表凑一个答案。',
  },
  TABLES_GAVE_UP: {
    label: '有表反复失败后被放弃',
    desc: '有表试过几次都没生成出来，已被放弃。重新生成大概率还是同样结果，要先看那几张表本身出了什么问题。',
  },
  SNAPSHOT_TRUNCATED: {
    label: '结构快照本身就不全',
    desc: '客户库的对象数超过了结构快照的上限，超出的表根本没进过快照，因此也不会有语义。★ 只重新生成语义层补不回来，得先解决快照那一层。',
  },
  MODEL_OUTPUT_TRUNCATED: {
    label: '模型输出被截断',
    desc: '模型这次的输出超了长度上限，尾部被截掉（已保留到最后一个完整条目）。调大 connector.semantic.max-tokens 后重新生成通常能补全。',
  },
};

/** 认不出来的成因码也要显示出来。静默丢掉一条缺口，等于把「缺了什么」这个问题重新答错一次。 */
export function semanticGapMeta(code: string): SemanticGapMeta {
  return (
    GAP_META[code as SemanticGapCode] ?? {
      label: `未知缺口（${code}）`,
      desc: '后端报了一种本页还不认识的残缺成因，前端需要补一条映射。在补上之前，请按「说明书不完整」处理。',
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

/**
 * 残缺意味着什么，一句话。列表悬停和抽屉横幅**共用这一句**——
 * 两处各写一份文案，迟早会漂成两种说法，而这句话正是这个标记存在的全部理由。
 */
export const SEMANTIC_PARTIAL_CONSEQUENCE =
  '说明书不完整：缺掉的那些表和字段，模型看不到。它不会因此报错，也不会说「我不知道」，只会拿看得到的部分凑一个答案——一个看起来很正常的错数字。';

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
    desc: '两张表怎么连。★ 标「未经数据验证」的只是按命名推的；标「多态关联 / 复合键」的，join 时必须带上它写明的条件——漏了不报错，只会把数字串了或放大。',
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
 * ★ JOIN 的 NONE 必须说重话。没用数据核过的表关系只是「名字看着像」，而它和一条外键在界面上
 * 长得一样，就会被当成事实用，错了只会返回一个看起来很正常的数字。其它 scope 的 NONE 是常态，
 * 说成「未验证」即可。
 *
 * ★ 多态关联 / 复合键：**数据核过也不等于能直接 join**。标签照实写验证结论（那是数据说的），
 * 但解释里必须补一句——否则一个绿色的「数据已验证」会把一条漏了类型条件就串表的关系说成可以放心用。
 */
export function verifiedMeta(r: ConnectorSemanticRow): TagMeta {
  const v = r.verified ?? 'NONE';
  let meta: TagMeta;
  if (r.scope === 'JOIN' && v === 'NONE') {
    meta = {
      label: '未经数据验证',
      color: 'orange',
      hint: '没有用数据核过（数据出库档位不允许、采样预算用完、或还没轮到），只是按命名推出来的推测。join 之前请先看该列的取值分布。',
    };
  } else {
    const hit: TagMeta | undefined = VERIFIED_META[v as SemanticVerified];
    meta = hit ?? { label: `未知（${v}）`, hint: '本页还不认识这个 verified 取值。' };
  }
  // 这里只要形态的名字，不要条件——所以走 joinKindMeta，不牵扯档位（条件里的取值给不给模型才看档位）。
  const kind = joinKindMeta(r);
  if (kind && v !== 'REJECTED') {
    return {
      ...meta,
      hint: `${meta.hint} 另外这是一条「${kind.label}」关系：即使数据核过，也只作为需要带条件的关系提供给模型，不当普通 join 用。`,
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
    hint: '它锚的表/列结构已经变了，这条说明可能已经过时。它仍会提供给模型，但带着「结构已变」的标记（让模型以实时结构为准）。重新生成会重推机器推断的那部分；人答的口径需要在对话里重新确认。',
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
  hint: '它引用的表或列已经变了（或消失了），这条口径可能已经不成立。结构已变的业务口径整条不再提供给模型——模型再遇到这个词会按自己的理解去算。表如果是改名或迁移了，需要业务方在对话里重新答一次；表恢复之后刷新结构，状态会自动撤销。',
};

export function rowStatusMeta(v?: string | null, scope?: string | null): TagMeta {
  if (v === 'STALE' && scope === 'METRIC') return STALE_METRIC_META;
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
  /** 复合键：目标表的这几列都要对上。 */
  | { type: 'COMPOSITE'; target: string | null; columns: string[] };

export interface JoinCare {
  label: string;
  /** 这种关系形态一般意味着什么（后端没给理由、或理由被档位挡下时兜底显示它）。 */
  hint: string;
  /** 模型此刻读得到的那句人话理由：为什么这条关系要当心。null = 没有，或被档位挡下了（见 careReasonWithheld）。 */
  careReason: string | null;
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
    hint: '这一列按另一列（判别列）的取值指向不同的表，比如 target_type + target_id。不加类型条件直接 join，指向别的表的行也会被连进来——不报错，数字串了。',
  },
  COMPOSITE: {
    label: '复合键',
    hint: '目标表要几列合起来才唯一。只按其中一列 join 会一行对多行，把数字放大——不报错，看起来照样正常。',
  },
};

/**
 * JOIN 行的关系形态叫什么、一般意味着什么。非 JOIN、SIMPLE、存量行（没有 join_kind）返回 null。
 * 只要名字、不要条件的地方用它（验证列的悬停说明、分组标题上的计数），不牵扯档位。
 */
function joinKindMeta(r: ConnectorSemanticRow): { kind: string; label: string; hint: string } | null {
  if (r.scope !== 'JOIN' || !r.detail) return null;
  const kind = strOf(r.detail.join_kind);
  if (!kind || kind === 'SIMPLE') return null;
  if (kind === 'POLYMORPHIC' || kind === 'COMPOSITE') return { kind, ...JOIN_KIND_META[kind] };
  // 认不出来的形态不能当 SIMPLE 放过去：后端特意标出来的，就不是普通关联。
  return {
    kind,
    label: `未知关系形态（${kind}）`,
    hint: '本页还不认识这个 join_kind。后端特意标出来的都不是普通关联，join 前先核。',
  };
}

/**
 * 这一行存着的判别值（以及嵌着它写的那句 care_reason）此刻被档位挡下、**不给模型**。
 *
 * 与给模型的工具同一条判据：多态关联 + 存着判别值 + 连接当前档位没开放样本值。
 * 不看判别列在不在——工具挡理由时也不看。joinCare 与 detailEntries 都走这里，两处不许各写一份。
 */
function storedValueWithheld(r: ConnectorSemanticRow, tier: string | null | undefined): boolean {
  if (r.scope !== 'JOIN' || !r.detail) return false;
  return (
    strOf(r.detail.join_kind) === 'POLYMORPHIC' &&
    strOf(r.detail.discriminator_value) !== null &&
    !sampleValuesAllowed(tier)
  );
}

/**
 * JOIN 行「需要当心」的那部分：**模型此刻读得到的**理由与条件。非 JOIN、SIMPLE、存量行（没有 join_kind）一律返回 null。
 *
 * ★ `tier` 是连接的当前档位（ConnectorView.semanticDataTier），**刻意是必填参数**：存着的判别值给不给模型取决于它，
 *   漏传就会退回「存了就画成模型在用」——正是这里要堵的那种不报错的错。
 * ★ SIMPLE 刻意不画：满屏「普通关联」是纯噪声，会把真正要带条件的那几条淹掉。
 */
export function joinCare(r: ConnectorSemanticRow, tier: string | null | undefined): JoinCare | null {
  const km = joinKindMeta(r);
  if (!km || !r.detail) return null;
  const d = r.detail;
  const { label, hint } = km;
  const storedReason = strOf(d.care_reason);
  if (km.kind === 'POLYMORPHIC') {
    const column = strOf(d.discriminator_column);
    const stored = strOf(d.discriminator_value);
    const allowed = sampleValuesAllowed(tier);
    const withheld = storedValueWithheld(r, tier);
    return {
      label,
      hint,
      careReason: withheld ? null : storedReason,
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
    const columns = strListOf(d.composite_columns);
    return {
      label,
      hint,
      careReason: storedReason,
      careReasonWithheld: false,
      condition: columns.length
        ? { type: 'COMPOSITE', target: strOf(d.to_object), columns }
        : null,
    };
  }
  return { label, hint, careReason: storedReason, careReasonWithheld: false, condition: null };
}

const TABLE_SHAPE_META: Record<TableShape, TagMeta> = {
  DETAIL: { label: '明细表', hint: '一行是一条业务记录，可以直接按行计数、求和。' },
  MULTI_METRIC_PERIOD: {
    label: '多指标周期表',
    color: 'blue',
    hint: '一行是一个周期（天 / 月…）的一组已经汇总好的指标。按行计数数的是周期数，不是业务记录数。',
  },
  // ★ 本组唯一需要一眼看出来的形态：当成明细表处理时所有聚合都是错的，而且不报错。
  KEY_VALUE: {
    label: '键值对表',
    color: 'volcano',
    hint: '一行不是一条记录，而是一对「指标名 = 值」。当成明细表直接求和、计数，所有聚合都是错的——必须先按指标名那一列筛出一个指标，再对值那一列聚合。',
  },
  OTHER: { label: '其他形态', hint: '不属于明细表 / 多指标周期表 / 键值对表。' },
};

const TABLE_SHAPE_SOURCE_META: Record<TableShapeSource, TagMeta> = {
  MEASURED: { label: '实测', color: 'green', hint: '用真实数据测出来的形态，不只是看名字判断的。' },
  MODEL: { label: '模型判断', hint: '模型看表名、列名和注释判断的，没有用数据测过。' },
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
  composite_columns: '目标表的复合键列',
  table_shape: '表形态',
  table_shape_source: '形态怎么定的',
  table_shape_model_guess: '模型原判',
  kv_name_column: '指标名列',
  kv_value_column: '指标值列',
  // ── 采样验证（JOIN）的细账。原样显示英文键名等于没显示：看这里的是企业超管，不是写这段代码的人 ──
  auto_joinable: '可直接 join',
  sample_n: '采样的去重取值数',
  match_n: '其中在目标表命中的',
  containment: '包含率',
  verify_note: '验证说明',
  // ── 表形态实测（OBJECT）──
  table_shape_measurement: '形态实测',
  // ── 口径 / 歧义（METRIC / CAVEAT）──
  stale_removed_objects: '因这些表消失而失效',
};

/** 旧行（没有 table_shape_source）上 table_shape 的标签：原文是一句旧描述，不是四种形态之一，工具也不给模型。 */
const LEGACY_TABLE_SHAPE_LABEL = '表形态（旧版描述，不提供给模型）';

/** 来源或取值认不出的 table_shape 的标签。工具同样整行丢掉，模型读不到。 */
const UNRECOGNIZED_TABLE_SHAPE_LABEL = '表形态（未认出，不提供给模型）';

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
    const label: string | undefined = MEASUREMENT_OUTCOME_LABEL[outcome as TableShapeMeasurementOutcome];
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
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
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
    return b
      ? '是（目标列唯一，按它 join 不会放大行数）'
      : '否（目标列没有确认唯一，按它 join 可能把行数放大，只标注、不自动 join）';
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
export function detailEntries(r: ConnectorSemanticRow, tier: string | null | undefined): DetailEntry[] {
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
      out.push({ key: k, label: '判别值（当前档位不提供给模型）', value: plainValue(v) });
      continue;
    }
    if (withheld && k === 'care_reason') {
      out.push({
        key: k,
        label: '为什么要当心（原话嵌着取值，当前档位不提供给模型，模型收到的是通用说明）',
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
    clauses.push(`${impact.lostMetricCount} 条业务口径已停止提供给模型`);
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
    `共 ${r.totalObjects} 个对象，本次只覆盖了其中 ${r.objectCount} 个；其余对象没有进快照，也不在结构漂移检测范围内。`
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
