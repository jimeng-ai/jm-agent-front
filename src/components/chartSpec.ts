/**
 * ECharts 图表规格的清洗。独立成模块（而不是放在 EChart.tsx 里）有两个原因：
 * 组件文件只导出组件才能用上 fast-refresh；以及这段是纯函数，值得单独看、单独测。
 *
 * 【为什么要清洗】图表规格来自模型输出，而模型会被上传文件的内容影响（提示注入），
 * 所以不能当可信内容处理。JSON 本身带不了函数，formatter 之类不可能是可执行代码，
 * 真正的注入面只有两条：
 *   · tooltip 默认用 HTML 渲染 —— formatter 里的 HTML 会被插进 DOM。强制 richText
 *     渲染模式后 tooltip 画在 canvas 上，完全不碰 DOM，这条路直接断掉。
 *   · title.link / target 支持点击跳转，link 可以写成 javascript:xxx —— 递归删掉。
 */

/** 规格体积上限：模型偶尔会把整份原始数据塞进 series，超大 option 会把主线程卡死。 */
export const MAX_SPEC_BYTES = 512 * 1024;

/** 递归删掉跳转面，并把 tooltip 钉死为无 DOM 的 richText 渲染。返回新对象，不改入参。 */
export function sanitizeChartSpec(input: unknown): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'link' || k === 'target') continue; // javascript: 跳转面
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  const spec = strip(input) as Record<string, unknown>;
  const tip = (spec.tooltip && typeof spec.tooltip === 'object' ? spec.tooltip : {}) as Record<string, unknown>;
  spec.tooltip = { trigger: 'axis', ...tip, renderMode: 'richText', appendToBody: false };
  return spec;
}

/** 解析模型给出的 ```echarts 源码。失败返回 err，绝不抛——渲染层要靠它退回"显示源码"。 */
export function parseChartSpec(code: string): { err: string | null; spec: Record<string, unknown> | null } {
  if (code.length > MAX_SPEC_BYTES) {
    return { err: `图表规格过大（${Math.round(code.length / 1024)}KB）`, spec: null };
  }
  try {
    const obj = JSON.parse(code) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { err: '图表规格必须是一个 JSON 对象', spec: null };
    }
    return { err: null, spec: sanitizeChartSpec(obj) };
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e), spec: null };
  }
}
