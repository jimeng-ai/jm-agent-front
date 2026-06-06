import { useState } from 'react';
import { App, Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Tag } from 'antd';
import {
  AppstoreOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  SendOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { pluginApi } from '@/features/plugin/api';
import ShareModal from '@/features/rbac/components/ShareModal';

export default function PluginListPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['plugin', 'list'],
    queryFn: () => pluginApi.list(),
  });

  const createMut = useMutation({
    mutationFn: pluginApi.create,
    onSuccess: (p) => {
      message.success('创建成功');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
      navigate(`/console/plugins/${p.id}`);
    },
  });

  const delMut = useMutation({
    mutationFn: pluginApi.delete,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
    },
  });

  const publishMut = useMutation({
    mutationFn: pluginApi.publish,
    onSuccess: () => {
      message.success('已发布');
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
    },
  });

  const unpublishMut = useMutation({
    mutationFn: pluginApi.unpublish,
    onSuccess: () => {
      message.success('已下架');
      qc.invalidateQueries({ queryKey: ['plugin', 'list'] });
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>插件</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新建插件
        </Button>
      </div>

      {isLoading ? null : !data?.length ? (
        <Empty description="暂无插件" />
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((p) => (
            <Col key={p.id} span={8}>
              <Card
                hoverable
                onClick={() => navigate(`/console/plugins/${p.id}`)}
                actions={[
                  <ShareAltOutlined
                    key="share"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShareTarget({ id: p.id, name: p.name });
                    }}
                  />,
                  p.status === 'PUBLISHED' ? (
                    <Popconfirm
                      key="unpublish"
                      title="下架该插件？下架后状态变回草稿"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        unpublishMut.mutate(p.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <DownloadOutlined onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>
                  ) : (
                    <Popconfirm
                      key="publish"
                      title="发布该插件？"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        publishMut.mutate(p.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <SendOutlined onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>
                  ),
                  <Popconfirm
                    key="del"
                    title="确认删除？关联工具与映射会一并删除"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      delMut.mutate(p.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <DeleteOutlined onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<AppstoreOutlined style={{ fontSize: 32, color: '#52c41a' }} />}
                  title={
                    <span>
                      {p.name}{' '}
                      <Tag color={p.status === 'PUBLISHED' ? 'green' : 'default'}>
                        {p.status === 'PUBLISHED' ? '已发布' : '草稿'}
                      </Tag>
                    </span>
                  }
                  description={
                    <>
                      <div>{p.description || p.baseUrl || '—'}</div>
                      <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
                        创建人：{p.creatorName ?? '-'}
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
        title="新建插件"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="如 天气服务" />
          </Form.Item>
          <Form.Item label="Base URL" name="baseUrl">
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <ShareModal
        open={!!shareTarget}
        resourceType="PLUGIN"
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
      />
    </div>
  );
}
