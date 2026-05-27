import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github.css';

interface Props {
  content: string;
  cursor?: boolean;
}

export default function Markdown({ content, cursor }: Props) {
  const text = cursor ? content + '▍' : content;
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
