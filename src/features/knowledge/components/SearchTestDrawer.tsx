import { useState } from 'react';
import { Drawer, Input, List, Tag, Typography, Empty, Space, InputNumber, Switch, Form } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { searchApi } from '@/features/knowledge/api';
import type { SearchHit } from '@/api/types';

interface Props {
  kbId: string;
  open: boolean;
  onClose: () => void;
}

export default function SearchTestDrawer({ kbId, open, onClose }: Props) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [form] = Form.useForm();

  const searchMut = useMutation({
    mutationFn: searchApi.search,
    onSuccess: (data) => setHits(data || []),
  });

  return (
    <Drawer title="检索测试" open={open} onClose={onClose} width={640} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ topK: 5, rerank: false }}
        onFinish={(v) => searchMut.mutate({ kbId, ...v })}
      >
        <Form.Item label="查询" name="query" rules={[{ required: true, message: '请输入查询' }]}>
          <Input.TextArea rows={3} placeholder="输入用户问题" />
        </Form.Item>
        <Space>
          <Form.Item label="TopK" name="topK" style={{ marginBottom: 0 }}>
            <InputNumber min={1} max={20} />
          </Form.Item>
          <Form.Item label="Rerank" name="rerank" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        </Space>
        <Form.Item style={{ marginTop: 16 }}>
          <button
            type="submit"
            style={{
              padding: '6px 16px',
              background: '#1677ff',
              color: '#fff',
              border: 0,
              borderRadius: 4,
              cursor: 'pointer',
            }}
            disabled={searchMut.isPending}
          >
            {searchMut.isPending ? '检索中…' : '检索'}
          </button>
        </Form.Item>
      </Form>

      <Typography.Title level={5}>结果 ({hits.length})</Typography.Title>
      {!hits.length ? (
        <Empty description="暂无结果" />
      ) : (
        <List
          dataSource={hits}
          renderItem={(h, idx) => (
            <List.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <Tag color="blue">#{idx + 1}</Tag>
                  <Tag>
                    score:{' '}
                    {h.score != null && Number.isFinite(Number(h.score))
                      ? Number(h.score).toFixed(3)
                      : '—'}
                  </Tag>
                  {h.docTitle && <Typography.Text type="secondary">{h.docTitle}</Typography.Text>}
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0 }}>{h.content}</Typography.Paragraph>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
