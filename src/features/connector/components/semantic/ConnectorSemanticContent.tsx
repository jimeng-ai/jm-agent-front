import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Spin } from 'antd';
import { connectorApi } from '@/features/connector/api';
import {
  SCOPE_ORDER,
  answeredSemanticTerms,
  groupByScope,
  rowAnchor,
  scopeMeta,
  semanticAttentionReasons,
} from '@/features/connector/semantic';
import type {
  ConnectorSemanticRow,
  ConnectorView,
  SemanticScope,
} from '@/features/connector/types';
import SemanticCoverageStrip from './SemanticCoverageStrip';
import SemanticHeader from './SemanticHeader';
import SemanticInspector from './SemanticInspector';
import SemanticRowList from './SemanticRowList';
import SemanticScopeRail from './SemanticScopeRail';
import type { SemanticScopeFilter } from './SemanticScopeRail';
import './semantic-workbench.css';

interface Props {
  connector: ConnectorView;
  onBack?: () => void;
}

const CLAIM_WAIT_INTERVAL_MS = 2_000;
const CLAIM_WAIT_TIMEOUT_MS = 90_000;
const TERMINAL_SEMANTIC_STATUSES = new Set(['READY', 'FAILED', 'NOT_APPLICABLE']);

interface SemanticRuntimeWindow extends Window {
  /** 仅供本地 E2E 加速 90 秒状态机；生产页面不设置它。 */
  __JM_SEMANTIC_CLAIM_WAIT_TIMEOUT_MS__?: number;
}

function claimWaitTimeoutMs(): number {
  if (!import.meta.env.DEV) return CLAIM_WAIT_TIMEOUT_MS;
  const override = Number((window as SemanticRuntimeWindow).__JM_SEMANTIC_CLAIM_WAIT_TIMEOUT_MS__);
  return Number.isFinite(override) && override > 0 ? override : CLAIM_WAIT_TIMEOUT_MS;
}

interface DeriveBaseline {
  status: string | null;
  syncedAt: string | null;
  claimAt: string | null;
}

interface DeriveRequest {
  connectorId: string;
  baseline: DeriveBaseline;
}

interface DeriveClaimWait {
  baseline: DeriveBaseline;
  phase: 'WATCHING' | 'TIMED_OUT';
  deadline: number;
}

interface SemanticProgressMarker {
  status: string | null;
  syncedAt: string | null;
  claimAt: string | null;
}

interface DeriveNotice {
  note: string;
  error: string | null;
}

