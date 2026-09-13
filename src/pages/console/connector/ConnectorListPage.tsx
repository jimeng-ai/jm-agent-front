import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
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
import GrantScriptPanel from '@/features/connector/components/GrantScriptPanel';
import SchemaForm from '@/features/connector/components/SchemaForm';
import ConnectorAuditDrawer from '@/features/connector/components/ConnectorAuditDrawer';
import ConnectorSchemaDrawer from '@/features/connector/components/ConnectorSchemaDrawer';
import type {
  ConnectorKind,
  ConnectorUpsert,
  ConnectorView,
  ProbeOutcome,
} from '@/features/connector/types';

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
  /** 写策略。默认 FORBIDDEN（只读）——放开容易收紧难，默认值取最严的那个。 */
  writePolicy: string;
}

/**
 * 写策略三档。
 *
 * ★ 这是**平台侧的闸**，不是数据库侧的授权。两者必须一起配：选了「写自动」而数据库账号
 * 只有 SELECT，写操作照样会失败（而且失败在客户库上，排查更绕）。弹窗里的「生成授权命令」
 * 面板跟着这个值走，就是为了让两边在同一个动作里对齐。
 *
 * 措辞上刻意不用「读/写/改」——那是权限的说法，而这里配的是**平台放不放行**：
 * 同一个可写账号，策略调成只读，平台就一条写语句都不会发出去。
 */
