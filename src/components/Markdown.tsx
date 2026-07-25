import { createContext, isValidElement, useContext, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github.css';
import Mermaid from './Mermaid';

interface Props {
  content: string;
  cursor?: boolean;
}

/**
 * 本次渲染是否处于流式输出中。
 *
 * 流式期间 ```mermaid 代码块是【不完整】的（可能只到一半），直接送去渲染会持续解析失败、
 * 图表疯狂闪烁；就算某个中间状态碰巧合法，也会每来一个 token 就重渲一次（mermaid 渲染并不便宜）。
 * 所以流式期间一律先按源码展示，等 cursor 落下（流结束）再真正出图。
 */
const StreamingContext = createContext(false);

/**
 * 从 React 子节点里递归取纯文本。
 *
 * 不能直接 String(children)：rehype-highlight 会把代码内容切成一堆嵌套 <span> 用于着色，
 * 此时 children 是元素数组而不是字符串，硬转会得到 "[object Object]" 之类的东西。
 */
function toText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(toText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return toText(node.props.children);
  return '';
}

/** 从 <pre> 的子节点里认出 ```mermaid 代码块，返回其源码；不是则返回 null。 */
function mermaidSource(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  if (!/\blanguage-mermaid\b/.test(child.props.className ?? '')) return null;
  // markdown 代码块末尾必带一个换行，mermaid 不在意，去掉更干净。
  return toText(child.props.children).replace(/\n$/, '');
}

function MermaidBlock({ code }: { code: string }) {
  const streaming = useContext(StreamingContext);
  if (streaming) {
    return (
      <div className="md-mermaid-streaming">
        <div className="md-mermaid-streaming-tip">流程图 · 生成中</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return <Mermaid code={code} />;
}

export default function Markdown({ content, cursor }: Props) {
  const text = cursor ? content + '▍' : content;
  return (
    <div className="md-body">
      <StreamingContext.Provider value={!!cursor}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight]}
          components={{
            // 回复里的链接一律新开标签页，避免在对话页内直接跳转、丢失当前会话
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
            // 拦 <pre> 而不是 <code>：react-markdown 产出的结构是 <pre><code class="language-x">，
            // 在 code 层返回 <div> 会塞进 <pre> 里（嵌套非法，且继承等宽/预格式化样式）。
            pre: ({ node: _node, children, ...props }) => {
              const code = mermaidSource(children);
              if (code) return <MermaidBlock code={code} />;
              return <pre {...props}>{children}</pre>;
            },
          }}
        >
          {text}
        </ReactMarkdown>
      </StreamingContext.Provider>
    </div>
  );
}
