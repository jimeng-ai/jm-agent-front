import { useState, type CSSProperties } from 'react';
import { Tag, Typography } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

const { Text } = Typography;

/** 常见字段 → 中文标签，找不到回退原 key。 */
const LABELS: Record<string, string> = {
  query: '查询词',
  top_k: 'TopK',
  topK: 'TopK',
  count: '数量',
  kb_id: '知识库',
  doc_id: '文档',
  chunk_id: '片段 ID',
  chunk_type: '类型',
  content: '内容',
  rerank_score: '重排分数',
  score: '分数',
  results: '结果',
  location: '坐标',
  radius: '半径(米)',
  region: '地区',
  city: '城市',
  types: '类型',
  keywords: '关键词',
  keyword: '关键词',
  name: '名称',
  address: '地址',
  skill_names: '技能',
  activated_skills: '已激活技能',
  status: '状态',
  message: '消息',
  error: '错误',
};

function label(key: string): string {
  return LABELS[key] ?? key;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 可展开的长文本（超过阈值折叠）。 */
export function TextBlock({ text, clamp = 6 }: { text: string; clamp?: number }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > clamp || text.length > 400;
  const shown = expanded || !long ? text : lines.slice(0, clamp).join('\n').slice(0, 400);
  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
        {shown}
        {long && !expanded && <Text type="secondary">… </Text>}
      </div>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} style={expandBtnStyle}>
          {expanded ? '收起' : '展开全部'}
          {expanded ? (
            <UpOutlined style={{ fontSize: 10 }} />
          ) : (
            <DownOutlined style={{ fontSize: 10 }} />
          )}
        </button>
      )}
    </div>
  );
}

const expandBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  padding: '2px 10px',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--primary, #2563eb)',
  background: 'var(--primary-soft, #eff6ff)',
  border: '1px solid var(--primary-border, #bfdbfe)',
  borderRadius: 6,
  cursor: 'pointer',
};

/** 通用值渲染：对象→键值行，原始数组→标签，对象数组→子卡，字符串→文本。不展示裸 JSON。 */
export function ValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <Text type="secondary">—</Text>;
  }
  if (typeof value === 'string') {
    return <TextBlock text={value} />;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <Text>{String(value)}</Text>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <Text type="secondary">空</Text>;
    const allPrimitive = value.every((v) => v === null || typeof v !== 'object');
    if (allPrimitive) {
      return (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {value.map((v, i) => (
            <Tag key={i} style={{ marginInlineEnd: 0 }}>
              {String(v)}
            </Tag>
          ))}
        </span>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.map((v, i) => (
          <div
            key={i}
            style={{
              border: '1px solid var(--divider, #f1f5f9)',
              borderRadius: 6,
              padding: '6px 10px',
            }}
          >
            <ValueView value={v} />
          </div>
        ))}
      </div>
    );
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <Text type="secondary" style={{ fontSize: 12, minWidth: 72, flexShrink: 0 }}>
              {label(k)}
            </Text>
            <div style={{ minWidth: 0, flex: 1 }}>
              <ValueView value={v} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <Text>{String(value)}</Text>;
}

interface Chunk {
  chunk_id?: string;
  doc_id?: string;
  chunk_type?: string;
  rerank_score?: number | string;
  score?: number | string;
  content?: string;
}

/** 知识库召回片段：每片段一张卡（序号 · 文档 · 类型 · 分数 · 正文）。 */
export function ChunksView({ results }: { results: unknown }) {
  if (!Array.isArray(results) || results.length === 0) {
    return <Text type="secondary">无召回片段</Text>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {results.map((r, i) => {
        const c = (isObject(r) ? r : {}) as Chunk;
        const score = c.rerank_score ?? c.score;
        return (
          <div
            key={c.chunk_id || i}
            style={{
              border: '1px solid var(--divider, #f1f5f9)',
              borderRadius: 8,
              padding: '8px 10px',
              background: '#fff',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                flexWrap: 'wrap',
              }}
            >
              <Tag color="green" style={{ marginInlineEnd: 0 }}>
                #{i + 1}
              </Tag>
              {c.doc_id && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  文档 {c.doc_id}
                </Text>
              )}
              {c.chunk_type && <Tag style={{ marginInlineEnd: 0 }}>{c.chunk_type}</Tag>}
              {score != null && (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  分数 {typeof score === 'number' ? score.toFixed(3) : score}
                </Tag>
              )}
            </div>
            {c.content && <TextBlock text={c.content} clamp={4} />}
          </div>
        );
      })}
    </div>
  );
}
