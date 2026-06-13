// 对齐 claude.ai/design 「agent-platform」设计稿的 Trace 视觉元素：
// 步骤类型色块图标（.gly）+ 状态 pill（.tag + .status-dot）。
import type { StepType, TraceStatus } from '../types';

type GlyphKind = 'llm' | 'rag' | 'tool' | 'plug';

const KIND_OF: Record<StepType, GlyphKind> = {
  LLM: 'llm',
  KB_SEARCH: 'rag',
  RERANK: 'rag',
  TOOL_CALL: 'tool',
  PLUGIN_TRIGGER: 'plug',
};

// 设计稿 .gly.<kind> 配色
const GLYPH_STYLE: Record<GlyphKind, { bg: string; fg: string }> = {
  llm: { bg: '#eef2ff', fg: '#4338ca' },
  rag: { bg: '#ecfdf5', fg: '#047857' },
  tool: { bg: '#fff7ed', fg: '#c2410c' },
  plug: { bg: '#fdf4ff', fg: '#a21caf' },
};

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// 与设计稿 icons.jsx 同款图标
const GLYPH_ICON: Record<GlyphKind, React.ReactNode> = {
  llm: (
    <Svg>
      <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </Svg>
  ),
  rag: (
    <Svg>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5Z" />
      <path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3" />
    </Svg>
  ),
  tool: (
    <Svg>
      <path d="M14.7 6.3a4 4 0 1 1-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5Z" />
    </Svg>
  ),
  plug: (
    <Svg>
      <path d="M9 2v4" />
      <path d="M15 2v4" />
      <path d="M7 6h10v6a5 5 0 0 1-10 0Z" />
      <path d="M12 17v5" />
    </Svg>
  ),
};

/** 步骤类型色块图标。 */
export function StepGlyph({ type }: { type: StepType }) {
  const kind = KIND_OF[type] ?? 'tool';
  const { bg, fg } = GLYPH_STYLE[kind];
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        display: 'grid',
        placeItems: 'center',
        background: bg,
        color: fg,
        flexShrink: 0,
      }}
    >
      {GLYPH_ICON[kind]}
    </span>
  );
}

// 设计稿 .tag + .status-dot 配色
const STATUS_STYLE: Record<
  TraceStatus,
  { bg: string; fg: string; dot: string; ring?: string; label: string }
> = {
  SUCCESS: {
    bg: '#ecfdf5',
    fg: '#047857',
    dot: '#10b981',
    ring: '0 0 0 2px rgb(16 185 129 / 0.16)',
    label: '成功',
  },
  WARN: { bg: '#fffbeb', fg: '#b45309', dot: '#f59e0b', label: '告警' },
  ERROR: { bg: '#fef2f2', fg: '#b91c1c', dot: '#ef4444', label: '错误' },
  // 用户主动停止：中性灰，不用错误红——不是失败，只是被人为终止。
  CANCELLED: { bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8', label: '用户停止' },
};

/** 状态 pill：圆点 + 文案，对齐设计稿 StatusTag。 */
export function TraceStatusTag({ status }: { status: TraceStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.SUCCESS;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: 9999,
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          background: s.dot,
          boxShadow: s.ring,
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  );
}
