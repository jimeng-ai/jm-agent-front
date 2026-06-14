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

/** 卡片标题：优先用人类可读的 desc，否则回退到原始工具名（原始名会以等宽样式呈现）。 */
export function stepTitle(call: Pick<ToolCallView, 'name' | 'desc'>): {
  text: string;
  mono: boolean;
} {
  const desc = call.desc?.trim();
  if (desc) return { text: desc, mono: false };
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

  const n = countFromOutput(call.output);
  if (n != null) return kind === 'kb' ? `命中 ${n} 个分片` : `返回 ${n} 条`;

  if (kind === 'plugin' && call.output) {
    const m = call.output.match(/@\s*([^\s,，。、]{1,16})/);
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
