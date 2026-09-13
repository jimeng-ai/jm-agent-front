import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Badge,
  Button,
  Empty,
  Form,
  Input,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { Modal } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { authApi } from '@/features/auth/api';
import { connectorApi } from '@/features/connector/api';
import SchemaForm from '@/features/connector/components/SchemaForm';
import ConnectorAuditDrawer from '@/features/connector/components/ConnectorAuditDrawer';
import type { ConnectorKind, ConnectorUpsert, ConnectorView } from '@/features/connector/types';

/**
 * 数据连接（连接器实例）管理。
 *
 * ★ 整页**不认识任何具体的连接器类型**：类型下拉、表单字段、校验规则全部来自
 * `GET /admin/connectors/kinds`。加一种新类型时这个文件一行都不用改——
 * 这是技术架构 §15 那条验收标准在前端的兑现点。
 *
 * 与「外部连接」页（`/console/connections`）的关系：那个页面服务沙箱 egress 那条既有链路，
 * 保持原样；两个页面读写同一张表，那边建的行 kind 默认是 HTTP。
 */

/**
 * 参数值的类型。刻意不用 `Record<string, unknown>`：antd 的 setFieldsValue 要求
 * 值是 `{} | undefined`，unknown 不满足。而 ParamType 能产生的值也只有这几种，
 * 收窄成联合类型比到处 cast 更诚实。
 */
type ParamValues = Record<string, string | number | boolean | string[] | undefined>;

interface FormValues {
  name: string;
  displayName?: string;
  kind: string;
  params: ParamValues;
}

const healthBadge = (row: ConnectorView) => {
  const status =
    row.healthState === 'HEALTHY' ? 'success' : row.healthState === 'UNHEALTHY' ? 'error' : 'default';
  const text =
    row.healthState === 'HEALTHY' ? '健康' : row.healthState === 'UNHEALTHY' ? '异常' : '未探测';
  const badge = <Badge status={status} text={text} />;
  // 不健康的原因后端已脱敏，可以直接展示——用户看不到原因就只能猜。
  return row.healthReason ? <Tooltip title={row.healthReason}>{badge}</Tooltip> : badge;
};

