/** 无头像时按名称首字生成的占位头像配色（按字符稳定取色）。 */
const GLYPH_COLORS = [
  { bg: '#dbeafe', fg: '#1d4ed8' },
  { bg: '#dcfce7', fg: '#15803d' },
  { bg: '#fef3c7', fg: '#b45309' },
  { bg: '#fce7f3', fg: '#be185d' },
  { bg: '#ede9fe', fg: '#6d28d9' },
  { bg: '#cffafe', fg: '#0e7490' },
];

export function glyphColor(name?: string) {
  const key = (name || 'A').charCodeAt(0);
  return GLYPH_COLORS[key % GLYPH_COLORS.length];
}
