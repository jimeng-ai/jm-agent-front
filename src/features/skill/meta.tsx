import {
  SCOPE_LABEL,
  STATUS_DOT,
  STATUS_LABEL,
  TYPE_LABEL,
  TYPE_STYLE,
  type SkillScope,
  type SkillStatus,
  type SkillType,
} from './skillMeta';

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: '0 8px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 6,
  lineHeight: 1,
};

export function SkillTypeChip({ type }: { type: SkillType }) {
  const s = TYPE_STYLE[type] ?? TYPE_STYLE.PROMPT;
  return (
    <span
      style={{ ...chipBase, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

export function SkillScopeChip({ scope }: { scope: SkillScope }) {
  const tenant = scope === 'TENANT';
  return (
    <span
      style={{
        ...chipBase,
        color: tenant ? '#0369A1' : '#475569',
        background: tenant ? '#F0F9FF' : '#F1F5F9',
        border: `1px solid ${tenant ? '#BAE6FD' : '#E2E8F0'}`,
      }}
    >
      {SCOPE_LABEL[scope] ?? scope}
    </span>
  );
}

export function SkillStatusDot({ status }: { status: SkillStatus }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        color: '#475569',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: STATUS_DOT[status] ?? '#94A3B8',
          flex: 'none',
        }}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
