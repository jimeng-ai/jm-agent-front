import { WarningOutlined } from '@ant-design/icons';
import { SCOPE_ORDER, scopeMeta, semanticAttentionReasons } from '@/features/connector/semantic';
import type { ConnectorSemanticRow, SemanticScope } from '@/features/connector/types';

export type SemanticScopeFilter = SemanticScope | 'ATTENTION' | 'UNKNOWN';

interface Props {
  rows: ConnectorSemanticRow[];
  tier: string | null | undefined;
  answeredTerms: ReadonlySet<string>;
  value: SemanticScopeFilter;
  onChange: (value: SemanticScopeFilter) => void;
}

export default function SemanticScopeRail({ rows, tier, answeredTerms, value, onChange }: Props) {
  const attentionCount = rows.filter(
    (row) => semanticAttentionReasons(row, tier, answeredTerms).length > 0,
  ).length;
  const unknownCount = rows.filter(
    (row) => !SCOPE_ORDER.includes(row.scope as SemanticScope),
  ).length;
  const items: Array<{ value: SemanticScopeFilter; label: string; desc: string; count: number }> = [
    {
      value: 'ATTENTION',
      label: '需关注',
      desc: '',
      count: attentionCount,
    },
    ...SCOPE_ORDER.map((scope) => ({
      value: scope,
      label: scopeMeta(scope).label,
      desc: scopeMeta(scope).desc,
      count: rows.filter((row) => row.scope === scope).length,
    })),
    {
      value: 'UNKNOWN',
      label: '未知分类',
      desc: '无法归类的说明。',
      count: unknownCount,
    },
  ];

  return (
    <nav
      className="semantic-scope-rail"
      data-testid="semantic-scope-rail"
      aria-label="按分类筛选"
    >
      <div className="semantic-rail-title">SCOPE INDEX</div>
      <div className="semantic-scope-options">
        {items.map((item) => (
          <button
            type="button"
            key={item.value}
            className={`semantic-scope-option ${value === item.value ? 'is-active' : ''}`}
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
          >
            <span className="semantic-scope-name">
              {item.value === 'ATTENTION' && <WarningOutlined aria-hidden="true" />}
              {item.label}
            </span>
            <span className="semantic-scope-count" aria-label={`${item.count} 条`}>
              {item.count}
            </span>
            <span className="semantic-scope-desc">{item.desc}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
