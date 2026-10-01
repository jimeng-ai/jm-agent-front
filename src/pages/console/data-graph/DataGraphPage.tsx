import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  AutoComplete,
  Button,
  ConfigProvider,
  Empty,
  Segmented,
  Skeleton,
  Tag,
  theme,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/features/auth/api';
import { dataGraphApi } from '@/features/data-graph/api';
import DataGraphCanvas from '@/features/data-graph/components/DataGraphCanvas';
import DataGraphSidePanel, {
  type SidePanelTab,
} from '@/features/data-graph/components/DataGraphSidePanel';
import { domainOptions } from '@/features/data-graph/domains';
import type { FocusRequest } from '@/features/data-graph/flow';
import {
  NO_SYSTEMS_TEXT,
  domainLabel,
  emptyRelationsText,
  tableTitle,
} from '@/features/data-graph/text';
import type { SystemGraph } from '@/features/data-graph/types';
import { useAuthStore } from '@/stores/authStore';
import './data-graph.css';

// 深色工作区：画布、搜索框、右侧面板里的 antd 组件都用暗色算法渲染，和画布同一套底色。
const DARK_THEME = {
  algorithm: theme.darkAlgorithm,
  token: { colorPrimary: '#22d3ee', colorBgContainer: '#0a1b2e' },
};

/**
 * 「业务名称整理中」只在两种时候出现（设计文档 §6.3）：有对象还没拿到业务名，并且补全链正在跑、或这个连接还从没跑过。
 * 跑完了仍有对象没拿到业务名（校验两次不过、或者失败了），就安静地用兜底，不挂提示。
 */
const namingInProgress = (graph: SystemGraph): boolean =>
  graph.relations.length > 0 &&
  graph.tables.some((table) => table.nameSource !== 'BUSINESS_VIEW') &&
  (graph.viewStatus === 'RUNNING' || graph.viewStatus === null);

/** 按系统记下来的页面状态：切换系统后自然作废，不会有一瞬间把上一个系统的选中套到新系统上（v2 审查 #11）。 */
interface Scoped<T> {
  system: string | null;
  value: T;
}

