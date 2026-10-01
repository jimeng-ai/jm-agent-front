import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Result, Skeleton, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { connectorApi } from '@/features/connector/api';
import ConnectorCard from '@/features/connector/components/ConnectorCard';
import ConnectorFormDrawer from '@/features/connector/components/ConnectorFormDrawer';
import ConnectorInspector from '@/features/connector/components/ConnectorInspector';
import ConnectorListToolbar, {
  type ConnectorFilters,
} from '@/features/connector/components/ConnectorListToolbar';
import { CAPABILITY_LABELS, connectorAttentionIssues } from '@/features/connector/presentation';
import type {
  ConnectorKind,
  ConnectorStatus,
  ConnectorUpsert,
  ConnectorView,
} from '@/features/connector/types';
import './connector-workbench.css';

const EMPTY_CONNECTOR_FILTERS: ConnectorFilters = {
  query: '',
  attention: 'ALL',
  kind: 'ALL',
  health: 'ALL',
  writePolicy: 'ALL',
  semantic: 'ALL',
};

type UpsertRequest =
  | { kind: 'create'; payload: ConnectorUpsert }
  | { kind: 'update'; connectorId: string; payload: ConnectorUpsert };

interface FormMutationVariables {
  requestId: string;
  sessionToken: string;
  connectorId?: string;
}

interface CreateMutationResult {
  connector: ConnectorView;
  writePolicy: string;
}

interface UpdateMutationResult {
  connector: ConnectorView;
}

type CardAction = 'test' | 'status' | 'delete';

const CARD_ACTIONS = ['test', 'status', 'delete'] as const;
const CARD_MUTATION_KEYS: Record<CardAction, readonly string[]> = {
  test: ['connector', 'card', 'test'],
  status: ['connector', 'card', 'status'],
  delete: ['connector', 'card', 'delete'],
};

let requestSequence = 0;

function nextRequestId(scope: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  requestSequence += 1;
  return `${scope}:${uuid ?? `${Date.now()}-${requestSequence}`}`;
}

function cardActionKey(connectorId: string, action: CardAction): string {
  return `${connectorId}:${action}`;
}

/**
 * 连接器控制面。
 *
 * 类型与参数表单始终由 /admin/connectors/kinds 驱动；本页只做实例级编排，不按 kind 分支。
 * 超管鉴权已由路由层 SuperAdminRoute 完成，这里让真实接口错误直接进入可重试状态。
 */
