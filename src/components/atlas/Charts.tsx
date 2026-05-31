import { useState, type MouseEvent } from 'react';

/** 数值格式化：整数原样，否则保留 1 位小数。 */
function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** 悬浮气泡：用百分比定位，适配 SVG 的非等比缩放。 */
function ChartTooltip({
  leftPct,
  topPct,
  title,
  value,
}: {
  leftPct: number;
  topPct: number;
  title: string;
  value: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${leftPct * 100}%`,
        top: `${topPct * 100}%`,
        transform: 'translate(-50%, calc(-100% - 10px))',
        background: 'var(--text)',
        color: '#fff',
        borderRadius: 6,
        padding: '5px 9px',
        fontSize: 11,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgb(15 23 42 / 0.2)',
        zIndex: 2,
      }}
    >
      <div style={{ color: 'var(--text-3)' }}>{title}</div>
      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
};

export function Sparkline({
  data,
  width = 300,
  height = 28,
  color = 'var(--primary)',
  fill = true,
}: SparklineProps) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1 || 1);
  const pts = data.map<[number, number]>((v, i) => [
    i * stepX,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  const areaD = `${d} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
      preserveAspectRatio="none"
    >
      {fill ? <path d={areaD} fill={color} fillOpacity="0.08" /> : null}
      <path
        d={d}
        stroke={color}
        strokeWidth={1.4}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

type AreaChartProps = {
  labels: string[];
  data: number[];
  height?: number;
  unitSuffix?: string;
};

export function AreaChart({ labels, data, height = 240, unitSuffix = 'M' }: AreaChartProps) {
  const W = 800;
  const H = height;
  const pad = { l: 40, r: 20, t: 16, b: 24 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const maxP = Math.max(...data, 0.001);
  const stepX = cw / (data.length - 1 || 1);

  const points = data.map<[number, number]>((v, i) => [
    pad.l + i * stepX,
    pad.t + ch - (v / maxP) * ch,
  ]);
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${pad.l + cw},${pad.t + ch} L${pad.l},${pad.t + ch} Z`;

  const grids = [0, 0.25, 0.5, 0.75, 1].map((t) => pad.t + ch * t);
  const xTicks = labels
    .map((l, i) => (i % 5 === 0 ? { x: pad.l + i * stepX, l } : null))
    .filter((v): v is { x: number; l: string } => !!v);

  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = Math.round((vbX - pad.l) / stepX);
    idx = Math.max(0, Math.min(data.length - 1, idx));
    setHover(idx);
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={height}
        style={{ display: 'block' }}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="atlasAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grids.map((y, i) => (
          <line
            key={i}
            x1={pad.l}
            x2={pad.l + cw}
            y1={y}
            y2={y}
            stroke="var(--divider)"
            strokeWidth={1}
          />
        ))}
        {[0, 0.5, 1].map((t, i) => {
          const v = (maxP * (1 - t)).toFixed(1);
          return (
            <text
              key={i}
              x={pad.l - 8}
              y={pad.t + ch * t + 4}
              textAnchor="end"
              fill="var(--text-3)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {v}
              {unitSuffix}
            </text>
          );
        })}
        <path d={areaPath} fill="url(#atlasAreaGrad)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {points.map((p, i) =>
          i % 5 === 0 ? <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="var(--chart-1)" /> : null,
        )}
        {hover != null && (
          <>
            <line
              x1={points[hover][0]}
              x2={points[hover][0]}
              y1={pad.t}
              y2={pad.t + ch}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={points[hover][0]}
              cy={points[hover][1]}
              r={4.5}
              fill="var(--chart-1)"
              stroke="#fff"
              strokeWidth={2}
            />
          </>
        )}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={H - 6}
            textAnchor="middle"
            fill="var(--text-3)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            {t.l}
          </text>
        ))}
      </svg>
      {hover != null && (
        <ChartTooltip
          leftPct={points[hover][0] / W}
          topPct={points[hover][1] / H}
          title={labels[hover]}
          value={`${fmtNum(data[hover])}${unitSuffix}`}
        />
      )}
    </div>
  );
}

type BarChartProps = {
  labels: string[];
  data: number[];
  height?: number;
  unitSuffix?: string;
};

export function BarChart({ labels, data, height = 240, unitSuffix = 'K' }: BarChartProps) {
  const W = 800;
  const H = height;
  const pad = { l: 40, r: 20, t: 12, b: 24 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const max = Math.max(...data, 1);
  const colW = cw / (data.length || 1);
  const bw = colW * 0.6;
  const gap = colW * 0.4;

  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = Math.floor((vbX - pad.l) / colW);
    idx = Math.max(0, Math.min(data.length - 1, idx));
    setHover(idx);
  };

  const hoverH = hover != null ? (data[hover] / max) * ch : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={height}
        style={{ display: 'block' }}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line
            key={i}
            x1={pad.l}
            x2={pad.l + cw}
            y1={pad.t + ch * t}
            y2={pad.t + ch * t}
            stroke="var(--divider)"
          />
        ))}
        {[0, 0.5, 1].map((t, i) => {
          const raw = max * (1 - t);
          const v = raw >= 100 ? Math.round(raw) : +raw.toFixed(1);
          return (
            <text
              key={i}
              x={pad.l - 8}
              y={pad.t + ch * t + 4}
              textAnchor="end"
              fill="var(--text-3)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {v}
              {unitSuffix}
            </text>
          );
        })}
        {hover != null && (
          <rect
            x={pad.l + hover * colW}
            y={pad.t}
            width={colW}
            height={ch}
            fill="var(--hover-bg)"
          />
        )}
        {data.map((v, i) => {
          const x = pad.l + i * colW + gap / 2;
          const h = (v / max) * ch;
          const y = pad.t + ch - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={bw}
              height={h}
              fill="var(--chart-1)"
              opacity={hover == null || hover === i ? 0.9 : 0.45}
              rx={2}
            />
          );
        })}
        {labels.map((l, i) =>
          i % 5 === 0 ? (
            <text
              key={i}
              x={pad.l + i * colW + colW / 2}
              y={H - 6}
              textAnchor="middle"
              fill="var(--text-3)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {l}
            </text>
          ) : null,
        )}
      </svg>
      {hover != null && (
        <ChartTooltip
          leftPct={(pad.l + hover * colW + colW / 2) / W}
          topPct={(pad.t + ch - hoverH) / H}
          title={labels[hover]}
          value={`${fmtNum(data[hover])}${unitSuffix}`}
        />
      )}
    </div>
  );
}

type PieDatum = { label: string; value: number };

/** 扇区配色：前两个沿用图表主色，其余取一组高区分度的固定色。 */
const PIE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#a855f7',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
];

type PieChartProps = {
  data: PieDatum[];
  size?: number;
  thickness?: number;
};

/**
 * 环形饼图：用 stroke-dasharray 画各扇段，右侧带图例与占比。无第三方依赖，
 * 与本文件其余 SVG 图表风格一致。空数据时不渲染（由调用方给空态）。
 */
export function PieChart({ data, size = 200, thickness = 26 }: PieChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  // 顺时针累计每段的弧长偏移；rotate(-90) 让起点落在 12 点方向。
  let acc = 0;
  const segments = data.map((d, i) => {
    const frac = total > 0 ? d.value / total : 0;
    const dash = frac * circ;
    const seg = { d, i, color: PIE_COLORS[i % PIE_COLORS.length], dash, offset: -acc };
    acc += dash;
    return seg;
  });

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ flex: '0 0 auto' }}
      >
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--divider)"
            strokeWidth={thickness}
          />
          {segments.map((s) => (
            <circle
              key={s.i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.i ? thickness + 5 : thickness}
              strokeDasharray={`${s.dash.toFixed(2)} ${(circ - s.dash).toFixed(2)}`}
              strokeDashoffset={s.offset.toFixed(2)}
              style={{ transition: 'stroke-width .15s', cursor: 'pointer' }}
              onMouseEnter={() => setHover(s.i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fill="var(--text)"
          fontSize="20"
          fontWeight={600}
          fontFamily="var(--font-mono)"
        >
          {total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--text-3)" fontSize="11">
          次调用
        </text>
      </svg>
      <div
        style={{
          flex: '1 1 200px',
          minWidth: 180,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {segments.map((s) => {
          const pct = total > 0 ? (s.d.value / total) * 100 : 0;
          return (
            <div
              key={s.i}
              onMouseEnter={() => setHover(s.i)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                opacity: hover == null || hover === s.i ? 1 : 0.5,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: s.color,
                  flex: '0 0 auto',
                }}
              />
              <span
                className="mono"
                style={{
                  flex: 1,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.d.label}
              </span>
              <span
                className="mono"
                style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}
              >
                {s.d.value.toLocaleString()}
              </span>
              <span
                className="mono"
                style={{
                  color: 'var(--text-3)',
                  width: 48,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
