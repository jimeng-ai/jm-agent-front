import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Spin, Tag, Typography } from 'antd';
import { connectorApi } from '@/features/connector/api';
import {
  SCOPE_ORDER,
  answeredSemanticTerms,
  groupByScope,
  isHuman,
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

export default function ConnectorSemanticContent({ connector, onBack }: Props) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<SemanticScopeFilter>('ATTENTION');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [claimWait, setClaimWait] = useState<DeriveClaimWait | null>(null);
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

  const refresh = useCallback(
    (connectorId: string) => {
      void queryClient.invalidateQueries({ queryKey: ['connector', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['connector', 'detail', connectorId] });
      void queryClient.invalidateQueries({ queryKey: ['connector', 'semantic', connectorId] });
    },
    [queryClient],
  );

  const deriveMutation = useMutation({
    mutationFn: ({ connectorId }: DeriveRequest) => connectorApi.deriveSemantic(connectorId),
    onSuccess: (_result, request) => {
      message.info('已提交。推导在后台异步跑，这次点击只是把任务派发出去——进度看上方的状态。');
      setClaimWait({
        baseline: request.baseline,
        phase: 'WATCHING',
        deadline: Date.now() + CLAIM_WAIT_TIMEOUT_MS,
      });
      refresh(request.connectorId);
    },
    onError: (error: Error) => message.error(error.message),
  });

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
    refresh(connector.id);
  }, [
    claimWait,
    connector.id,
    connector.semanticClaimAt,
    connector.semanticStatus,
    connector.semanticSyncedAt,
    refresh,
  ]);

  useEffect(() => {
    setClaimWait(null);
  }, [connector.id]);

  const continueClaimCheck = () => {
    setClaimWait((current) =>
      current
        ? {
            ...current,
            phase: 'WATCHING',
            deadline: Date.now() + CLAIM_WAIT_TIMEOUT_MS,
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
          <p>
            <b>只覆盖机器推断的行。</b>人在对话里答过的口径（
            <Tag color="purple">人工确认</Tag>）与直接采信客户库注释的（
            <Tag color="blue">库注释</Tag>）<b>一行不动</b>。后端删除时明确带着
            <Typography.Text code>source = &apos;INFERRED&apos;</Typography.Text> 条件。
          </p>
          <p>
            <b>代价看结构快照在不在。</b>已有快照时，只读平台自己的库 +
            一次模型调用，对客户系统零访问； 快照为空时，会先访问客户库补拉一次结构：1 次目录查询 +
            最多 200 次表结构查询。
          </p>
          <p>
            <b>这是异步派发。</b>
            点击后立即返回，推导在后台运行，首次通常几十秒起步；返回不代表已经生成完成。
          </p>
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
        message.success('已删除。这一行是物理删除，不可恢复。');
      } else {
        message.info('这一行已经不在了（可能刚被别人删掉），本次没有删除任何内容。');
      }
      setInspectorOpen(false);
      refresh(variables.connectorId);
    },
    onError: (error: Error) => message.error(error.message),
  });

  const confirmDelete = (row: ConnectorSemanticRow) => {
    const connectorId = connector.id;
    const rowId = row.id;
    const human = isHuman(row);
    modal.confirm({
      title: `删除这一行语义「${rowAnchor(row)}」？`,
      width: 580,
      content: (
        <div className="semantic-confirm-copy">
          <p>
            <b>物理删除，不可恢复。</b>
            这不是停用或软删；库里这一行会被真正删除，没有回收站，也不能撤销。
          </p>
          <p>
            <b>机器推断的行（</b>
            <Tag>机器推断</Tag>
            <b>）删掉后，下次重新生成会再推一遍。</b>
            这里只清掉当前这一份；要它不再出现，需要处理让它被推出来的结构注释或口径。
          </p>
          <p>
            <b>人工确认的行（</b>
            <Tag color="purple">人工确认</Tag>
            <b>）删掉后，连同覆盖历史一起消失。</b>届时再也查不到这条口径被谁、在哪次对话里改过。
            {human && <b>——你正要删除的就是这样一行。</b>}
          </p>
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
        desc: '由当前状态、验证结论、关系形态和档位纯前端派生；不会写回或改变原始 scope。',
      };
    }
    if (scope === 'UNKNOWN') {
      const unknown = groups.find((group) => !SCOPE_ORDER.includes(group.scope as SemanticScope));
      return {
        label: '未知分类',
        desc: unknown?.meta.desc ?? '后端新增或异常的 scope 会完整保留在这里。',
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

      {claimWait && (
        <Alert
          className="semantic-load-alert"
          data-testid="semantic-derive-claim-wait"
          type={claimWait.phase === 'WATCHING' ? 'info' : 'warning'}
          showIcon
          message={
            claimWait.phase === 'WATCHING'
              ? '已提交，正在等待后台认领'
              : '已提交，但暂未观察到后台认领'
          }
          description={
            claimWait.phase === 'WATCHING'
              ? '队列等待期间，连接详情可能仍显示上一次的 READY / FAILED；观察到本次 RUNNING、新成功时间或新终态后会自动结束等待。'
              : '没有再次派发任务，以免产生重复作业。可以继续检查同一次任务的状态。'
          }
          action={
            claimWait.phase === 'TIMED_OUT' ? (
              <Button size="small" onClick={continueClaimCheck}>
                继续检查
              </Button>
            ) : undefined
          }
        />
      )}

      {semanticQuery.isError && (
        <Alert
          className="semantic-load-alert"
          type="error"
          showIcon
          message={semanticQuery.data ? '刷新失败，继续显示上一次成功内容' : '没能读到语义层'}
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
          <b>这不是“还没有生成”</b>
          <span>请求失败与空说明书是两种状态。请先恢复接口读取，再判断是否需要重新生成。</span>
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
        title="语义详情"
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
