import { useMemo, useRef, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Input, Skeleton, Tag, Tooltip, Typography } from 'antd';
import { agentApi } from '@/features/agent/api';
import { authApi } from '@/features/auth/api';
import { connectorApi } from '@/features/connector/api';
import { semanticCoverageOf, semanticStatusMeta } from '@/features/connector/semantic';
import type { ConnectorView } from '@/features/connector/types';

interface AgentConnectionGrantPanelProps {
  agentId: string;
}

interface Outcome {
  state: 'success' | 'error';
  message?: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function healthMeta(row: ConnectorView) {
  if (row.healthState === 'HEALTHY') return { label: '连接健康', color: 'success' };
  if (row.healthState === 'UNHEALTHY') return { label: '连接异常', color: 'error' };
  return { label: '健康未验证', color: undefined };
}

function matchesConnection(row: ConnectorView, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;
  const semantic = semanticStatusMeta(row.semanticStatus);
  return [
    row.displayName,
    row.name,
    row.kindLabel,
    row.kind,
    row.writePolicyLabel,
    semantic.label,
    ...(row.capabilities ?? []),
  ].some((value) =>
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(query),
  );
}

interface ConnectionGrantCardProps {
  row?: ConnectorView;
  connectionId: string;
  granted: boolean;
  canManage: boolean;
  pending: boolean;
  outcome?: Outcome;
  onChange: () => void;
}

function ConnectionGrantCard({
  row,
  connectionId,
  granted,
  canManage,
  pending,
  outcome,
  onChange,
}: ConnectionGrantCardProps) {
  const title = row?.displayName || row?.name || `连接 ${connectionId}`;
  const health = row ? healthMeta(row) : null;
  const semantic = row ? semanticStatusMeta(row.semanticStatus) : null;
  const coverage = row ? semanticCoverageOf(row) : null;
  const rawCoverage = row?.semanticCoverage as string | null | undefined;
  const coverageHint = coverage?.gaps.length
    ? coverage.gaps.map((gap) => `${gap.label}：${gap.desc}`).join('\n')
    : '说明书存在残缺，部分表或字段不会提供给模型。';
  const cannotGrant = !granted && row?.status !== 'ACTIVE';

  return (
    <article
      className="agent-grant-card"
      data-testid="agent-connection-grant-card"
      data-connection-id={connectionId}
      aria-busy={pending}
    >
      <div className="agent-grant-card-head">
        <div className="agent-grant-card-title">
          <strong>{title}</strong>
          <span>{row?.name || connectionId}</span>
        </div>
        {row && (
          <Tooltip title={row.kindLabel || row.kind}>
            <Tag>{row.kindLabel || row.kind}</Tag>
          </Tooltip>
        )}
      </div>

      {row ? (
        <div className="agent-grant-card-tags" aria-label="连接安全状态">
          <Tooltip title={row.healthReason || undefined}>
            <Tag color={health?.color}>{health?.label}</Tag>
          </Tooltip>
          <Tag color={row.readonlyVerified ? 'success' : 'warning'}>
            {row.readonlyVerified ? '只读已验证' : '只读未验证'}
          </Tag>
          <Tooltip title={semantic?.hint}>
            <Tag color={semantic?.color}>语义：{semantic?.label}</Tag>
          </Tooltip>
          {rawCoverage === 'COMPLETE' && <Tag color="success">说明书完整</Tag>}
          {coverage && (
            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{coverageHint}</span>}>
              <Tag color="warning">说明书残缺</Tag>
            </Tooltip>
          )}
          {row.semanticStatus === 'READY' && !rawCoverage && <Tag>完整度未记录</Tag>}
          {rawCoverage && rawCoverage !== 'COMPLETE' && rawCoverage !== 'PARTIAL' && (
            <Tag color="warning">未知完整度（{rawCoverage}）</Tag>
          )}
          <Tag color={row.writePolicy === 'FORBIDDEN' ? undefined : 'gold'}>
            写策略：{row.writePolicyLabel || row.writePolicy}
          </Tag>
          {row.status !== 'ACTIVE' && <Tag>已停用</Tag>}
        </div>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="连接详情当前不可见"
          description="授权关系仍然存在，但企业连接列表没有返回这条连接。"
          style={{ marginTop: 10 }}
        />
      )}

      <div className="agent-grant-card-actions">
        <span
          className={`agent-grant-outcome${
            outcome ? ` agent-grant-outcome--${outcome.state}` : ''
          }`}
          aria-live="polite"
        >
          {pending
            ? '保存中…'
            : outcome?.state === 'success'
              ? '已生效'
              : outcome?.state === 'error'
                ? `保存失败${outcome.message ? `：${outcome.message}` : ''}`
                : granted
                  ? '当前已授权'
                  : '尚未授权'}
        </span>
        <Button
          size="small"
          type={granted ? 'default' : 'primary'}
          danger={granted}
          aria-label={`${granted ? '撤销' : '授权'} ${title}`}
          data-testid="agent-connection-grant-action"
          loading={pending}
          disabled={!canManage || cannotGrant}
          onClick={onChange}
        >
          {granted ? '撤销' : '授权'}
        </Button>
      </div>
    </article>
  );
}

