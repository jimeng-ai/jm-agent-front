import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer, Empty, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd';
import { docApi } from '@/features/knowledge/api';

interface Props {
  docId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}

export default function ChunksDrawer({ docId, title, open, onClose }: Props) {
  // 是否展示上下文化文本（带 LLM 生成前缀，BM25/embedding 实际使用的版本）
  const [showContext, setShowContext] = useState(false);

  const chunksQuery = useQuery({
    queryKey: ['kb', 'doc', docId, 'chunks'],
    queryFn: () => docApi.chunks(docId),
    enabled: open && !!docId,
  });

  const chunks = chunksQuery.data ?? [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`切片 · ${title}`}
      width={720}
      extra={
        <Space>
          <Typography.Text type="secondary">显示上下文化文本</Typography.Text>
          <Switch size="small" checked={showContext} onChange={setShowContext} />
        </Space>
      }
    >
      {chunksQuery.isLoading ? (
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <Spin />
        </div>
      ) : chunks.length === 0 ? (
        <Empty description="暂无切片（文档可能尚未完成入库）" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">共 {chunks.length} 个切片</Typography.Text>
          {chunks.map((c) => {
            const text = showContext ? c.contextualizedContent || c.content : c.content;
            return (
              <div key={c.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                <Space wrap style={{ marginBottom: 8 }}>
                  <Tag color="blue">#{c.chunkIndex}</Tag>
                  {c.chunkType && <Tag>{c.chunkType}</Tag>}
                  {c.pageNum != null && <Tag color="geekblue">P{c.pageNum}</Tag>}
                  {c.tokenCount != null && <Tag color="purple">{c.tokenCount} tokens</Tag>}
                  {c.headingPath && (
                    <Tooltip title={c.headingPath}>
                      <Typography.Text type="secondary" ellipsis style={{ maxWidth: 280 }}>
                        {c.headingPath}
                      </Typography.Text>
                    </Tooltip>
                  )}
                </Space>
                <Typography.Paragraph style={{ margin: 0 }}>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                    {text}
                  </pre>
                </Typography.Paragraph>
              </div>
            );
          })}
        </Space>
      )}
    </Drawer>
  );
}
