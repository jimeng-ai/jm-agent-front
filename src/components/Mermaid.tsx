import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { App, Button } from 'antd';
import { CodeOutlined, CopyOutlined, PartitionOutlined } from '@ant-design/icons';

/**
 * Mermaid 图表渲染。
 *
 * 按需动态导入：mermaid 打包后 ~150KB(gzip，核心)且会再按图种拆包，而 <Markdown> 在会话、
 * Trace、技能预览、Prompt 编辑器等到处都在用，静态引入会让每个页面都为它买单。这里让 Vite
 * 单独切 chunk，只有真的出现图表时才下载。模块级缓存保证 initialize 只跑一次。
 */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        // 图表内容来自模型输出、且可能被用户输入影响，不能当可信内容处理。
        // strict 会清洗标签里的 HTML 并禁用 click 交互。
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: 'inherit',
        // htmlLabels=false：标签走 SVG <text> 而非内联 HTML，少一条注入面，中文渲染正常。
        flowchart: { htmlLabels: false, useMaxWidth: true },
      });
      return mod.default;
    });
  }
  return mermaidPromise;
}

/** 折叠态最大高度(px)。与 global.css 的 .md-mermaid max-height 必须一致，改要一起改。 */
const COLLAPSED_MAX_H = 480;

/**
 * 复制到剪贴板。
 *
 * navigator.clipboard 只在安全上下文(https / localhost)可用；本系统存在内网 http 部署的场景，
 * 那里它是 undefined，光用它按钮会静默失效。故保留 execCommand 兜底。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 放到视口内但不可见：部分浏览器对不在布局中的元素不执行 select/copy
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

export default function Mermaid({ code }: Props) {
  const { message: toast } = App.useApp();
  const reactId = useId();
  // mermaid 会拿这个 id 建临时节点并做 querySelector，而 React 的 useId 形如 ":r3:"，
  // 冒号在 CSS 选择器里非法，必须先清洗，否则渲染直接抛错。
  const domId = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 竞态保护：代码变化很快时（比如刚结束流式），旧的异步渲染可能后回来把新图覆盖掉。
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        // 先 parse 再 render：语法有问题时 render 可能在 body 上留下残留节点，
        // parse 是纯校验，失败得更干净。
        await mermaid.parse(code);
        const { svg: out } = await mermaid.render(domId, code);
        if (!cancelled) {
          setSvg(out);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSvg(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, domId]);

  // 只有真的被截断才显示"展开"，否则短图下面会挂一个没用的按钮。
  // 用 ResizeObserver 而不是只测一次：图宽度随容器变化（侧栏开合、窗口缩放）时高度会跟着变，
  // 只测一次会让这个状态过期。
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !svg || showSource) return;
    const measure = () => setClipped(el.scrollHeight > COLLAPSED_MAX_H + 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svg, showSource]);

  const toolbar = (
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
        icon={showSource ? <PartitionOutlined /> : <CodeOutlined />}
        onClick={() => setShowSource((v) => !v)}
      >
        {showSource ? '查看图表' : '查看源码'}
      </Button>
    </div>
  );

  // 渲染失败：绝不能把整条消息搞崩，退回展示源码 —— 模型偶尔会写出语法错误的图，
  // 此时用户至少还能看到内容、也能据此让模型改。
  if (error) {
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
        <div className="md-mermaid-error-tip">流程图语法有误，已显示源码</div>
        <pre className="md-mermaid-src">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="md-mermaid-loading">流程图渲染中…</div>;
  }

  return (
    <div className={`md-mermaid-wrap${expanded ? ' is-expanded' : ''}`}>
      {toolbar}
      {showSource ? (
        <pre className="md-mermaid-src">
          <code>{code}</code>
        </pre>
      ) : (
        <>
          {/* svg 由 mermaid 在 securityLevel:'strict' 下生成（内部经 DOMPurify 清洗） */}
          <div ref={bodyRef} className="md-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
          {clipped && (
            <button type="button" className="md-mermaid-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起' : '展开全部'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
