import { useState } from 'react';
import { Collapse, Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import type { ChatCitation } from '@/api/types';

interface Props {
  citations?: ChatCitation[];
}

interface DocGroup {
  key: string;
  docTitle: string;
  snippets: ChatCitation[];
}

/** 把命中的片段按所属文档聚合（检索侧已按 chunkId 去重），保留文档首次出现顺序。 */
function groupByDoc(citations: ChatCitation[]): DocGroup[] {
  const map = new Map<string, DocGroup>();
  for (const c of citations) {
    // docId 由后端 Hutool 序列化为数字、旧消息可能缺省，统一转字符串后兜底用 chunkId 分组
    const key = c.docId != null ? String(c.docId) : `chunk:${c.chunkId}`;
    let g = map.get(key);
    if (!g) {
      g = { key, docTitle: c.docTitle?.trim() || '未命名文档', snippets: [] };
      map.set(key, g);
    }
    g.snippets.push(c);
  }
  return [...map.values()];
}

function fmtScore(score: ChatCitation['score']): string | null {
  if (score == null) return null;
  const n = Number(score);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/**
 * 「参考来源」：当回答结合了知识库文档时，在回答下方按文档聚合展示引用来源。
 * 每个文档一行，展开可看该文档命中的原文片段。正文本身不再带 chunk_id / 编号。
 */
export default function CitationReferences({ citations }: Props) {
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  if (!citations || citations.length === 0) return null;
  const groups = groupByDoc(citations);
  if (groups.length === 0) return null;

  // 每个文档取首个有页码的片段作为行内页码提示（对齐截图里的「· p.12」）。
  const groupPage = (g: DocGroup): number | null => {
    const hit = g.snippets.find((s) => s.pageNum != null);
    return hit?.pageNum ?? null;
  };

  return (
    <div style={{ marginTop: 8, maxWidth: 560 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        引用 · {groups.length}
      </Typography.Text>
      <Collapse
        ghost
        size="small"
        activeKey={activeKeys}
        onChange={(k) => setActiveKeys(k as string[])}
        style={{
          marginTop: 4,
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
        }}
        items={groups.map((g, gi) => ({
          key: g.key,
          label: (
            <span className="chat-cite__row">
              <span className="chat-cite__idx">[{gi + 1}]</span>
              <span className="chat-cite__name">{g.docTitle}</span>
              {groupPage(g) != null && <span className="chat-cite__meta">· p.{groupPage(g)}</span>}
              <EyeOutlined className="chat-cite__eye" />
            </span>
          ),
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.snippets.map((s, i) => {
                const score = fmtScore(s.score);
                return (
                  <div
                    key={s.chunkId ?? i}
                    style={{
                      borderLeft: '2px solid #e6e6e6',
                      paddingLeft: 10,
                      fontSize: 12,
                      color: '#595959',
                    }}
                  >
                    <div style={{ marginBottom: 2, color: '#8c8c8c' }}>
                      片段 {i + 1}
                      {s.headingPath ? ` · ${s.headingPath}` : ''}
                      {s.pageNum != null ? ` · 第 ${s.pageNum} 页` : ''}
                      {score ? ` · 相关度 ${score}` : ''}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{s.content}</div>
                  </div>
                );
              })}
            </div>
          ),
        }))}
      />
    </div>
  );
}
