import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { authApi } from '@/features/auth/api';
import { connectionApi } from '@/features/connection/api';
import type { Connection, ConnectionUpsert } from '@/features/connection/types';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => ({
  label: m,
  value: m,
}));

interface FormValues {
  name: string;
  displayName?: string;
  baseUrl: string;
  authScheme: 'bearer' | 'api-key';
  credential?: string;
  allowMethods?: string[];
  allowPaths?: string[];
}

/** "GET,POST" → ["GET","POST"]，空则给默认 ["GET"]。 */
const methodsToArr = (s?: string | null): string[] =>
  s
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : ['GET'];

/** allowPaths 是 JSON 数组字符串（可能为 null）→ string[]。 */
const pathsToArr = (s?: string | null): string[] => {
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

export default function ConnectionListPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);

  // 超管门控：整页仅企业超管可见，非超管不发列表请求，直接空状态。
  const { data: perm, isLoading: permLoading } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    staleTime: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['connection', 'list'],
    queryFn: connectionApi.list,
    enabled: perm?.superAdmin === true,
  });

  const createMut = useMutation({
    mutationFn: (payload: ConnectionUpsert) => connectionApi.create(payload),
    onSuccess: () => {
      message.success('已创建');
      closeModal();
      qc.invalidateQueries({ queryKey: ['connection', 'list'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (payload: ConnectionUpsert) => connectionApi.update(editing!.id, payload),
    onSuccess: () => {
      message.success('已保存');
      closeModal();
      qc.invalidateQueries({ queryKey: ['connection', 'list'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'DISABLED' }) =>
      connectionApi.setStatus(v.id, v.status),
    onSuccess: () => {
      message.success('状态已更新');
      qc.invalidateQueries({ queryKey: ['connection', 'list'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => connectionApi.remove(id),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['connection', 'list'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ authScheme: 'bearer', allowMethods: ['GET'] });
    setOpen(true);
  };

  const openEdit = (row: Connection) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      displayName: row.displayName ?? undefined,
      baseUrl: row.baseUrl,
      authScheme: row.authScheme,
      credential: '', // 留空 = 不改凭据
      allowMethods: methodsToArr(row.allowMethods),
      allowPaths: pathsToArr(row.allowPaths),
    });
    setOpen(true);
  };

  const onFinish = (v: FormValues) => {
    const payload: ConnectionUpsert = {
      name: v.name,
      displayName: v.displayName,
      baseUrl: v.baseUrl,
      authScheme: v.authScheme,
      allowMethods: v.allowMethods?.length ? v.allowMethods : ['GET'],
      allowPaths: v.allowPaths ?? [],
    };
    // 编辑态凭据留空 = 不改动，故仅在填写时才带上 credential。
    if (v.credential) payload.credential = v.credential;
    if (editing) updateMut.mutate(payload);
    else createMut.mutate(payload);
  };

  const confirmDelete = (row: Connection) => {
    modal.confirm({
      title: `删除连接「${row.displayName || row.name}」？`,
      content: '将同时摘除所有 Agent 对该连接的授权，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => delMut.mutateAsync(row.id),
    });
  };

  // 权限加载中
  if (permLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  // 非超管：空状态，不渲染列表也不发请求
  if (perm && !perm.superAdmin) {
    return (
      <Result
        status="403"
        title="仅企业超管可访问"
        subTitle="外部连接涉及出网凭据，仅企业超级管理员可管理。"
        icon={<Empty description={false} />}
      />
    );
  }

  const columns: ColumnsType<Connection> = [
    {
      title: '名称',
      dataIndex: 'displayName',
      key: 'name',
      render: (_: unknown, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.displayName || row.name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{row.name}</div>
        </div>
      ),
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      render: (v: string) => <span style={{ wordBreak: 'break-all' }}>{v}</span>,
    },
    {
      title: '认证',
      dataIndex: 'authScheme',
      key: 'authScheme',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '允许方法',
      dataIndex: 'allowMethods',
      key: 'allowMethods',
      render: (v?: string | null) => (
        <Space size={4} wrap>
          {methodsToArr(v).map((m) => (
            <Tag key={m}>{m}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) =>
        v === 'ACTIVE' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            loading={statusMut.isPending}
            onClick={() =>
              statusMut.mutate({
                id: row.id,
                status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
              })
            }
          >
            {row.status === 'ACTIVE' ? '停用' : '启用'}
          </Button>
          <Button type="link" size="small" danger onClick={() => confirmDelete(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>外部连接</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建连接
        </Button>
      </div>

      <Table<Connection>
        rowKey="id"
        columns={columns}
        dataSource={listQuery.data ?? []}
        loading={listQuery.isLoading}
        pagination={false}
      />

      <Modal
        title={editing ? '编辑连接' : '新建连接'}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish} preserve={false}>
          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: '请输入名称' },
              {
                pattern: /^[A-Za-z0-9_-]{1,64}$/,
                message: '仅允许字母、数字、下划线、连字符，长度 1-64',
              },
            ]}
          >
            <Input placeholder="容器可见标识，如 my-api" disabled={!!editing} />
          </Form.Item>
          <Form.Item label="显示名" name="displayName">
            <Input placeholder="便于识别的名称" />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name="baseUrl"
            rules={[
              { required: true, message: '请输入 Base URL' },
              {
                pattern: /^https?:\/\/.+/,
                message: '必须以 http:// 或 https:// 开头',
              },
            ]}
          >
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item label="认证方式" name="authScheme" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'bearer', value: 'bearer' },
                { label: 'api-key', value: 'api-key' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="凭据"
            name="credential"
            rules={editing ? [] : [{ required: true, message: '请输入凭据' }]}
          >
            <Input.Password
              placeholder={editing ? '留空则不修改凭据' : '凭据明文，加密入库后永不回传'}
              visibilityToggle
            />
          </Form.Item>
          <Form.Item label="允许方法" name="allowMethods">
            <Select mode="multiple" options={METHOD_OPTIONS} placeholder="默认 GET" />
          </Form.Item>
          <Form.Item
            label="允许路径"
            name="allowPaths"
            tooltip="每项以 / 开头，支持 glob（** 跨段、* 段内）；留空等价放行全部"
            rules={[
              {
                validator: (_, value?: string[]) =>
                  !value || value.every((p) => p.startsWith('/'))
                    ? Promise.resolve()
                    : Promise.reject(new Error('每项必须以 / 开头')),
              },
            ]}
          >
            <Select
              mode="tags"
              tokenSeparators={[',']}
              options={[]}
              placeholder="如 /v1/**，回车添加多项"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
