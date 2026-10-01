import { UNCLASSIFIED, domainLabel } from './text';
import type { TableCard } from './types';

/**
 * 领域颜色：固定 8 色，按领域第一次出现的顺序分配（设计文档 §8.5）。都是深色画布上的色条和圆点，
 * 与卡片底色 #0a1b2e / #0d2438 的对比度都在 3:1 以上（WCAG 非文字对比）。「未分类」固定用灰色。
 */
export const DOMAIN_PALETTE = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#fb923c',
  '#2dd4bf',
  '#a3e635',
] as const;

export const UNCLASSIFIED_COLOR = '#7c8ea3';

export interface DomainOption {
  /** 显示的领域名；没有领域的是「未分类」。 */
  label: string;
  color: string;
}

/**
 * 这个系统的领域清单：按对象顺序（后端已按重要性排好）第一次出现的顺序排，「未分类」放最后。
 * 超过 8 个领域时颜色循环使用（后端最多给 8 个，这里只是兜底）。
 */
export function domainOptions(tables: TableCard[]): DomainOption[] {
  const seen: string[] = [];
  let unclassified = false;
  for (const table of tables) {
    if (table.domain === null) {
      unclassified = true;
    } else if (!seen.includes(table.domain)) {
      seen.push(table.domain);
    }
  }
  const options = seen.map((label, index) => ({
    label,
    color: DOMAIN_PALETTE[index % DOMAIN_PALETTE.length],
  }));
  return unclassified ? [...options, { label: UNCLASSIFIED, color: UNCLASSIFIED_COLOR }] : options;
}

export const colorOf = (options: DomainOption[], domain: string | null): string =>
  options.find((option) => option.label === domainLabel(domain))?.color ?? UNCLASSIFIED_COLOR;