export default function ConnectorSemanticContent({ connector, onBack }: Props) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<SemanticScopeFilter>('ATTENTION');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [claimWait, setClaimWait] = useState<DeriveClaimWait | null>(null);
  const [deriveNotice, setDeriveNotice] = useState<DeriveNotice | null>(null);
  const progressRef = useRef<{ connectorId: string; marker: SemanticProgressMarker } | null>(null);
  const terminalRefreshKeyRef = useRef<string | null>(null);
  const running = connector.semanticStatus === 'RUNNING';
  const tier = connector.semanticDataTier;
  const tierText = connector.semanticDataTierLabel || connector.semanticDataTier || '未知档位';

  const semanticQuery = useQuery({
    queryKey: ['connector', 'semantic', connector.id],
    queryFn: () => connectorApi.semantic(connector.id),
    // 推导是异步派发，没有推送。只有 RUNNING 才轮询；其它状态不产生后台流量。
    refetchInterval: running ? 5_000 : false,
  });
  const rows = useMemo(() => semanticQuery.data ?? [], [semanticQuery.data]);
  const answeredTerms = useMemo(() => answeredSemanticTerms(rows), [rows]);
  const failedContext = {
    previousSuccessKnown: Boolean(connector.semanticSyncedAt),
    storedRowsPresent: rows.length > 0,
  };

  const refreshConnectorState = useCallback(
    (connectorId: string) => {
      void queryClient.invalidateQueries({ queryKey: ['connector', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['connector', 'detail', connectorId] });
    },
    [queryClient],
  );

  const refresh = useCallback(
    (connectorId: string) => {
      refreshConnectorState(connectorId);
      void queryClient.invalidateQueries({ queryKey: ['connector', 'semantic', connectorId] });
    },
    [queryClient, refreshConnectorState],
  );

  const deriveMutation = useMutation({
    mutationFn: ({ connectorId }: DeriveRequest) => connectorApi.deriveSemantic(connectorId),
    onSuccess: (result, request) => {
      if (result?.started !== true) {
        const note = result?.note?.trim() || '没能开始生成，请稍后重试。';
        const error = result?.error?.trim() || null;
        setClaimWait(null);
        setDeriveNotice({ note, error });
        message.error([note, error].filter(Boolean).join('：'));
        return;
      }
      setDeriveNotice(null);
      message.info('已开始生成，进度看上方状态。');
      setClaimWait({
        baseline: request.baseline,
        phase: 'WATCHING',
        deadline: Date.now() + claimWaitTimeoutMs(),
      });
      // 派发后只刷连接状态。语义行等终态信号出现后再强制抓一次，避免旧行竞态覆盖终态行。
      refreshConnectorState(request.connectorId);
    },
    onError: (error: Error) => message.error(error.message),
  });

  // RUNNING 的最后一次详情轮询拿到终态后，row query 的定时器会随 render 停止。此处按终态标记
  // 去重并强制 refetch 一次；先取消尚未完成的旧 rows 请求，避免它晚到后把终态结果覆盖回去。
  useEffect(() => {
    const marker: SemanticProgressMarker = {
      status: connector.semanticStatus ?? null,
      syncedAt: connector.semanticSyncedAt ?? null,
      claimAt: connector.semanticClaimAt ?? null,
    };
    const previousState = progressRef.current;
    if (!previousState || previousState.connectorId !== connector.id) {
      progressRef.current = { connectorId: connector.id, marker };
      terminalRefreshKeyRef.current = null;
      return;
    }

    const previous = previousState.marker;
    progressRef.current = { connectorId: connector.id, marker };
    const terminal = TERMINAL_SEMANTIC_STATUSES.has(marker.status ?? '');
    const leftRunning = previous.status === 'RUNNING' && terminal;
    const terminalTimestampChanged =
      terminal &&
      ((marker.syncedAt !== null && marker.syncedAt !== previous.syncedAt) ||
        (marker.claimAt !== null && marker.claimAt !== previous.claimAt));
    if (!leftRunning && !terminalTimestampChanged) return;

    const refreshKey = [connector.id, marker.status, marker.syncedAt, marker.claimAt].join('|');
    if (terminalRefreshKeyRef.current === refreshKey) return;
    terminalRefreshKeyRef.current = refreshKey;
    void (async () => {
      await queryClient.cancelQueries({
        queryKey: ['connector', 'semantic', connector.id],
        exact: true,
      });
      try {
        await queryClient.fetchQuery({
          queryKey: ['connector', 'semantic', connector.id],
          queryFn: () => connectorApi.semantic(connector.id),
          staleTime: 0,
        });
      } catch {
        // fetchQuery 已把 error 写回同一个 query；由下方保留旧内容 + 重试的 Alert 呈现。
      }
    })();
  }, [connector.id, connector.semanticClaimAt, connector.semanticStatus, connector.semanticSyncedAt, queryClient]);

  // POST 只说明任务进了队列。后台真正认领前，详情会连续多次保持旧 READY/FAILED；这段短轮询专门跨过该窗口。
  useEffect(() => {
    if (!claimWait || claimWait.phase !== 'WATCHING') return undefined;
    let fetching = false;
    const poll = () => {
      if (fetching) return;
      fetching = true;
      void queryClient
        .refetchQueries({ queryKey: ['connector', 'detail', connector.id], exact: true })
        .finally(() => {
          fetching = false;
        });
    };
    const interval = window.setInterval(poll, CLAIM_WAIT_INTERVAL_MS);
    const remaining = Math.max(0, claimWait.deadline - Date.now());
    const timeout = window.setTimeout(() => {
      setClaimWait((current) =>
        current?.deadline === claimWait.deadline ? { ...current, phase: 'TIMED_OUT' } : current,
      );
    }, remaining);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [claimWait, connector.id, queryClient]);

  // 只有观察到这次派发对应的新迹象才结束等待，不能把派发前遗留的 READY/FAILED 当成新任务终态。
  useEffect(() => {
    if (!claimWait || claimWait.phase !== 'WATCHING') return;
    const status = connector.semanticStatus ?? null;
    const syncedAt = connector.semanticSyncedAt ?? null;
    const claimAt = connector.semanticClaimAt ?? null;
    const sawRunning = status === 'RUNNING';
    const sawNewSuccess = Boolean(syncedAt && syncedAt !== claimWait.baseline.syncedAt);
    const sawNewClaim = Boolean(claimAt && claimAt !== claimWait.baseline.claimAt);
    const sawClaimedTerminal =
      sawNewClaim && ['READY', 'FAILED', 'NOT_APPLICABLE'].includes(status ?? '');
    if (!sawRunning && !sawNewSuccess && !sawClaimedTerminal) return;
    setClaimWait(null);
    refreshConnectorState(connector.id);
  }, [
    claimWait,
    connector.id,
    connector.semanticClaimAt,
    connector.semanticStatus,
    connector.semanticSyncedAt,
    refreshConnectorState,
  ]);

  useEffect(() => {
    setClaimWait(null);
    setDeriveNotice(null);
  }, [connector.id]);

  const continueClaimCheck = () => {
    setClaimWait((current) =>
      current
        ? {
            ...current,
            phase: 'WATCHING',
            deadline: Date.now() + claimWaitTimeoutMs(),
          }
        : current,
    );
  };

  const confirmDerive = () => {
    const connectorId = connector.id;
    const request: DeriveRequest = {
      connectorId,
      baseline: {
        status: connector.semanticStatus ?? null,
        syncedAt: connector.semanticSyncedAt ?? null,
        claimAt: connector.semanticClaimAt ?? null,
      },
    };
    modal.confirm({
      title: '重新生成语义层？',
      width: 580,
      content: (
        <div className="semantic-confirm-copy">
          <p>只更新机器生成的说明，人工确认的口径和库注释不会动。</p>
          <p>在后台生成，通常几十秒到几分钟。</p>
        </div>
      ),
      okText: '开始生成',
      cancelText: '取消',
      onOk: () => deriveMutation.mutateAsync(request),
    });
  };

  const deleteMutation = useMutation({
    mutationFn: ({ connectorId, rowId }: { connectorId: string; rowId: string }) =>
      connectorApi.deleteSemanticRow(connectorId, rowId),
    onSuccess: (result, variables) => {
      if (Number(result?.removed ?? 0) > 0) {
        message.success('已删除。');
      } else {
        message.info('这条说明已不存在。');
      }
      setInspectorOpen(false);
      refresh(variables.connectorId);
    },
    onError: (error: Error) => message.error(error.message),
  });

  const confirmDelete = (row: ConnectorSemanticRow) => {
    const connectorId = connector.id;
    const rowId = row.id;
    modal.confirm({
      title: `删除这条说明「${rowAnchor(row)}」？`,
      width: 580,
      content: (
        <div className="semantic-confirm-copy">
          <p>删除后无法恢复。</p>
          <p>机器生成的说明重新生成后会再出现；人工确认的口径会连同修改记录一起消失。</p>
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync({ connectorId, rowId }),
    });
  };

  const groups = useMemo(() => groupByScope(rows), [rows]);
  const filteredRows = useMemo(() => {
    if (scope === 'ATTENTION') {
      return rows.filter((row) => semanticAttentionReasons(row, tier, answeredTerms).length > 0);
    }
    if (scope === 'UNKNOWN') {
      return rows.filter((row) => !SCOPE_ORDER.includes(row.scope as SemanticScope));
    }
    return rows.filter((row) => row.scope === scope);
  }, [answeredTerms, rows, scope, tier]);

  const selectRow = useCallback((row: ConnectorSemanticRow | null) => {
    setSelectedId(row?.id ?? null);
  }, []);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const filteredSignature = filteredRows.map((row) => row.id).join(',');
  useEffect(() => {
    if (filteredRows.some((row) => row.id === selectedId)) return;
    setSelectedId(filteredRows[0]?.id ?? null);
  }, [filteredRows, filteredSignature, selectedId]);

  const activeMeta = (() => {
    if (scope === 'ATTENTION') {
      return {
        label: '需关注',
        desc: '需要你留意的说明。',
      };
    }
    if (scope === 'UNKNOWN') {
      const unknown = groups.find((group) => !SCOPE_ORDER.includes(group.scope as SemanticScope));
      return {
        label: '未知分类',
        desc: unknown?.meta.desc ?? '无法归类的说明。',
      };
    }
    return scopeMeta(scope);
  })();

  const showInitialError = semanticQuery.isError && semanticQuery.data === undefined;

  return (
    <div className="semantic-workbench" data-testid="semantic-workbench">
      <SemanticHeader
        connector={connector}
        rowCount={rows.length}
        derivePending={deriveMutation.isPending}
        deriveBlocked={deriveMutation.isPending || claimWait !== null}
        onDerive={confirmDerive}
        onBack={onBack}
      />
      <SemanticCoverageStrip connector={connector} />

      {deriveNotice && (
        <Alert
          className="semantic-load-alert"
          data-testid="semantic-derive-not-started"
          type="error"
          showIcon
          message="任务没有开始"
          description={[deriveNotice.note, deriveNotice.error].filter(Boolean).join('；')}
          closable
          onClose={() => setDeriveNotice(null)}
        />
      )}

      {claimWait && (
        <Alert
          className="semantic-load-alert"
          data-testid="semantic-derive-claim-wait"
          type={claimWait.phase === 'WATCHING' ? 'info' : 'warning'}
          showIcon
          message={claimWait.phase === 'WATCHING' ? '已提交' : '排队时间较长'}
          description={
            claimWait.phase === 'WATCHING'
              ? '正在排队，稍等片刻。'
              : '可以继续等待，或重新提交。'
          }
          action={
            claimWait.phase === 'TIMED_OUT' ? (
              <div className="semantic-claim-actions">
                <Button size="small" onClick={continueClaimCheck}>
                  继续等待
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    setClaimWait(null);
                    window.setTimeout(confirmDerive, 0);
                  }}
                >
                  重新提交
                </Button>
              </div>
            ) : undefined
          }
        />
      )}

      {semanticQuery.isError && (
        <Alert
          className="semantic-load-alert"
          type="error"
          showIcon
          message={semanticQuery.data ? '刷新失败，当前显示的是旧内容' : '没能读到语义层'}
          description={(semanticQuery.error as Error)?.message}
          action={
            semanticQuery.data !== undefined ? (
              <Button
                size="small"
                loading={semanticQuery.isFetching}
                onClick={() => void semanticQuery.refetch()}
              >
                重试语义层
              </Button>
            ) : undefined
          }
        />
      )}

      {semanticQuery.isLoading ? (
        <div className="semantic-loading" aria-label="正在读取语义层">
          <Spin size="large" />
        </div>
      ) : showInitialError ? (
        <div className="semantic-error-state" role="status">
          <b>读取失败</b>
          <span>这不代表还没生成，请先重试。</span>
          <Button
            type="primary"
            loading={semanticQuery.isFetching}
            onClick={() => void semanticQuery.refetch()}
          >
            重试语义层
          </Button>
        </div>
      ) : (
        <div className="semantic-workbench-grid">
          <SemanticScopeRail
            rows={rows}
            tier={tier}
            answeredTerms={answeredTerms}
            value={scope}
            onChange={setScope}
          />
          <SemanticRowList
            rows={filteredRows}
            title={activeMeta.label}
            subtitle={activeMeta.desc}
            tier={tier}
            tierText={tierText}
            answeredTerms={answeredTerms}
            selectedId={selectedId}
            onSelect={selectRow}
            onOpenInspector={() => setInspectorOpen(true)}
          />
          <div className="semantic-inspector-desktop">
            <SemanticInspector
              row={selected}
              tier={tier}
              answeredTerms={answeredTerms}
              connectionStatus={connector.semanticStatus}
              failedContext={failedContext}
              deletePending={deleteMutation.isPending}
              onDelete={confirmDelete}
            />
          </div>
        </div>
      )}

      <Drawer
        rootClassName="semantic-inspector-drawer"
        title="说明详情"
        width={420}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        destroyOnClose={false}
      >
        <SemanticInspector
          row={selected}
          tier={tier}
          answeredTerms={answeredTerms}
          connectionStatus={connector.semanticStatus}
          failedContext={failedContext}
          deletePending={deleteMutation.isPending}
          onDelete={confirmDelete}
        />
      </Drawer>
    </div>
  );
}
