import dayjs from 'dayjs';
import type { Num, StepType, TraceStatus, TraceStep } from './types';

/** 把可能为字符串的数值统一转成 number（data-service 开启 write_numbers_as_strings）。 */
export function num(v: Num | undefined | null): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const STATUS_TEXT: Record<TraceStatus, string> = {
  SUCCESS: '成功',
  WARN: '告警',
  ERROR: '错误',
  CANCELLED: '用户停止',
};

export const STATUS_COLOR: Record<TraceStatus, string> = {
  SUCCESS: 'success',
  WARN: 'warning',
  ERROR: 'error',
  CANCELLED: 'default',
};

export const STEP_TYPE_TEXT: Record<StepType, string> = {
  LLM: 'LLM 推理',
  KB_SEARCH: '知识库检索',
  RERANK: 'Re-rank',
  TOOL_CALL: '工具调用',
  PLUGIN_TRIGGER: '插件触发',
};

/** 时间线图标颜色（与耗时分布条同色系）。 */
export const STEP_TYPE_COLOR: Record<StepType, string> = {
  LLM: '#7c6cf0',
  KB_SEARCH: '#22b07d',
  RERANK: '#22b07d',
  TOOL_CALL: '#e8893b',
  PLUGIN_TRIGGER: '#c850c0',
};

/** 耗时分布的归并分组（图里的 LLM / RAG / 工具 / 插件）。 */
export type DurationGroupKey = 'LLM' | 'RAG' | 'TOOL' | 'PLUGIN';

export const DURATION_GROUP_META: Record<DurationGroupKey, { label: string; color: string }> = {
  LLM: { label: 'LLM 推理', color: '#7c6cf0' },
  RAG: { label: 'RAG', color: '#22b07d' },
  TOOL: { label: '工具', color: '#e8893b' },
  PLUGIN: { label: '插件', color: '#c850c0' },
};

function groupOf(type: StepType): DurationGroupKey {
  switch (type) {
    case 'LLM':
      return 'LLM';
    case 'KB_SEARCH':
    case 'RERANK':
      return 'RAG';
    case 'PLUGIN_TRIGGER':
      return 'PLUGIN';
    case 'TOOL_CALL':
    default:
      return 'TOOL';
  }
}

export interface DurationSlice {
  key: DurationGroupKey;
  label: string;
  color: string;
  ms: number;
  percent: number;
}

/** 按步骤类型聚合耗时，算各分组占比。 */
export function durationDistribution(steps: TraceStep[] | undefined): DurationSlice[] {
  const acc: Record<DurationGroupKey, number> = { LLM: 0, RAG: 0, TOOL: 0, PLUGIN: 0 };
  (steps ?? []).forEach((s) => {
    acc[groupOf(s.stepType)] += num(s.durationMs);
  });
  const total = Object.values(acc).reduce((a, b) => a + b, 0);
  return (Object.keys(acc) as DurationGroupKey[])
    .map((key) => ({
      key,
      label: DURATION_GROUP_META[key].label,
      color: DURATION_GROUP_META[key].color,
      ms: acc[key],
      percent: total > 0 ? Math.round((acc[key] / total) * 100) : 0,
    }))
    .filter((s) => s.ms > 0);
}

/** 毫秒 → 可读耗时。 */
export function formatDuration(ms: Num | undefined): string {
  const v = num(ms);
  if (v < 1000) return `${v}ms`;
  return `${(v / 1000).toFixed(2)}s`;
}

/** 兼容 ISO 字符串 / epoch（数字或数字字符串）。 */
export function formatTime(v: string | undefined, fmt = 'YYYY-MM-DD HH:mm:ss'): string {
  if (!v) return '-';
  const n = Number(v);
  const d = Number.isFinite(n) && String(n) === v.trim() ? dayjs(n) : dayjs(v);
  return d.isValid() ? d.format(fmt) : '-';
}

export function formatTokens(v: Num | undefined): string {
  return num(v).toLocaleString('en-US');
}
