import type { ToolCallView } from '@/features/chat-admin/types';

/**
 * 工具调用步骤的视觉分类。后端 SSE 目前只下发通用工具调用（name/desc/input/output/status），
 * 不区分「知识库 / 工具 / 插件 / Skill」，这里在前端按名称/描述/输出做启发式推断，
 * 推不准时一律回退到通用的 'tool'，保证绝不丢数据、绝不误导。
 * 纯函数，便于单测。
 */
export type StepKind = 'kb' | 'tool' | 'plugin' | 'skill';

// 关键词命中即归类；顺序：kb → plugin → skill → 兜底 tool。
const KB_RE = /检索|知识库|向量|资料库|文档库|retriev|knowledge|\brag\b|vector|embedding/i;
const PLUGIN_RE =
  /插件|通知|推送|飞书|钉钉|企业?微信|lark|webhook|web ?hook|\bhook\b|plugin|notif|push|发送/i;
const SKILL_RE = /\bskill\b|技能|对比|生成报告|归纳总结|汇总成|拉成一张表|方案对比/i;

/** 推断步骤分类。仅看 name + desc，避免被冗长 output 误导。 */
export function inferStepKind(call: Pick<ToolCallView, 'name' | 'desc'>): StepKind {
  const hay = `${call.name ?? ''} ${call.desc ?? ''}`;
  if (KB_RE.test(hay)) return 'kb';
  if (PLUGIN_RE.test(hay)) return 'plugin';
  if (SKILL_RE.test(hay)) return 'skill';
  return 'tool';
}

/** 分类的中文标签（右上角彩色 tag 用）。 */
export function kindLabel(kind: StepKind): string {
  switch (kind) {
    case 'kb':
      return '知识库';
    case 'plugin':
      return '插件';
    case 'skill':
      return 'Skill';
    default:
      return '工具';
  }
}

/**
 * 标题的硬上限。超过就截断加省略号。
 *
 * <p>48 不是拍的：现有 17 个工具描述取首句后最长 47 字（`conn_execute`）。定 48 是让今天的全部
 * 工具都能完整显示，同时给未来写得更长的留一道闸——**首句本身也可能很长**，只切句号不设上限，
 * 等于把边界完全交给写描述的人，而那正是当初出问题的方式。
 */
const TITLE_MAX = 48;

/**
 * 从 desc 里取出适合当标题的一句。
 *
 * <h3>为什么要切</h3>
 * `desc` 来自工具定义的 `description`，而那个字段是**写给模型的**：它要的是负向约束、失败模式、
 * 决策程序，越显式越好。`conn_describe` 的描述有 2457 字。整段当标题渲染的后果是
 * 「处理过程」面板被撑成几屏，真正有用的入参（表名）被挤没，而且模型指令
 * （「请如实告知用户，不要编造数据」）会以平台口吻出现在客户眼前。
 *
 * <h3>只按「。」和换行切，不切「【」</h3>
 * 本仓库的描述里「【】」是**句中强调**（`执行一条【会改变数据】的语句`），不是段落标记。
 * 拿它当分隔符会把句子腰斩——实测 `conn_execute` 被切成「在某个连接器上执行一条」、
 * `conn_define_metric` 被切成「把用户」。按「。」+ 换行切，现有 17 个工具全部得到 11~47 字的完整短句。
 *
 * <h3>这是止血，不是终局</h3>
 * 真正的修法是给工具定义加一个独立的展示名字段，让「教模型」和「给用户看」各有各的载体。
 * 但那治不了**已经落库的历史会话**——`desc` 会随 SSE 折叠进 `chat_message.segments` 存下来，
 * 而历史回看走的就是这里。**渲染期截断是唯一能同时覆盖新老会话的地方**，所以即使将来加了
 * 展示名字段，这段兜底也要留着（租户自己装的 skill 也永远不会有那个字段）。
 */
export function shortenDesc(desc: string): string {
  const first = desc.split(/[。\n]/, 1)[0].trim();
  // 首句切出来是空的（desc 以句号/换行开头）时退回整段，交给下面的长度闸。
  const base = first || desc.trim();
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX)}…` : base;
}

/** 标题是否被截短了——调用方据此决定要不要在详情里补上完整原文。 */
export function isDescTruncated(desc: string | undefined): boolean {
  const d = desc?.trim();
  return !!d && shortenDesc(d) !== d;
}

/** 卡片标题：优先用 desc 的首句（见 {@link shortenDesc}），否则回退到原始工具名（等宽样式）。 */
export function stepTitle(call: Pick<ToolCallView, 'name' | 'desc'>): {
  text: string;
  mono: boolean;
} {
  const desc = call.desc?.trim();
  if (desc) return { text: shortenDesc(desc), mono: false };
  return { text: call.name || '工具调用', mono: true };
}

/** 把入参格式化成副标题：对象 → 「k: v · k: v」；字符串原样；空 → 空串。 */
export function formatStepInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  if (Array.isArray(input)) return JSON.stringify(input);
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join('  ·  ');
}

/** 尝试从输出里数出「条数」：JSON 数组取长度；带 total/count/length 的对象取该字段。数不出来返回 null。 */
function countFromOutput(output?: string): number | null {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === 'object') {
      for (const key of ['total', 'count', 'length', 'size']) {
        const n = (parsed as Record<string, unknown>)[key];
        if (typeof n === 'number' && Number.isFinite(n)) return n;
      }
      // 对象里第一个数组字段（如 { results: [...] }）
      for (const v of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(v)) return v.length;
      }
    }
  } catch {
    /* 非 JSON，数不出来 */
  }
  return null;
}

/**
 * 右侧结果摘要——只说能确证的话：
 * - 失败/进行中：失败 / null（进行中交给状态图标）
 * - 能数出条数：kb→「命中 N 个分片」，其它→「返回 N 条」
 * - 插件且输出里有 @某人：「已 @某人」
 * - 否则按分类给确定性兜底文案：skill→已生成、plugin→已发送、kb→已检索、tool→已完成
 */
export function summarizeResult(call: ToolCallView, kind: StepKind): string | null {
  if (call.status === 'error') return '失败';
  if (call.status === 'running') return null;

  // output 可能是字符串（Bash stdout）或对象（如 generate_image 的 { urls, ... }）；
  // countFromOutput / match 只对字符串有意义，对象时跳过。
  const outputStr = typeof call.output === 'string' ? call.output : undefined;

  const n = countFromOutput(outputStr);
  if (n != null) return kind === 'kb' ? `命中 ${n} 个分片` : `返回 ${n} 条`;

  if (kind === 'plugin' && outputStr) {
    const m = outputStr.match(/@\s*([^\s,，。、]{1,16})/);
    if (m) return `已 @${m[1]}`;
  }

  switch (kind) {
    case 'kb':
      return '已检索';
    case 'plugin':
      return '已发送';
    case 'skill':
      return '已生成';
    default:
      return '已完成';
  }
}
