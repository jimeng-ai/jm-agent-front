import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { pluginCredApi } from '@/features/plugin/api';
import type { PluginCredential } from '@/api/types';

interface FormValues {
  alias: string;
  isDefault: boolean;
  credentialJsonRaw: string;
}

export default function CredentialPanel({ pluginId }: { pluginId: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PluginCredential | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['plugin', pluginId, 'creds'],
    queryFn: () => pluginCredApi.list(pluginId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['plugin', pluginId, 'creds'] });

  const saveMut = useMutation({
    mutationFn: async (values: FormValues) => {
      let credentialJson: Record<string, unknown>;
      try {
        credentialJson = JSON.parse(values.credentialJsonRaw);
      } catch {
        throw new Error('凭证 JSON 不合法');
      }
      const payload = {
        alias: values.alias,
        isDefault: values.isDefault,
        credentialJson,
      };
      if (editing) {
        return pluginCredApi.update(pluginId, editing.id, payload);
      }
      return pluginCredApi.create(pluginId, payload);
    },
    onSuccess: () => {
      message.success('保存成功');
      setOpen(false);
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => pluginCredApi.delete(pluginId, id),
    onSuccess: () => {
      message.success('已删除');
      refresh();
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      alias: '',
      isDefault: false,
      credentialJsonRaw: '{\n  "apiKey": ""\n}',
    });
    setOpen(true);
  };

  const openEdit = (row: PluginCredential) => {
    setEditing(row);
    form.setFieldsValue({
      alias: row.alias,
      isDefault: row.isDefault,
      credentialJsonRaw: JSON.stringify(row.credentialJson ?? {}, null, 2),
    });
    setOpen(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>凭证管理</h4>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增凭证
        </Button>
      </div>
      <Table<PluginCredential>
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        pagination={false}
        columns={[
          { title: '别名', dataIndex: 'alias' },
          {
            title: '默认',
            dataIndex: 'isDefault',
            width: 80,
            render: (v) => (v ? <Tag color="green">默认</Tag> : '-'),
          },
          {
            title: '内容',
            render: (_, r) =>
              Object.keys(r.credentialJson ?? {}).map((k) => (
                <Tag key={k}>{k}=****</Tag>
              )),
          },
          {
            title: '操作',
            width: 120,
            render: (_, r) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="确认删除？" onConfirm={() => delMut.mutate(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑凭证' : '新增凭证'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
          <Form.Item label="别名" name="alias" rules={[{ required: true }]}>
            <Input placeholder="如 prod / test" />
          </Form.Item>
          <Form.Item label="设为默认" name="isDefault" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label="凭证 JSON"
            name="credentialJsonRaw"
            extra="敏感信息以 JSON 形式存储，请谨慎管理"
          >
            <Input.TextArea rows={6} style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
