import { useEffect, useState } from 'react';
import type { Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Result,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { authApi } from '@/features/auth/api';
import { connectorWriteApi } from '@/features/connector/api';
import type {
  PendingWriteRow,
  PendingWriteStatus,
  WriteOperation,
} from '@/features/connector/types';

/**
 * 写操作审批。
 *
 * ★ 这一页存在的全部理由是**「有个人看过那条语句」**。
 * 所以它的每一个展示决策都往同一个方向倒：
 * - 语句默认可见（不藏在展开里让人去点），
 * - 批准走二次确认并把语句再完整摆一遍，
 * - 拒绝必须写原因。
 * 任何让「批准」变得更省事的改动都是在削弱这一页——省下的那一下点击，
 * 换来的是没人看语句就点了批准。
 *
 * 与「使用记录」抽屉的分工：那边看的是**已经发生过的事**，这边决定**要不要发生**。
 */

const OP_META: Record<WriteOperation, { color: string; label: string }> = {
  INSERT: { color: 'green', label: 'INSERT' },
  UPDATE: { color: 'orange', label: 'UPDATE' },
  // 删除最不可逆，单独给最重的颜色。
  DELETE: { color: 'red', label: 'DELETE' },
};

const STATUS_META: Record<PendingWriteStatus, { color: string; label: string }> = {
  PENDING: { color: 'blue', label: '待审批' },
  APPROVED: { color: 'green', label: '已批准' },
  REJECTED: { color: 'default', label: '已拒绝' },
  EXPIRED: { color: 'volcano', label: '已过期' },
  FAILED: { color: 'red', label: '执行失败' },
};

type StatusFilter = 'PENDING' | 'ALL';

const MONO: React.CSSProperties = {
  margin: 0,
  padding: 10,
  background: '#f6f6f6',
  borderRadius: 6,
  fontFamily: 'Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

const fmtTime = (v?: string | null) => (v ? v.replace('T', ' ').slice(0, 19) : '-');

/**
 * 这一行实际上还能不能批。
 *
 * 后端的过期是**惰性**的（扫到才改状态），所以一条 status 还是 PENDING 的记录，
 * expiresAt 可能已经过去了——按 status 判断会给出一个点了必被拒的按钮。
 *
 * 时间串解析不出来（NaN）时刻意判为「未过期」：这里判错只是多给一个按钮，
 * 真正的闸在后端；反过来把还能批的藏掉才是真的挡住人干活。
 */
function isExpired(r: PendingWriteRow): boolean {
  if (r.status === 'EXPIRED') return true;
  if (!r.expiresAt) return false;
  const at = Date.parse(r.expiresAt);
  return !Number.isNaN(at) && at < Date.now();
}

export default function PendingWritePage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [rejecting, setRejecting] = useState<PendingWriteRow | null>(null);
  const [reason, setReason] = useState('');

  // 超管门控：staleTime 必须与其它用到 ['me','permissions'] 的地方一致（全局默认是 30s，
  // 这里和 ModuleRoute / ConnectorListPage 一样显式写 60s），否则同 key 不同 staleTime 会多发请求。
  const { data: perm, isLoading: permLoading } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    staleTime: 60_000,
  });

  const enabled = perm?.superAdmin === true;

  const listQuery = useQuery({
    queryKey: ['connector', 'pending-writes', page, size, statusFilter],
    queryFn: () =>
      connectorWriteApi.pendingWrites({
        page,
        size,
        status: statusFilter === 'ALL' ? undefined : 'PENDING',
      }),
    enabled,
  });

  const rows = listQuery.data?.records ?? [];

  /**
   * 语句必须默认可见。
   *
   * antd 的 `defaultExpandAllRows` 只在表格**首次挂载**时算一次，而数据是异步来的——
   * 首屏 dataSource 是空数组，等数据到了没人再展开，结果就是「全都收起」。
   * 所以这里改成受控：每次数据变了就把所有行的 key 铺回去（用户仍可手动收起某一行）。
   */
  //（依赖的是 id 拼成的串而不是数组本身：react-query 每次刷新都给新数组引用，
  // 直接依赖数组会在每次轮询后重置用户手动收起的那几行。）
  const rowIdSig = rows.map((r) => r.id).join(',');
  useEffect(() => {
    setExpandedKeys(rowIdSig ? rowIdSig.split(',') : []);
  }, [rowIdSig]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['connector', 'pending-writes'] });

  const approveMut = useMutation({
    mutationFn: (id: string) => connectorWriteApi.approve(id),
    onSuccess: (row) => {
      // 接口 200 ≠ 数据改成功：批准之后语句还要真的在客户库上跑一次，跑挂了回 FAILED。
      // 这里不看 status 就报「已执行」，等于骗人。
      if (row.status === 'FAILED') {
        message.error(row.errorDetail || '已批准，但语句在客户库上执行失败');
      } else {
        const n = Number(row.affectedRows ?? 0);
        message.success(`已执行，影响 ${Number.isNaN(n) ? row.affectedRows : n} 行`);
      }
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => connectorWriteApi.reject(v.id, v.reason),
    onSuccess: () => {
      message.success('已拒绝');
      setRejecting(null);
      setReason('');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  /**
   * 批准的二次确认。
   *
   * 语句在这里**再完整显示一遍**而不是只说「确定吗」：确认框是最后一道让人真正看一眼的机会，
   * 一个没有内容的确认框只会训练出闭眼点确定的肌肉记忆。
   */
  const confirmApprove = (r: PendingWriteRow) => {
    modal.confirm({
      title: '批准后会立即在客户的生产数据库上执行',
      width: 680,
      content: (
        <div>
          <div style={{ marginBottom: 8, color: '#666' }}>
            连接 {r.connectorName}
            {r.targetTable ? ` · 表 ${r.targetTable}` : ''}
            {r.agentName ? ` · 来自 ${r.agentName}` : ''}
          </div>
          <pre style={MONO}>{r.statementText}</pre>
          {/* ★ 范围是审批唯一真正要判断的东西，而光看 SQL 判不出来。
              措辞必须说清它是【提交时】的预估：估算与执行之间隔着人的思考时间，数据会变。 */}
          {r.estimatedRows !== null && r.estimatedRows !== undefined ? (
            <div style={{ marginTop: 8 }}>
              预计影响 <b>{String(r.estimatedRows)}</b> 行
              <span style={{ color: '#999' }}>（提交时预估，执行时可能已变化）</span>
            </div>
          ) : (
            <div style={{ marginTop: 8, color: '#d46b08' }}>
              平台<b>未能预估</b>影响行数——请自行确认 WHERE 条件的命中范围
            </div>
          )}
          <div style={{ marginTop: 8, color: '#666' }}>
            执行结果平台无法撤销。请确认 WHERE 条件命中的行数在你的预期之内。
          </div>
        </div>
      ),
      okText: '确认批准并执行',
      okButtonProps: { danger: true },
      cancelText: '再看看',
      onOk: () => approveMut.mutateAsync(r.id),
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
        subTitle="批准一条写操作等于直接改客户的生产数据，仅企业超级管理员可操作。"
        icon={<Empty description={false} />}
      />
    );
  }

  const columns: ColumnsType<PendingWriteRow> = [
    {
      title: '时间',
      dataIndex: 'time',
      key: 'time',
      width: 160,
      render: (v: string) => fmtTime(v),
    },
    {
      title: '连接',
      dataIndex: 'connectorName',
      key: 'connectorName',
      width: 150,
      ellipsis: true,
    },
    {
      title: 'Agent',
      key: 'agent',
      width: 140,
      render: (_: unknown, r) =>
        r.agentName ?? (
          // Agent 被删了审批记录仍在——它记的是历史事实，不该跟着消失。
          <Typography.Text type="secondary">已删除的 Agent</Typography.Text>
        ),
    },
    {
      title: '操作',
      dataIndex: 'operation',
      key: 'operation',
      width: 100,
      render: (v: WriteOperation) => {
        const meta = OP_META[v];
        return <Tag color={meta?.color}>{meta?.label ?? v}</Tag>;
      },
    },
    {
      title: '目标表',
      dataIndex: 'targetTable',
      key: 'targetTable',
      width: 160,
      render: (v?: string | null) => (v ? <Typography.Text code>{v}</Typography.Text> : '-'),
    },
    {
      title: '状态',
      key: 'status',
      width: 130,
      render: (_: unknown, r) => {
        // 惰性过期：status 还写着 PENDING 但时间已经过了，照 PENDING 显示会骗人。
        const expired = isExpired(r);
        const meta = expired ? STATUS_META.EXPIRED : STATUS_META[r.status];
        const tag = <Tag color={meta?.color}>{meta?.label ?? r.status}</Tag>;
        if (expired) {
          return (
            <Tooltip title={`审批有效期至 ${fmtTime(r.expiresAt)}，已超时，平台不会再执行`}>
              {tag}
            </Tooltip>
          );
        }
        return tag;
      },
    },
    {
      title: '审批',
      key: 'action',
      width: 150,
      render: (_: unknown, r) => {
        if (r.status !== 'PENDING') {
          return (
            <Typography.Text type="secondary">
              {r.decidedBy ? `${r.decidedBy} 已处理` : '已处理'}
            </Typography.Text>
          );
        }
        if (isExpired(r)) {
          // 过期的不给批准按钮：点了也会被后端拒，给出来只是让人白跑一趟。
          return <Typography.Text type="secondary">已超时，不可批准</Typography.Text>;
        }
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              danger
              loading={approveMut.isPending && approveMut.variables === r.id}
              onClick={() => confirmApprove(r)}
            >
              批准
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => {
                setReason('');
                setRejecting(r);
              }}
            >
              拒绝
            </Button>
          </Space>
        );
      },
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
        <h2 style={{ margin: 0 }}>写操作审批</h2>
        <Segmented<StatusFilter>
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[
            { label: '待审批', value: 'PENDING' },
            { label: '全部', value: 'ALL' },
          ]}
        />
      </div>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="批准即执行，平台不提供撤销"
        description="下面每行展开处的语句是护栏改写后、将要真正打到客户库上的那一条（不是模型写的原文）。批准前请读完它——这一页的意义就在于此。超时未审的会自动作废，不会补执行。"
      />

      <Table<PendingWriteRow>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={listQuery.isLoading}
        locale={{
          emptyText: (
            <Empty
              description={statusFilter === 'PENDING' ? '没有待审批的写操作' : '还没有写操作记录'}
            />
          ),
        }}
        // 过期行整行压暗：它和待办长得一样的话，一眼扫过去会误以为还有事要做。
        onRow={(r) => (isExpired(r) ? { style: { background: '#fff7f0' } } : {})}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
          expandedRowRender: (r) => (
            <div>
              <Typography.Paragraph style={MONO} copyable={{ text: r.statementText }}>
                {r.statementText}
              </Typography.Paragraph>
              <Space size={16} wrap style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
                {r.status === 'PENDING' && r.expiresAt && (
                  <span>有效期至 {fmtTime(r.expiresAt)}</span>
                )}
                {r.decidedBy && <span>处理人 {r.decidedBy}</span>}
                {r.decidedAt && <span>处理时间 {fmtTime(r.decidedAt)}</span>}
                {r.estimatedRows !== null && r.estimatedRows !== undefined && (
                  <span>预估影响 {String(r.estimatedRows)} 行（提交时）</span>
                )}
                {r.affectedRows !== null && r.affectedRows !== undefined && (
                  <span>实际影响行数 {String(r.affectedRows)}</span>
                )}
                {/* trace_id 让人能顺着回到「模型当时为什么要写这一条」——
                    只看一条 SQL 是判不出它该不该执行的。 */}
                {r.traceId && (
                  <span>
                    来自对话{' '}
                    <Typography.Text copyable={{ text: r.traceId }} style={{ fontSize: 12 }}>
                      {r.traceId.slice(0, 8)}…
                    </Typography.Text>
                  </span>
                )}
              </Space>
              {/* 执行失败的原因后端已脱敏，可以直接展示——不给原因，人只能去猜或者再批一次。 */}
              {r.errorDetail && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 8 }}
                  message="执行失败"
                  description={r.errorDetail}
                />
              )}
            </div>
          ),
        }}
        pagination={{
          current: page,
          pageSize: size,
          total: Number(listQuery.data?.total ?? 0),
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p);
            setSize(s);
          },
        }}
        scroll={{ x: 1000 }}
      />

      <Modal
        title="拒绝这条写操作"
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        okText="确认拒绝"
        okButtonProps={{ disabled: !reason.trim(), loading: rejectMut.isPending }}
        cancelText="取消"
        onOk={() => rejecting && rejectMut.mutate({ id: rejecting.id, reason: reason.trim() })}
        destroyOnClose
      >
        {rejecting && <pre style={MONO}>{rejecting.statementText}</pre>}
        {/* 原因必填：事后回看时「谁拒的」没有「为什么拒」值钱，模型那边也要拿这句话去改写。 */}
        <div style={{ margin: '12px 0 4px' }}>拒绝原因（必填，会回给发起这次写操作的 Agent）</div>
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：这条 UPDATE 没有限定客户 ID，影响范围太大"
        />
      </Modal>
    </div>
  );
}