export default function ConnectorListPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorView | null>(null);
  const [formSessionToken, setFormSessionToken] = useState<string | null>(null);
  const formSessionRef = useRef<string | null>(null);
  const upsertRequestsRef = useRef(new Map<string, UpsertRequest>());
  const pendingFormSessionsRef = useRef(new Set<string>());
  const [pendingFormSessions, setPendingFormSessions] = useState<Set<string>>(() => new Set());
  const pendingCardActionsRef = useRef(new Set<string>());
  const [pendingCardActions, setPendingCardActions] = useState<Set<string>>(() => new Set());
  const [filters, setFilters] = useState<ConnectorFilters>(EMPTY_CONNECTOR_FILTERS);
  const deepEditConnectorId =
    searchParams.get('action') === 'edit' ? searchParams.get('connector') : null;
  const deepEditSection = deepEditConnectorId ? searchParams.get('section') : null;
  const globalPendingCardActionKeys = useMutationState<string>({
    filters: {
      status: 'pending',
      predicate: (mutation) => {
        const key = mutation.options.mutationKey;
        return (
          Array.isArray(key) &&
          key[0] === 'connector' &&
          key[1] === 'card' &&
          CARD_ACTIONS.includes(key[2] as CardAction)
        );
      },
    },
    select: (mutation) => {
      const key = mutation.options.mutationKey;
      const action = Array.isArray(key) ? (key[2] as CardAction | undefined) : undefined;
      const variables = mutation.state.variables as { id?: unknown } | undefined;
      return action && typeof variables?.id === 'string'
        ? cardActionKey(variables.id, action)
        : '';
    },
  });
  const globalPendingCardActions = useMemo(
    () => new Set(globalPendingCardActionKeys.filter(Boolean)),
    [globalPendingCardActionKeys],
  );

  useEffect(
    () => () => {
      formSessionRef.current = null;
      upsertRequestsRef.current.clear();
      pendingFormSessionsRef.current.clear();
      pendingCardActionsRef.current.clear();
    },
    [],
  );

  const kindsQuery = useQuery({
    queryKey: ['connector', 'kinds'],
    queryFn: connectorApi.kinds,
    staleTime: 5 * 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['connector', 'list'],
    queryFn: connectorApi.list,
    refetchOnMount: 'always',
    // 后台语义推导没有推送；只有存在 RUNNING 行时才轮询整张列表。
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.semanticStatus === 'RUNNING') ? 5_000 : false,
  });

  const deepEditQuery = useQuery({
    queryKey: ['connector', 'detail', deepEditConnectorId],
    queryFn: () => connectorApi.get(deepEditConnectorId!),
    enabled: !!deepEditConnectorId,
  });

  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ['connector', 'list'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['connector', 'detail', id] });
  };

  const beginFormSession = () => {
    const sessionToken = nextRequestId('connector-form-session');
    formSessionRef.current = sessionToken;
    setFormSessionToken(sessionToken);
    return sessionToken;
  };

  const setFormSessionPending = (sessionToken: string, pending: boolean) => {
    if (pending) pendingFormSessionsRef.current.add(sessionToken);
    else pendingFormSessionsRef.current.delete(sessionToken);
    setPendingFormSessions(new Set(pendingFormSessionsRef.current));
  };

  const closeForm = (expectedSession?: string, force = false) => {
    const currentSession = formSessionRef.current;
    if (!currentSession || (expectedSession && currentSession !== expectedSession)) return false;
    if (!force && pendingFormSessionsRef.current.has(currentSession)) return false;
    formSessionRef.current = null;
    setFormSessionToken(null);
    setFormOpen(false);
    setEditing(null);
    if (searchParams.get('action') === 'edit') {
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      next.delete('section');
      if (next.get('connector')) next.set('tab', 'overview');
      setSearchParams(next, { replace: true });
    }
    return true;
  };

  const beginCardAction = (connectorId: string, action: CardAction) => {
    const key = cardActionKey(connectorId, action);
    const pendingInCache = queryClient
      .getMutationCache()
      .findAll({ mutationKey: CARD_MUTATION_KEYS[action], exact: true, status: 'pending' })
      .some((mutation) => {
        const variables = mutation.state.variables as { id?: unknown } | undefined;
        return variables?.id === connectorId;
      });
    if (
      pendingCardActionsRef.current.has(key) ||
      globalPendingCardActions.has(key) ||
      pendingInCache
    ) {
      return false;
    }
    pendingCardActionsRef.current.add(key);
    setPendingCardActions(new Set(pendingCardActionsRef.current));
    return true;
  };

  const finishCardAction = (connectorId: string, action: CardAction) => {
    pendingCardActionsRef.current.delete(cardActionKey(connectorId, action));
    setPendingCardActions(new Set(pendingCardActionsRef.current));
  };

  const createMut = useMutation<CreateMutationResult, Error, FormMutationVariables>({
    mutationKey: ['connector', 'create'],
    mutationFn: async ({ requestId }) => {
      const request = upsertRequestsRef.current.get(requestId);
      upsertRequestsRef.current.delete(requestId);
      if (!request || request.kind !== 'create') {
        throw new Error('创建请求已过期，请重试');
      }
      try {
        const connector = await connectorApi.create(request.payload);
        return { connector, writePolicy: request.payload.writePolicy ?? 'FORBIDDEN' };
      } finally {
        upsertRequestsRef.current.delete(requestId);
      }
    },
    onSuccess: ({ connector: created, writePolicy }, variables) => {
      invalidate(created.id);
      if (formSessionRef.current !== variables.sessionToken) return;
      message.success(
        writePolicy === 'FORBIDDEN'
          ? '已创建（连通性、只读权限与能力均已验证通过）'
          : '已创建（连通性、账号权限与写策略均已验证通过）',
      );
      closeForm(variables.sessionToken, true);
      // 同目标重复接入会形成两份不互通的语义层，必须让人读完，不能用瞬时 toast。
      if (created.sameTargetHint) {
        modal.info({
          title: '这个库已经接过了',
          width: 560,
          content: created.sameTargetHint,
          okText: '知道了',
        });
      }
    },
    onError: (error, variables) => {
      if (formSessionRef.current === variables.sessionToken) message.error(error.message);
    },
    onSettled: (_data, _error, variables) => setFormSessionPending(variables.sessionToken, false),
  });

  const updateMut = useMutation<UpdateMutationResult, Error, FormMutationVariables>({
    mutationKey: ['connector', 'update'],
    mutationFn: async ({ requestId }) => {
      const request = upsertRequestsRef.current.get(requestId);
      upsertRequestsRef.current.delete(requestId);
      if (!request || request.kind !== 'update') {
        throw new Error('更新请求已过期，请重试');
      }
      try {
        const connector = await connectorApi.update(request.connectorId, request.payload);
        return { connector };
      } finally {
        upsertRequestsRef.current.delete(requestId);
      }
    },
    onSuccess: ({ connector: updated }, variables) => {
      invalidate(updated.id);
      if (formSessionRef.current !== variables.sessionToken) return;
      message.success('已保存');
      closeForm(variables.sessionToken, true);
    },
    onError: (error, variables) => {
      if (formSessionRef.current === variables.sessionToken) message.error(error.message);
    },
    onSettled: (_data, _error, variables) => setFormSessionPending(variables.sessionToken, false),
  });

  const testMut = useMutation({
    mutationKey: CARD_MUTATION_KEYS.test,
    mutationFn: ({ id }: { id: string; requestId: string }) => connectorApi.test(id),
    onSuccess: (row) => {
      if (row.healthState === 'HEALTHY') message.success('连接正常');
      else message.error(row.healthReason || '连接异常');
      invalidate(row.id);
    },
    onError: (error: Error) => message.error(error.message),
    onSettled: (_data, _error, variables) => finishCardAction(variables.id, 'test'),
  });

  const statusMut = useMutation({
    mutationKey: CARD_MUTATION_KEYS.status,
    mutationFn: ({ id, status }: { id: string; status: ConnectorStatus; requestId: string }) =>
      connectorApi.setStatus(id, status),
    onSuccess: (_, variables) => {
      message.success('状态已更新');
      invalidate(variables.id);
    },
    onError: (error: Error) => message.error(error.message),
    onSettled: (_data, _error, variables) => finishCardAction(variables.id, 'status'),
  });

  const deleteMut = useMutation({
    mutationKey: CARD_MUTATION_KEYS.delete,
    mutationFn: ({ id }: { id: string; requestId: string }) => connectorApi.remove(id),
    onSuccess: (_, { id }) => {
      message.success('已删除');
      invalidate(id);
      if (searchParams.get('connector') === id) {
        const next = new URLSearchParams(searchParams);
        next.delete('connector');
        next.delete('tab');
        setSearchParams(next, { replace: true });
      }
    },
    onError: (error: Error) => message.error(error.message),
    onSettled: (_data, _error, variables) => finishCardAction(variables.id, 'delete'),
  });

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const kinds: ConnectorKind[] = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  // 有表结构的连接才有数据星图。按类型声明的能力判断（能自描述），不按类型名写分支；还没探测过的库也算。
  const graphableKinds = useMemo(
    () => new Set(kinds.filter((kind) => kind.capabilities.includes('describe')).map((kind) => kind.kind)),
    [kinds],
  );
  const hasListCache = listQuery.data !== undefined;
  const hasKindsCache = kindsQuery.data !== undefined;
  const listInitialError = listQuery.isError && !hasListCache;
  const listBackgroundError = listQuery.isError && hasListCache;
  const kindsInitialError = kindsQuery.isError && !hasKindsCache;
  const kindsBackgroundError = kindsQuery.isError && hasKindsCache;

  useEffect(() => {
    const target = deepEditQuery.data;
    if (!deepEditConnectorId || !target || formOpen) return;
    // 表单严格由 kinds schema 驱动；详情先到、schema 还没到时继续等，不能先开一个残缺 Drawer。
    if (!kinds.some((kind) => kind.kind === target.kind)) return;
    const sessionToken = nextRequestId('connector-form-session');
    formSessionRef.current = sessionToken;
    setFormSessionToken(sessionToken);
    setEditing(target);
    setFormOpen(true);
  }, [deepEditConnectorId, deepEditQuery.data, formOpen, kinds]);

  const summary = useMemo(
    () => ({
      total: rows.length,
      healthy: rows.filter((row) => row.status === 'ACTIVE' && row.healthState === 'HEALTHY')
        .length,
      attention: rows.filter((row) => connectorAttentionIssues(row).length > 0).length,
      running: rows.filter((row) => row.semanticStatus === 'RUNNING').length,
    }),
    [rows],
  );

  const typeOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const kind of kinds) options.set(kind.kind, kind.displayName);
    // 后端比 kinds 接口新或数据里留着旧类型时仍要能筛选，不能把它们变成筛选盲区。
    for (const row of rows) options.set(row.kind, row.kindLabel || row.kind);
    return [...options].map(([value, label]) => ({ value, label }));
  }, [kinds, rows]);

  const filteredRows = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.attention === 'ATTENTION' && connectorAttentionIssues(row).length === 0) {
        return false;
      }
      if (filters.kind !== 'ALL' && row.kind !== filters.kind) return false;
      if (filters.health !== 'ALL' && row.healthState !== filters.health) return false;
      if (filters.writePolicy !== 'ALL' && row.writePolicy !== filters.writePolicy) return false;
      if (
        filters.semantic !== 'ALL' &&
        (filters.semantic === 'PARTIAL'
          ? row.semanticCoverage !== 'PARTIAL'
          : row.semanticStatus !== filters.semantic)
      ) {
        return false;
      }
      if (!query) return true;
      const capabilities = (row.capabilities ?? [])
        .flatMap((capability) => [capability, CAPABILITY_LABELS[capability] ?? ''])
        .join(' ');
      return `${row.name} ${row.displayName ?? ''} ${row.kind} ${row.kindLabel ?? ''} ${capabilities}`
        .toLowerCase()
        .includes(query);
    });
  }, [filters, rows]);

  const openCreate = () => {
    beginFormSession();
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (connector: ConnectorView) => {
    if (!kinds.some((kind) => kind.kind === connector.kind)) {
      message.error('当前没有这类连接的表单 schema，无法安全编辑；请重试或升级后端。');
      return;
    }
    beginFormSession();
    setEditing(connector);
    setFormOpen(true);
  };

  const openInspector = (connector: ConnectorView) => {
    const next = new URLSearchParams(searchParams);
    next.set('connector', connector.id);
    next.set('tab', 'overview');
    setSearchParams(next);
  };

  const confirmDelete = (connector: ConnectorView) => {
    modal.confirm({
      title: `删除连接「${connector.displayName || connector.name}」？`,
      content: '将同时摘除所有 Agent 对它的授权、清空已缓存的结构信息，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        if (!beginCardAction(connector.id, 'delete')) return Promise.resolve();
        return deleteMut.mutateAsync({
          id: connector.id,
          requestId: nextRequestId('connector-delete'),
        });
      },
    });
  };

  const testConnector = (connector: ConnectorView) => {
    if (!beginCardAction(connector.id, 'test')) return;
    testMut.mutate({ id: connector.id, requestId: nextRequestId('connector-test') });
  };

  const toggleConnector = (connector: ConnectorView) => {
    if (!beginCardAction(connector.id, 'status')) return;
    statusMut.mutate({
      id: connector.id,
      status: connector.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      requestId: nextRequestId('connector-status'),
    });
  };

  const isCardBusy = (id: string) =>
    CARD_ACTIONS.some(
      (action) =>
        pendingCardActions.has(cardActionKey(id, action)) ||
        globalPendingCardActions.has(cardActionKey(id, action)),
    );

  const submitForm = (payload: ConnectorUpsert, sessionToken: string) => {
    if (formSessionRef.current !== sessionToken) return;
    if (pendingFormSessionsRef.current.has(sessionToken)) return;
    const requestId = nextRequestId(editing ? 'connector-update' : 'connector-create');
    setFormSessionPending(sessionToken, true);
    if (editing) {
      upsertRequestsRef.current.set(requestId, {
        kind: 'update',
        connectorId: editing.id,
        payload,
      });
      updateMut.mutate({ requestId, sessionToken, connectorId: editing.id });
    } else {
      upsertRequestsRef.current.set(requestId, { kind: 'create', payload });
      createMut.mutate({ requestId, sessionToken });
    }
  };

  const retryQueries = () => {
    listQuery.refetch();
    kindsQuery.refetch();
  };

  return (
    <div className="connector-workbench" data-testid="connector-workbench">
      <header className="connector-workbench__header">
        <div>
          <Typography.Text className="connector-workbench__eyebrow">
            CONNECTION CONTROL PLANE
          </Typography.Text>
          <Typography.Title level={2}>数据连接</Typography.Title>
          <Typography.Paragraph>
            把账号权限、平台写策略、语义完整度与数据出库范围放在同一张卡上，先看清风险，再打开连接处理。
          </Typography.Paragraph>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          disabled={!kinds.length}
          onClick={openCreate}
        >
          新建连接
        </Button>
      </header>

      <ConnectorListToolbar
        {...summary}
        filters={filters}
        typeOptions={typeOptions}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY_CONNECTOR_FILTERS)}
      />

      {kindsInitialError || kindsBackgroundError ? (
        <Alert
          type={kindsInitialError ? 'error' : 'warning'}
          showIcon
          className="connector-workbench__query-alert"
          message={
            kindsInitialError
              ? '连接类型加载失败，新建与编辑暂不可用'
              : '连接类型刷新失败，继续使用上一次结果'
          }
          description={(kindsQuery.error as Error).message}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => kindsQuery.refetch()}>
              重试
            </Button>
          }
        />
      ) : !kindsQuery.isLoading && kinds.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          className="connector-workbench__query-alert"
          message="后端没有返回可用的连接类型"
          description="现有连接仍可查看和测试，但无法新建或编辑。"
        />
      ) : null}

      {listBackgroundError ? (
        <Alert
          data-testid="connector-list-background-error"
          type="warning"
          showIcon
          className="connector-workbench__query-alert"
          message="连接列表刷新失败，下面保留的是上一次结果"
          description={(listQuery.error as Error).message}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              重试
            </Button>
          }
        />
      ) : null}

      {deepEditConnectorId && deepEditQuery.isError && deepEditQuery.data === undefined ? (
        <Alert
          data-testid="connector-edit-deeplink-error"
          type="error"
          showIcon
          className="connector-workbench__query-alert"
          message="无法打开这条连接的编辑表单"
          description={(deepEditQuery.error as Error).message}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => deepEditQuery.refetch()}>
              重试
            </Button>
          }
        />
      ) : null}

      {deepEditConnectorId &&
      deepEditQuery.data &&
      !kindsQuery.isLoading &&
      !kinds.some((kind) => kind.kind === deepEditQuery.data?.kind) ? (
        <Alert
          type="error"
          showIcon
          className="connector-workbench__query-alert"
          message="当前没有这类连接的表单 schema，无法安全编辑"
          description="重试连接类型接口，或升级后端后再从语义工作台返回。"
        />
      ) : null}

      {listQuery.isLoading && !hasListCache ? (
        <div className="connector-card-grid" aria-label="正在加载数据连接">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="connector-card connector-card--skeleton">
              <Skeleton active paragraph={{ rows: 8 }} />
            </div>
          ))}
        </div>
      ) : listInitialError ? (
        <Result
          status="error"
          title="数据连接加载失败"
          subTitle={(listQuery.error as Error).message}
          extra={
            <Button type="primary" icon={<ReloadOutlined />} onClick={retryQueries}>
              重试
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <div className="connector-empty" data-testid="connector-empty-real">
          <Empty
            description={
              <span>
                还没有数据连接
                <small>创建后，Agent 才能在治理策略约束下访问客户系统。</small>
              </span>
            }
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!kinds.length}
              onClick={openCreate}
            >
              新建第一条连接
            </Button>
          </Empty>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="connector-empty" data-testid="connector-empty-filtered">
          <Empty description="没有符合当前条件的连接">
            <Button onClick={() => setFilters(EMPTY_CONNECTOR_FILTERS)}>清除筛选</Button>
          </Empty>
        </div>
      ) : (
        <div
          className="connector-card-grid"
          data-testid="connector-card-grid"
          aria-label={`数据连接，共 ${filteredRows.length} 条`}
        >
          {filteredRows.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              graphable={graphableKinds.has(connector.kind)}
              busy={isCardBusy(connector.id)}
              onOpen={openInspector}
              onTest={testConnector}
              onEdit={openEdit}
              onToggle={toggleConnector}
              onDelete={confirmDelete}
            />
          ))}
        </div>
      )}

      <ConnectorFormDrawer
        open={formOpen}
        connector={editing}
        kinds={kinds}
        submitting={
          formSessionToken !== null && pendingFormSessions.has(formSessionToken)
        }
        sessionToken={formSessionToken ?? 'closed'}
        initialSection={deepEditSection}
        onClose={() => closeForm(formSessionRef.current ?? undefined)}
        onSubmit={submitForm}
      />
      <ConnectorInspector />
    </div>
  );
}
