import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Space, App } from 'antd';
import { PlusOutlined, DeleteOutlined, BookOutlined, ShareAltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { kbApi } from '@/features/knowledge/api';
import ShareModal from '@/features/rbac/components/ShareModal';

export default function KnowledgeListPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['kb', 'list'],
    queryFn: kbApi.list,
  });

  const createMut = useMutation({
    mutationFn: kbApi.create,
    onSuccess: () => {
      message.success('创建成功');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['kb', 'list'] });
    },
  });

  const delMut = useMutation({
    mutationFn: kbApi.delete,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['kb', 'list'] });
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>知识库</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新建知识库
        </Button>
      </div>

      {isLoading ? null : !data?.length ? (
        <Empty description="暂无知识库" />
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((kb) => (
            <Col key={kb.id} span={6}>
              <Card
                hoverable
                onClick={() => navigate(`/console/knowledge/${kb.id}`)}
                actions={[
                  <ShareAltOutlined
                    key="share"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShareTarget({ id: kb.id, name: kb.name });
                    }}
                  />,
                  <Popconfirm
                    key="del"
                    title="确认删除？文档与索引将一并清理"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      delMut.mutate(kb.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <DeleteOutlined onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<BookOutlined style={{ fontSize: 32, color: '#1677ff' }} />}
                  title={kb.name}
                  description={
                    <>
                      <div>{kb.description || '—'}</div>
                      <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
                        创建人：{kb.creatorName ?? '-'}
                      </div>
                    </>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="新建知识库"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="知识库名称" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="简单描述用途" />
          </Form.Item>
        </Form>
      </Modal>

      <ShareModal
        open={!!shareTarget}
        resourceType="KNOWLEDGE_BASE"
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
      />

      <Space />
    </div>
  );
}