export default function DataGraphPage() {
  const [params, setParams] = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const [selection, setSelection] = useState<Scoped<string | null>>({ system: null, value: null });
  const [focusState, setFocusState] = useState<Scoped<FocusRequest | null>>({ system: null, value: null });
  const [domainState, setDomainState] = useState<Scoped<string | null>>({ system: null, value: null });
  const [search, setSearch] = useState('');
  // 记住上次停留的页签：从对象详情返回时回到它，而不是总回到第一个（v2 审查 #9）。
  const [tab, setTab] = useState<SidePanelTab>('relations');

  // 与侧栏、ModuleRoute 共用同一份权限缓存。拿不到时按「不是超管」处理：管理页面的链接宁可不给。
  const { data: permission } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    enabled: !!token,
    staleTime: 60_000,
  });
  const isSuperAdmin = permission?.superAdmin === true;

  const systemsQuery = useQuery({
    queryKey: ['data-graph', 'systems'],
    queryFn: dataGraphApi.systems,
  });
  const systems = useMemo(() => systemsQuery.data ?? [], [systemsQuery.data]);
  const requested = params.get('system');
  const current = systems.find((system) => system.connectorId === requested) ?? systems[0] ?? null;
  const currentId = current?.connectorId ?? null;

  const graphQuery = useQuery({
    queryKey: ['data-graph', 'system', currentId],
    queryFn: () => dataGraphApi.system(currentId ?? ''),
    enabled: currentId !== null,
  });
  const graph = graphQuery.data;

  const selected = selection.system === currentId ? selection.value : null;
  const focus = focusState.system === currentId ? focusState.value : null;
  const domainFilter = domainState.system === currentId ? domainState.value : null;

  const onSelect = useCallback(
    (name: string | null) => setSelection({ system: currentId, value: name }),
    [currentId],
  );
  const pick = useCallback(
    (name: string) => {
      setSelection({ system: currentId, value: name });
      setFocusState((previous) => ({
        system: currentId,
        value: { name, seq: (previous.value?.seq ?? 0) + 1 },
      }));
    },
    [currentId],
  );

  const titles = useMemo(
    () => new Map((graph?.tables ?? []).map((table) => [table.name, tableTitle(table)])),
    [graph?.tables],
  );
  const titleOf = useCallback((name: string) => titles.get(name) ?? name, [titles]);
  const domains = useMemo(() => domainOptions(graph?.tables ?? []), [graph?.tables]);

  const counts = useMemo(
    () => ({
      objects: graph?.tables.length ?? 0,
      confirmed: graph?.relations.filter((relation) => relation.tier === 'CONFIRMED').length ?? 0,
      inferred: graph?.relations.filter((relation) => relation.tier === 'INFERRED').length ?? 0,
      isolated: graph?.tables.filter((table) => !table.related).length ?? 0,
    }),
    [graph],
  );

  // 按业务名、说明找，也认表名（懂技术的人会直接敲表名）；下拉里只显示业务名和领域。
  const searchOptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!graph || !keyword) return [];
    return graph.tables
      .filter(
        (table) =>
          tableTitle(table).toLowerCase().includes(keyword) ||
          (table.summary ?? '').toLowerCase().includes(keyword) ||
          table.name.toLowerCase().includes(keyword),
      )
      .slice(0, 20)
      .map((table) => ({
        value: table.name,
        label: (
          <div className="dg-search-option">
            <strong>{tableTitle(table)}</strong>
            <span>{domainLabel(table.domain)}</span>
          </div>
        ),
      }));
  }, [graph, search]);

  const semanticLink = currentId
    ? `/console/connectors/${currentId}/semantic`
    : '/console/connectors';
  const emptyText = emptyRelationsText(graph?.semanticStatus ?? null);

  return (
    <main className="data-graph-page" data-testid="data-graph-page">
      <header className="data-graph-header">
        <h2 className="data-graph-header__title">数据星图</h2>
        <p className="data-graph-header__lead">
          看看业务系统里有哪些业务对象、它们之间怎样关联。内容由平台根据接入的系统自动整理，并随系统更新自动同步。
        </p>
      </header>

      {systemsQuery.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : systemsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="业务系统列表没有加载出来"
          description={systemsQuery.error instanceof Error ? systemsQuery.error.message : undefined}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => void systemsQuery.refetch()}>
              重试
            </Button>
          }
        />
      ) : !current ? (
        <section className="data-graph-blank" data-testid="dg-no-systems">
          <Empty
            description={
              <span>
                {NO_SYSTEMS_TEXT}
                {isSuperAdmin ? <Link to="/console/connectors">去「数据连接」</Link> : null}
              </span>
            }
          />
        </section>
      ) : (
        <>
          {systems.length > 1 ? (
            <Segmented
              className="data-graph-systems"
              value={current.connectorId}
              onChange={(value) => {
                setSearch('');
                setParams({ system: String(value) });
              }}
              options={systems.map((system) => ({
                value: system.connectorId,
                label: (
                  <span>
                    {system.displayName || system.name} · {system.tableCount} 个对象
                    {system.status === 'DISABLED' ? (
                      <Tag className="data-graph-systems__tag">已停用</Tag>
                    ) : null}
                  </span>
                ),
              }))}
            />
          ) : null}

          {graphQuery.isPending ? (
            <Skeleton active paragraph={{ rows: 10 }} />
          ) : graphQuery.isError || !graph ? (
            <Alert
              type="error"
              showIcon
              message="这个系统的关联没有加载出来"
              description={graphQuery.error instanceof Error ? graphQuery.error.message : undefined}
              action={
                <Button icon={<ReloadOutlined />} onClick={() => void graphQuery.refetch()}>
                  重试
                </Button>
              }
            />
          ) : (
            <>
              <section className="data-graph-summary" aria-label="概览">
                <div>
                  <span>对象</span>
                  <strong>{counts.objects}</strong>
                </div>
                <div>
                  <span>已核对的关联</span>
                  <strong>{counts.confirmed}</strong>
                </div>
                <div>
                  <span>待核对的关联</span>
                  <strong>{counts.inferred}</strong>
                </div>
                <div>
                  <span>暂未发现关联的对象</span>
                  <strong>{counts.isolated}</strong>
                </div>
              </section>
              {namingInProgress(graph) || graph.truncated ? (
                <div className="data-graph-notes">
                  {namingInProgress(graph) ? (
                    <p className="data-graph-note" data-testid="dg-hint-naming">
                      业务名称整理中。
                    </p>
                  ) : null}
                  {graph.truncated ? (
                    <p className="data-graph-note" data-testid="dg-hint-truncated">
                      这个系统表很多，只整理了按重要性排前 200 个对象。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {graph.relations.length > 0 && domains.length > 1 ? (
                <div className="data-graph-domains" role="group" aria-label="按领域查看" data-testid="dg-domains">
                  <button
                    type="button"
                    className={domainFilter === null ? 'is-active' : undefined}
                    aria-pressed={domainFilter === null}
                    onClick={() => setDomainState({ system: currentId, value: null })}
                  >
                    全部
                  </button>
                  {domains.map((domain) => (
                    <button
                      key={domain.label}
                      type="button"
                      className={domainFilter === domain.label ? 'is-active' : undefined}
                      aria-pressed={domainFilter === domain.label}
                      onClick={() => setDomainState({ system: currentId, value: domain.label })}
                    >
                      <i style={{ background: domain.color }} aria-hidden />
                      {domain.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <ConfigProvider theme={DARK_THEME}>
                <section className="data-graph-workspace">
                  <div className="data-graph-main">
                    <div className="data-graph-toolbar">
                      <AutoComplete
                        className="data-graph-search"
                        value={search}
                        options={searchOptions}
                        onSearch={setSearch}
                        onChange={setSearch}
                        onSelect={(value) => {
                          setSearch('');
                          pick(String(value));
                        }}
                        placeholder="搜索对象（业务名或表名）"
                        notFoundContent={search.trim() ? '没有匹配的对象' : null}
                      />
                    </div>
                    {graph.relations.length > 0 ? (
                      <DataGraphCanvas
                        key={graph.connectorId}
                        graph={graph}
                        domains={domains}
                        selected={selected}
                        domainFilter={domainFilter}
                        focus={focus}
                        titleOf={titleOf}
                        onSelect={onSelect}
                      />
                    ) : (
                      <div className="data-graph-empty-canvas" data-testid="dg-empty">
                        <p>{emptyText}</p>
                        {isSuperAdmin && graph.semanticStatus !== 'READY' ? (
                          <Link to={semanticLink}>去「数据连接」</Link>
                        ) : null}
                      </div>
                    )}
                    <div className="data-graph-legend" aria-label="图例">
                      <span>
                        <i className="dg-swatch is-confirmed" aria-hidden />
                        已核对：数据核对通过或业务方确认
                      </span>
                      <span>
                        <i className="dg-swatch is-inferred" aria-hidden />
                        待核对：按表结构推断，尚未核对
                      </span>
                    </div>
                  </div>
                  <DataGraphSidePanel
                    graph={graph}
                    domains={domains}
                    selected={selected}
                    tab={tab}
                    emptyText={emptyText}
                    titleOf={titleOf}
                    onTabChange={setTab}
                    onPick={pick}
                    onBack={() => onSelect(null)}
                  />
                </section>
              </ConfigProvider>
            </>
          )}
        </>
      )}
    </main>
  );
}