const WRITE_POLICY_OPTIONS = [
  { value: 'FORBIDDEN', label: '只读 —— 平台拒绝一切写操作（推荐）' },
  { value: 'REQUIRE_APPROVAL', label: '写需审批 —— 模型提交，超管在「写操作审批」页逐条批准后才执行' },
  { value: 'AUTO', label: '写自动 —— 模型可直接改数据，仅受护栏与行数上限约束' },
];

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
  const [probeResult, setProbeResult] = useState<ProbeOutcome | null>(null);
  const [auditOf, setAuditOf] = useState<ConnectorView | null>(null);
  const [schemaOf, setSchemaOf] = useState<ConnectorView | null>(null);

  // 授权命令面板要跟着表单当前值走，所以用 useWatch 而不是读一次初值：
  // 用户把策略从「只读」改成「写自动」之后，生成的命令必须立刻跟着变成带写权限的那版，
  // 否则他会拿着一段只读授权去配一条允许写的连接——两边分叉，且分叉在客户那边才暴露。
  const watchedPolicy = Form.useWatch('writePolicy', form);
  // 库名是通用参数名，不是类型分支：没有这个参数的类型（如 HTTP）读出来就是 undefined，
  // 而 HTTP 连接器本来也不提供授权脚本，面板会自己说明。这里不出现任何 if (kind === ...)。
  const watchedDatabase = Form.useWatch(['params', 'database'], form) as string | undefined;

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

  /**
   * 试连。不落库——跑的是和「创建并验证」同一套三步探测，所以这里过了创建就一定过。
   *
   * 结果就地渲染成 Alert 而不是 toast：配错时要边看原因边改表单，
   * 一闪而过的 toast 等于让人凭记忆改。
   */
  const probeMut = useMutation({
    mutationFn: (payload: ConnectorUpsert) => connectorApi.probe(payload, editing?.id),
    onSuccess: (r) => setProbeResult(r),
    // 接口层面的失败（参数没填全、没权限）也要让人看见，不能静默。
    onError: (e: Error) =>
      setProbeResult({ ok: false, failureReason: e.message, capabilities: [], readonlyVerified: false, readonlyUndetermined: false }),
  });

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
    setProbeResult(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    setProbeResult(null);
    // 表单内容由下面的 initialFormValues 给（见 <Form initialValues> 处的注释）。
    // 这里只管状态：selectedKind 决定渲染哪套参数字段。
    setSelectedKind(kinds[0]?.kind);
    setOpen(true);
  };

  const openEdit = (row: ConnectorView) => {
    setEditing(row);
    setProbeResult(null);
    setSelectedKind(row.kind);
    setOpen(true);
  };

  /**
   * 弹窗里表单的初始值。
   *
   * ★ **必须走 initialValues，不能在 openCreate / openEdit 里 setFieldsValue**。
   * Modal 带 `destroyOnClose`，弹窗关着的时候 `<Form>` 是卸载的，此时 `useForm` 拿到的实例
   * 并没有连上任何 Form 元素——在它上面调 setFieldsValue 会被**静默丢弃**
   * （antd 只在 dev 下警告一次，生产什么都不会发生）。而 openCreate / openEdit 恰恰是
   * 在 `setOpen(true)` 之前调用的，于是：新建时默认值不生效、编辑时整张表单是空的，
   * 两种都不报错。表单随弹窗每次重新挂载，所以放在 initialValues 里每次打开都会重新读。
   */
  const initialFormValues = useMemo<Partial<FormValues>>(() => {
    if (editing) {
      return {
        name: editing.name,
        displayName: editing.displayName ?? undefined,
        kind: editing.kind,
        // 后端认不出来的值已经在 WritePolicy.parse 里回落成 FORBIDDEN，这里不用再兜一次。
        writePolicy: editing.writePolicy,
        // 敏感参数后端不回传，所以这里天然是空的 —— 留空即沿用原值。
        params: { ...(editing.params as ParamValues) },
      };
    }
    const first = kinds[0]?.kind;
    return {
      kind: first,
      // ★ 新建默认只读。这是产品上定下的默认值：绝大多数接入就该停在只读，
      //   而「默认放开、由用户去收紧」这种默认值，现实里没人会回头收紧。
      writePolicy: 'FORBIDDEN',
      params: defaultsOf(kinds.find((k) => k.kind === first)),
    };
  }, [editing, kinds]);

  const onFinish = (v: FormValues) => {
    const payload: ConnectorUpsert = {
      name: v.name,
      displayName: v.displayName,
      writePolicy: v.writePolicy,
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
      // 与「只读验证」分开：那一列说的是**账号实际能不能写**（探测出来的事实），
      // 这一列说的是**平台放不放行**（配置）。两者可以不一致，而不一致恰恰是要看见的：
      // 一个能写的账号配成「只读」是安全的；反过来则是配置错误，写操作到了客户库才会失败。
      title: '写策略',
      key: 'writePolicy',
      width: 110,
      render: (_: unknown, row) =>
        row.writePolicy === 'FORBIDDEN' ? (
          <Tag>{row.writePolicyLabel || '只读'}</Tag>
        ) : (
          <Tag color={row.writePolicy === 'AUTO' ? 'red' : 'orange'}>
            {row.writePolicyLabel || row.writePolicy}
          </Tag>
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
      width: 360,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setAuditOf(row)}>
            使用记录
          </Button>
          {/* 只有具备自描述能力的连接器才有结构可看，没有的话给个按钮只会点了报错。 */}
          {row.capabilities?.includes('DESCRIBE') && (
            <Button type="link" size="small" onClick={() => setSchemaOf(row)}>
              结构
            </Button>
          )}
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
        // 列宽合计 1260（加了「写策略」一列）。更窄的屏走横向滚动而不是把每列压扁——
        // 压扁的后果实测过：标题会竖排，操作列的按钮被裁掉一半。
        scroll={{ x: 1280 }}
      />

      <Modal
        title={editing ? '编辑连接' : '新建连接'}
        open={open}
        width={640}
        onCancel={closeModal}
        destroyOnClose
        // 自定义 footer 只为把「测试连接」放进来：直接提交才知道对不对，
        // 改一版就得再提交一版——验证该能从提交里拆出来单独跑。
        footer={[
          <Button
            key="probe"
            style={{ float: 'left' }}
            loading={probeMut.isPending}
            onClick={async () => {
              try {
                // 先过一遍前端校验：必填没填就去连，只会拿到一个含糊的后端报错。
                const v = await form.validateFields();
                setProbeResult(null);
                probeMut.mutate({
                  name: v.name,
                  displayName: v.displayName,
                  kind: v.kind,
                  // ★ 写策略必须一起传：探测里的只读校验是**按策略判**的——
                  //   策略是只读时，一个能写的账号会被判为不合格；策略放开了写，同一个账号才算合格。
                  //   漏传这个字段，选了「写自动」的用户会看到一条「这个账号能写，不允许接入」的拒绝，
                  //   而那正是他要的配置。
                  writePolicy: v.writePolicy,
                  params: stripBlankSecrets(v.params ?? {}, activeKind),
                });
              } catch {
                // validateFields 自己会把错误标在字段上，这里不用再提示一遍。
              }
            }}
          >
            测试连接
          </Button>,
          <Button key="cancel" onClick={closeModal}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={createMut.isPending || updateMut.isPending}
            onClick={() => form.submit()}
          >
            {editing ? '保存' : '创建并验证'}
          </Button>,
        ]}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          preserve={false}
          initialValues={initialFormValues}
        >
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
                // 换了类型，上一次的试连结果就不是在说这套参数了，留着会误导。
                setProbeResult(null);
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

          <Form.Item
            label="写策略"
            name="writePolicy"
            rules={[{ required: true, message: '请选择写策略' }]}
            extra="这是平台侧的闸。数据库账号本身的权限是另一回事——两者都要配，下面的「生成授权命令」会按这里选的档生成。"
          >
            <Select options={WRITE_POLICY_OPTIONS} />
          </Form.Item>

          {/* ★ 放开写之后，「只读验证」这道防线就不再成立，必须当场说清楚它换成了什么。
              不写这段的话，用户只会看到一个选项变了，不会意识到防护模型整个换了一套。 */}
          {watchedPolicy && watchedPolicy !== 'FORBIDDEN' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="这条连接将允许修改客户数据"
              description={
                <>
                  只读校验不再是接入门槛（能写的账号也能通过）。此后拦得住误操作的只剩：
                  单条 DML、<b>UPDATE / DELETE 必须带 WHERE</b>、影响行数超上限整条回滚、
                  以及禁用 DDL / TRUNCATE / REPLACE。
                  {watchedPolicy === 'AUTO'
                    ? ' 选「写自动」意味着模型不经任何人确认即可改数据，请只对确实需要的连接使用。'
                    : ' 选「写需审批」时，模型只能提交，实际执行发生在超管点「批准」之后。'}
                </>
              }
            />
          )}

          {/* 折叠面板，默认收起：绝大多数情况下客户已经有账号了，这块不该占版面。
              放在参数之后，是因为它要用到上面填的库名。 */}
          {activeKind && (
            <GrantScriptPanel
              kind={activeKind.kind}
              database={watchedDatabase}
              writePolicy={watchedPolicy ?? 'FORBIDDEN'}
            />
          )}

          {probeResult && <ProbeResultAlert result={probeResult} />}
        </Form>
      </Modal>

      <ConnectorAuditDrawer connector={auditOf} onClose={() => setAuditOf(null)} />
      <ConnectorSchemaDrawer connector={schemaOf} onClose={() => setSchemaOf(null)} />
    </div>
  );
}

/**
 * 试连结果。
 *
 * 成功时把【探到的能力】也列出来——它决定这条连接接进来之后 Agent 到底能干什么，
 * 在保存前就该让人看见（比如账号读不了 information_schema 时「能自描述」会缺席）。
 *
 * 失败时把只读判定的三态区分开：「确认可写」要换账号，「判不出来」要去查账号权限，
 * 两者都不予保存但动作不同，压成一句话等于替使用者做了判断。
 */
function ProbeResultAlert({ result }: { result: ProbeOutcome }) {
  if (result.ok) {
    return (
      <Alert
        type="success"
        showIcon
        message="连接正常，只读已验证"
        description={
          <>
            探测到的能力：
            <Space size={4} wrap style={{ marginLeft: 4 }}>
              {result.capabilities.map((c) => (
                <Tag key={c}>{CAP_LABEL[c] ?? c}</Tag>
              ))}
            </Space>
            {result.readonlyDetail && (
              <div style={{ marginTop: 4, color: '#999' }}>只读依据：{result.readonlyDetail}</div>
            )}
          </>
        }
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      message={result.readonlyUndetermined ? '无法确认这个账号是只读的' : '连接测试未通过'}
      description={result.failureReason}
    />
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