export default function ConnectorListPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorView | null>(null);
  const [selectedKind, setSelectedKind] = useState<string | undefined>();
  const [auditOf, setAuditOf] = useState<ConnectorView | null>(null);

  // 超管门控：staleTime 必须与其它用到 ['me','permissions'] 的地方一致（全局默认是 30s，
  // 这里和 ModuleRoute / WorkbenchSidebar 一样显式写 60s），否则同 key 不同 staleTime 会多发请求。
  const { data: perm, isLoading: permLoading } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    staleTime: 60_000,
  });

  const enabled = perm?.superAdmin === true;

  const kindsQuery = useQuery({
    queryKey: ['connector', 'kinds'],
    queryFn: connectorApi.kinds,
    enabled,
    // 类型清单只随后端发版变化，不用频繁刷。
    staleTime: 5 * 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['connector', 'list'],
    queryFn: connectorApi.list,
    enabled,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['connector', 'list'] });

  const createMut = useMutation({
    mutationFn: (payload: ConnectorUpsert) => connectorApi.create(payload),
    onSuccess: () => {
      message.success('已创建（连通性、只读权限与能力均已验证通过）');
      closeModal();
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (payload: ConnectorUpsert) => connectorApi.update(editing!.id, payload),
    onSuccess: () => {
      message.success('已保存');
      closeModal();
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => connectorApi.test(id),
    onSuccess: (row) => {
      // 配错必须当场看得见：成功与失败都给明确反馈，不要只刷新列表让用户自己找。
      if (row.healthState === 'HEALTHY') message.success('连接正常');
      else message.error(row.healthReason || '连接异常');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'DISABLED' }) =>
      connectorApi.setStatus(v.id, v.status),
    onSuccess: () => {
      message.success('状态已更新');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => connectorApi.remove(id),
    onSuccess: () => {
      message.success('已删除');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const kinds: ConnectorKind[] = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const activeKind = useMemo(
    () => kinds.find((k) => k.kind === selectedKind),
    [kinds, selectedKind],
  );

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setSelectedKind(undefined);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    const first = kinds[0]?.kind;
    setSelectedKind(first);
    form.setFieldsValue({ kind: first, params: defaultsOf(kinds.find((k) => k.kind === first)) });
    setOpen(true);
  };

  const openEdit = (row: ConnectorView) => {
    setEditing(row);
    setSelectedKind(row.kind);
    form.setFieldsValue({
      name: row.name,
      displayName: row.displayName ?? undefined,
      kind: row.kind,
      // 敏感参数后端不回传，所以这里天然是空的 —— 留空即沿用原值。
      params: { ...(row.params as ParamValues) },
    });
    setOpen(true);
  };

  const onFinish = (v: FormValues) => {
    const payload: ConnectorUpsert = {
      name: v.name,
      displayName: v.displayName,
      params: stripBlankSecrets(v.params ?? {}, activeKind),
    };
    if (editing) {
      updateMut.mutate(payload);
    } else {
      payload.kind = v.kind;
      createMut.mutate(payload);
    }
  };

  const confirmDelete = (row: ConnectorView) => {
    modal.confirm({
      title: `删除连接「${row.displayName || row.name}」？`,
      content: '将同时摘除所有 Agent 对它的授权、清空已缓存的结构信息，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => delMut.mutateAsync(row.id),
    });
  };

  if (permLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  if (perm && !perm.superAdmin) {
    return (
      <Result
        status="403"
        title="仅企业超管可访问"
        subTitle="数据连接涉及客户生产系统的凭据，仅企业超级管理员可管理。"
        icon={<Empty description={false} />}
      />
    );
  }

  const columns: ColumnsType<ConnectorView> = [
    {
      title: '名称',
      key: 'name',
      width: 170,
      render: (_: unknown, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.displayName || row.name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{row.name}</div>
        </div>
      ),
    },
    {
      title: '类型',
      key: 'kind',
      width: 170,
      // kindLabel 是连接器自己声明的 displayName，可能很长（「MySQL / 兼容 MySQL 协议的库（含
      // Doris、StarRocks）」）。不设宽度 + 不省略的话，这一列会把整张表撑变形，右边的
      // 「健康」「只读验证」被挤到标题竖排。这里截断 + tooltip 给全文——
      // 注意是通用处理，不按 kind 分支，否则就破了「新增类型前端零改动」。
      render: (_: unknown, row) => {
        const label = row.kindLabel || row.kind;
        return (
          <Tooltip title={label}>
            <Tag
              style={{
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '能力',
      key: 'capabilities',
      width: 170,
      render: (_: unknown, row) =>
        row.capabilities?.length ? (
          <Space size={4} wrap>
            {row.capabilities.map((c) => (
              <Tag key={c}>{CAP_LABEL[c] ?? c}</Tag>
            ))}
          </Space>
        ) : (
          <Tooltip title="尚未完成接入探测，点「测试连接」后回填">
            <span style={{ color: '#999' }}>未探测</span>
          </Tooltip>
        ),
    },
    {
      title: '健康',
      key: 'health',
      width: 100,
      render: (_: unknown, row) => healthBadge(row),
    },
    {
      // ★ 单列出来而不是塞进「健康」里：未验证只读的连接不该被当成安全的，要显眼。
      title: '只读验证',
      key: 'readonly',
      width: 100,
      render: (_: unknown, row) =>
        row.readonlyVerified ? (
          <Tag color="green">已验证</Tag>
        ) : (
          <Tooltip title="平台未能确认这个账号写不了数据。请在数据库侧改用只读账号后重新测试。">
            <Tag color="orange">未验证</Tag>
          </Tooltip>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (v: string) => (v === 'ACTIVE' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 310,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setAuditOf(row)}>
            使用记录
          </Button>
          <Button
            type="link"
            size="small"
            loading={testMut.isPending && testMut.variables === row.id}
            onClick={() => testMut.mutate(row.id)}
          >
            测试连接
          </Button>
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
        <h2 style={{ margin: 0 }}>数据连接</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!kinds.length}
          onClick={openCreate}
        >
          新建连接
        </Button>
      </div>

      <Table<ConnectorView>
        rowKey="id"
        columns={columns}
        dataSource={listQuery.data ?? []}
        loading={listQuery.isLoading}
        pagination={false}
        // 列宽合计 1100，1440 宽的屏正好放得下；更窄的屏走横向滚动而不是把每列压扁。
        scroll={{ x: 1100 }}
      />

      <Modal
        title={editing ? '编辑连接' : '新建连接'}
        open={open}
        width={640}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        okText={editing ? '保存' : '创建并验证'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish} preserve={false}>
          <Form.Item
            label="类型"
            name="kind"
            rules={[{ required: true, message: '请选择类型' }]}
            // 类型决定 config_json 的形状，改类型等于把一套参数交给另一个实现去解释，后端也会拒绝。
            extra={editing ? '类型不可修改。需要更换请删除后重新创建' : undefined}
          >
            <Select
              disabled={!!editing}
              options={kinds.map((k) => ({ label: k.displayName, value: k.kind }))}
              onChange={(v: string) => {
                setSelectedKind(v);
                // 换类型时旧类型的参数全部作废——留着会被后端的「未知参数」校验拒掉。
                form.setFieldsValue({ params: defaultsOf(kinds.find((k) => k.kind === v)) });
              }}
            />
          </Form.Item>

          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: '请填写名称' },
              {
                pattern: /^[A-Za-z0-9_-]{1,64}$/,
                message: '只能是字母、数字、下划线、短横线，最长 64 位',
              },
            ]}
            extra="模型调用工具时用它寻址，创建后不建议修改"
          >
            <Input disabled={!!editing} placeholder="crm-mysql" />
          </Form.Item>

          <Form.Item label="显示名" name="displayName">
            <Input placeholder="CRM 生产库（只读）" />
          </Form.Item>

          {activeKind && <SchemaForm fields={activeKind.fields} editing={!!editing} />}
        </Form>
      </Modal>

      <ConnectorAuditDrawer connector={auditOf} onClose={() => setAuditOf(null)} />
    </div>
  );
}

const CAP_LABEL: Record<string, string> = {
  QUERY: '能查',
  DESCRIBE: '能自描述',
  INVOKE: '能调用',
  SYNC: '能同步',
  SUBSCRIBE: '能订阅',
  HEALTH: '能报状态',
};

/** 用 schema 里的 default 预填表单。后端也会补默认值，这里只是让用户看得见。 */
function defaultsOf(kind?: ConnectorKind): ParamValues {
  const out: ParamValues = {};
  if (!kind) return out;
  for (const f of kind.fields) {
    if (f.default === undefined) continue;
    if (f.type === 'int') out[f.name] = Number(f.default);
    else if (f.type === 'bool') out[f.name] = f.default === 'true';
    else out[f.name] = f.default;
  }
  return out;
}

/**
 * 敏感字段留空时不要把空串发上去——空串会被后端当成「显式清空」而不是「沿用原值」。
 * 这条语义与旧的连接页一致（那边是在 onFinish 里判 `if (v.credential)`）。
 */
function stripBlankSecrets(params: ParamValues, kind?: ConnectorKind): ParamValues {
  if (!kind) return params;
  const out: ParamValues = { ...params };
  for (const f of kind.fields) {
    if (!f.secret) continue;
    const v = out[f.name];
    if (v === undefined || v === null || v === '') delete out[f.name];
  }
  return out;
}
