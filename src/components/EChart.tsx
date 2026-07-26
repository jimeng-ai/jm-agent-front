import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button } from 'antd';
import { AreaChartOutlined, CodeOutlined, CopyOutlined } from '@ant-design/icons';
import { parseChartSpec } from './chartSpec';

/**
 * ECharts 图表渲染（```echarts 代码块）。
 *
 * 与 Mermaid 的分工：mermaid 画流程/时序这类【示意图】，ECharts 画【数据图表】。
 * 之所以两者都要，是因为 mermaid 的 xychart-beta 只是一张静态 SVG——扒过它的渲染器，
 * tooltip / mouseover / <title> 命中数全是 0，既没有悬浮取值也没有数值标注，
 * 更不支持分组柱、堆叠柱、双轴、自定义配色。数据图表用它是不够的。
 *
 * 按需动态导入 + 只注册用到的图表与组件（tree-shaking）：echarts 全量 ~1MB，而 <Markdown>
 * 在会话、Trace、技能预览、Prompt 编辑器里到处都在用，静态全量引入等于让每个页面都买单。
 * 模块级缓存保证只加载/注册一次。
 */
let echartsPromise: Promise<typeof import('echarts/core')> | null = null;

function loadECharts(): Promise<typeof import('echarts/core')> {
  if (!echartsPromise) {
    echartsPromise = (async () => {
      const [core, charts, components, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ]);
      core.use([
        charts.BarChart,
        charts.LineChart,
        charts.PieChart,
        charts.ScatterChart,
        charts.RadarChart,
        charts.HeatmapChart,
        components.TitleComponent,
        components.TooltipComponent,
        components.GridComponent,
        components.LegendComponent,
        components.DatasetComponent,
        components.VisualMapComponent,
        components.MarkLineComponent,
        components.MarkPointComponent,
        renderers.CanvasRenderer,
      ]);
      return core;
    })();
  }
  return echartsPromise;
}

/** 画布高度(px)。ECharts 必须拿到确定高度，容器塌成 0 就什么都不画。 */
const CHART_H = 380;

/** 与 Mermaid.tsx 同款：内网 http 部署下 navigator.clipboard 是 undefined，必须留 execCommand 兜底。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下面的兜底 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface Props {
  code: string;
}

export default function EChart({ code }: Props) {
  const { message: toast } = App.useApp();
  const [showSource, setShowSource] = useState(false);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // 解析放在 render 期（而不是 effect）：语法错要立刻走兜底 UI，不该先闪一下空图表。
  const parsed = useMemo(() => parseChartSpec(code), [code]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !parsed.spec || showSource) return;
    let cancelled = false;
    let chart: import('echarts/core').ECharts | null = null;
    let ro: ResizeObserver | null = null;
    void (async () => {
      try {
        const echarts = await loadECharts();
        // 竞态保护：code 变化快时（刚结束流式）旧的异步初始化可能后回来，往已卸载的节点上画。
        if (cancelled || !hostRef.current) return;
        chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' });
        chart.setOption(parsed.spec!, true);
        // 容器宽度会随侧栏开合/窗口缩放变化，ECharts 不会自己跟；不接 resize 图会一直是初始宽度。
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(hostRef.current);
        setRenderErr(null);
      } catch (e) {
        if (!cancelled) setRenderErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      chart?.dispose(); // 不 dispose 会留下 canvas 和 resize 监听，长会话里越积越多
    };
  }, [parsed.spec, showSource]);

  const err = parsed.err ?? renderErr;

  // 渲染失败绝不能搞崩整条消息：退回展示源码，用户至少看得到内容、也能据此让模型改。
  // 复用 md-mermaid-* 这套类名，样式与流程图保持一致（global.css 里那几条是通用的卡片外壳）。
  if (err) {
    return (
      <div className="md-mermaid-wrap">
        <div className="md-mermaid-bar">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              void copyText(code).then((ok) => (ok ? toast.success('已复制') : toast.error('复制失败')));
            }}
          >
            复制
          </Button>
        </div>
        <div className="md-mermaid-error-tip">图表规格有误，已显示源码</div>
        <pre className="md-mermaid-src">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="md-mermaid-wrap">
      <div className="md-mermaid-bar">
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          onClick={() => {
            void copyText(code).then((ok) =>
              ok ? toast.success('已复制') : toast.error('复制失败，请手动选择复制'),
            );
          }}
        >
          复制
        </Button>
        <Button
          type="text"
          size="small"
          icon={showSource ? <AreaChartOutlined /> : <CodeOutlined />}
          onClick={() => setShowSource((v) => !v)}
        >
          {showSource ? '查看图表' : '查看源码'}
        </Button>
      </div>
      {showSource ? (
        <pre className="md-mermaid-src">
          <code>{code}</code>
        </pre>
      ) : (
        <div ref={hostRef} style={{ width: '100%', height: CHART_H }} />
      )}
    </div>
  );
}