export default function AgentConnectionGrantPanel({ agentId }: AgentConnectionGrantPanelProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const permissionQuery = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    staleTime: 60_000,
  });
  const allQuery = useQuery({
    queryKey: ['connector', 'list'],
    queryFn: connectorApi.list,
  });
  // 可授权列表只列平台还支持的类型（2026-10 起 HTTP 类已下线，只剩数据库类）。与「数据连接」页共用同一份缓存。
  const kindsQuery = useQuery({
    queryKey: ['connector', 'kinds'],
    queryFn: connectorApi.kinds,
    staleTime: 5 * 60_000,
  });
  const boundQuery = useQuery({
    queryKey: ['agent', agentId, 'connections'],
    queryFn: () => agentApi.listConnections(agentId),
    enabled: !!agentId,
  });

  // mutationFn 读取最新渲染提交的权限快照，避免入口校验与异步执行之间使用陈旧闭包。
  const permissionStateRef = useRef({ isError: true, superAdmin: false });
  permissionStateRef.current = {
    isError: permissionQuery.isError,
    superAdmin: permissionQuery.data?.superAdmin === true,
  };
  const assertConnectionMutationAllowed = () => {
    const permission = permissionStateRef.current;
    if (permission.isError || permission.superAdmin !== true) {
      throw new Error('连接授权修改权限不可用，请刷新权限后重试');
    }
  };

  const grantMut = useMutation({
    mutationFn: (connectionId: string) => {
      assertConnectionMutationAllowed();
      return agentApi.grantConnection(agentId, connectionId);
    },
  });
  const revokeMut = useMutation({
    mutationFn: (connectionId: string) => {
      assertConnectionMutationAllowed();
      return agentApi.revokeConnection(agentId, connectionId);
    },
  });

  // 权限查询失败时即使缓存里曾经是超管，也必须 fail-closed，避免用陈旧权限继续修改授权。
  const canManage = !permissionQuery.isError && permissionQuery.data?.superAdmin === true;
  const rows = useMemo(() => allQuery.data ?? [], [allQuery.data]);
  const boundIds = useMemo(
    () => (boundQuery.data ?? []).map((binding) => String(binding.connectionId)),
    [boundQuery.data],
  );
  const boundSet = useMemo(() => new Set(boundIds), [boundIds]);
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesConnection(row, query)),
    [query, rows],
  );
  // 类型清单没拿到时不过滤：授权时后端还会再判一次，宁可多列，也不要把整列连接藏掉。
  // 已授权的遗留行照常留在右侧，方便撤销。
  const supportedKinds = useMemo(
    () =>
      kindsQuery.data ? new Set(kindsQuery.data.map((k) => String(k.kind).toUpperCase())) : null,
    [kindsQuery.data],
  );
  const availableRows = filteredRows.filter(
    (row) =>
      !boundSet.has(row.id) &&
      (!supportedKinds || supportedKinds.has(String(row.kind).toUpperCase())),
  );
  const grantedRows = filteredRows.filter((row) => boundSet.has(row.id));
  const missingGrantedIds = query.trim()
    ? []
    : boundIds.filter((connectionId) => !rows.some((row) => row.id === connectionId));
  const refreshErrors = [
    allQuery.isError ? errorMessage(allQuery.error, '暂时无法刷新企业数据连接') : null,
    boundQuery.isError ? errorMessage(boundQuery.error, '暂时无法刷新当前连接授权') : null,
  ].filter((detail): detail is string => !!detail);

  const applyChange = async (connectionId: string, granted: boolean) => {
    if (!canManage) return;
    setPendingIds((current) => new Set(current).add(connectionId));
    setOutcomes((current) => {
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
    try {
      if (granted) await revokeMut.mutateAsync(connectionId);
      else await grantMut.mutateAsync(connectionId);
      setOutcomes((current) => ({ ...current, [connectionId]: { state: 'success' } }));
      message.success(granted ? '连接授权已撤销' : '连接授权已生效');
      await qc.invalidateQueries({ queryKey: ['agent', agentId, 'connections'] });
    } catch (error) {
      const detail = errorMessage(error, '保存失败');
      setOutcomes((current) => ({
        ...current,
        [connectionId]: { state: 'error', message: detail },
      }));
      message.error(detail);
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
    }
  };

  if (
    (permissionQuery.isLoading && !permissionQuery.data) ||
    (allQuery.isLoading && !allQuery.data) ||
    (boundQuery.isLoading && !boundQuery.data)
  ) {
    return <Skeleton active paragraph={{ rows: 9 }} />;
  }

  if (allQuery.isError && !allQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="无法读取企业数据连接"
        description={errorMessage(
          allQuery.error,
          canManage
            ? '暂时无法读取连接列表'
            : '当前账号可能没有查看企业连接详情的权限；这不是“暂无连接”。',
        )}
        action={
          <Button size="small" aria-label="重试加载企业数据连接" onClick={() => allQuery.refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  if (boundQuery.isError && !boundQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="无法读取当前连接授权"
        description={errorMessage(boundQuery.error, '暂时无法读取该 Agent 的授权关系')}
        action={
          <Button
            size="small"
            aria-label="重试加载当前连接授权"
            onClick={() => boundQuery.refetch()}
          >
            重试
          </Button>
        }
      />
    );
  }

  return (
    <div data-testid="agent-connection-grant-panel">
      <div className="agent-bind-intro">
        <Typography.Text strong>数据连接授权更改后立即生效。</Typography.Text>
        <br />
        <Typography.Text type="secondary">
          授权后 Agent 才能通过 conn_* 工具访问对应系统；这项权限独立保存，不随草稿保存或发布。
        </Typography.Text>
      </div>

      {!canManage && (
        <Alert
          type={permissionQuery.isError ? 'error' : 'info'}
          showIcon
          message={
            permissionQuery.isError ? '授权修改权限读取失败，已暂停修改' : '当前为只读视图'
          }
          description={
            permissionQuery.isError
              ? (
                  <>
                    <div>{errorMessage(permissionQuery.error, '暂时无法读取授权修改权限')}</div>
                    <div>为避免越权，本页暂不开放修改。刷新权限后可重试。</div>
                  </>
                )
              : '授予或撤销生产系统访问权限仅限企业超级管理员；普通成员可以查看当前授权与安全状态。'
          }
          action={
            permissionQuery.isError ? (
              <Button
                size="small"
                aria-label="重试加载授权修改权限"
                onClick={() => permissionQuery.refetch()}
              >
                重试
              </Button>
            ) : undefined
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {(allQuery.isError || boundQuery.isError) && (
        <Alert
          type="warning"
          showIcon
          message="后台刷新失败，当前显示上一次成功读取的连接授权"
          description={
            <ul className="agent-refresh-error-list">
              {refreshErrors.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          }
          action={
            <Button
              size="small"
              aria-label="重试刷新连接授权"
              onClick={() => Promise.all([allQuery.refetch(), boundQuery.refetch()])}
            >
              重试
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      <div className="agent-grant-toolbar">
        <Input
          allowClear
          aria-label="搜索数据连接授权"
          prefix={<SearchOutlined aria-hidden />}
          placeholder="搜索名称、类型、能力或状态"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Typography.Text type="secondary">
          {boundIds.length} 条已授权 · {canManage ? '可修改' : '只读'}
        </Typography.Text>
      </div>

      <div className="agent-grant-columns">
        <section className="agent-grant-column" aria-labelledby="available-connections-title">
          <div className="agent-grant-column-head">
            <Typography.Text strong id="available-connections-title">
              可授权连接
            </Typography.Text>
            <Tag>{availableRows.length}</Tag>
          </div>
          <div className="agent-grant-list">
            {availableRows.length ? (
              availableRows.map((row) => (
                <ConnectionGrantCard
                  key={row.id}
                  row={row}
                  connectionId={row.id}
                  granted={false}
                  canManage={canManage}
                  pending={pendingIds.has(row.id)}
                  outcome={outcomes[row.id]}
                  onChange={() => applyChange(row.id, false)}
                />
              ))
            ) : (
              <div className="agent-grant-empty">
                {query.trim() ? '没有匹配的可授权连接' : '没有其它可授权连接'}
              </div>
            )}
          </div>
        </section>

        <section className="agent-grant-column" aria-labelledby="granted-connections-title">
          <div className="agent-grant-column-head">
            <Typography.Text strong id="granted-connections-title">
              当前已授权
            </Typography.Text>
            <Tag color="blue">{grantedRows.length + missingGrantedIds.length}</Tag>
          </div>
          <div className="agent-grant-list">
            {grantedRows.length || missingGrantedIds.length ? (
              <>
                {grantedRows.map((row) => (
                  <ConnectionGrantCard
                    key={row.id}
                    row={row}
                    connectionId={row.id}
                    granted
                    canManage={canManage}
                    pending={pendingIds.has(row.id)}
                    outcome={outcomes[row.id]}
                    onChange={() => applyChange(row.id, true)}
                  />
                ))}
                {missingGrantedIds.map((connectionId) => (
                  <ConnectionGrantCard
                    key={connectionId}
                    connectionId={connectionId}
                    granted
                    canManage={canManage}
                    pending={pendingIds.has(connectionId)}
                    outcome={outcomes[connectionId]}
                    onChange={() => applyChange(connectionId, true)}
                  />
                ))}
              </>
            ) : (
              <div className="agent-grant-empty">
                {query.trim() ? '没有匹配的已授权连接' : '尚未授权数据连接'}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
