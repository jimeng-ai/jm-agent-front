import { useEffect, useId, useState } from 'react';

/**
 * Mermaid 图表渲染。
 *
 * 按需动态导入：mermaid 打包后 ~500KB(gzip)，而 <Markdown> 在会话、Trace、技能预览等到处都在用，
 * 静态引入会让每个页面都为它买单。这里让 Vite 单独切 chunk，只有真的出现图表时才下载。
 * 模块级缓存保证 initialize 只跑一次。
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

interface Props {
  code: string;
}

export default function Mermaid({ code }: Props) {
  const reactId = useId();
  // mermaid 会拿这个 id 建临时节点并做 querySelector，而 React 的 useId 形如 ":r3:"，
  // 冒号在 CSS 选择器里非法，必须先清洗，否则渲染直接抛错。
  const domId = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (svg) {
    // svg 由 mermaid 在 securityLevel:'strict' 下生成（内部经 DOMPurify 清洗）。
    return <div className="md-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
  }

  // 渲染失败：绝不能把整条消息搞崩，退回展示源码 —— 模型偶尔会写出语法错误的图，
  // 此时用户至少还能看到内容、也能据此让模型改。
  if (error) {
    return (
      <div className="md-mermaid-error">
        <div className="md-mermaid-error-tip">流程图语法有误，已显示源码</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return <div className="md-mermaid-loading">流程图渲染中…</div>;
}
