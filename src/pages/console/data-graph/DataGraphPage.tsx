import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { dataGraphApi } from '@/features/data-graph/api';
import DataGraphCanvas from '@/features/data-graph/components/DataGraphCanvas';
import DataGraphSidePanel from '@/features/data-graph/components/DataGraphSidePanel';
import { domainOptions } from '@/features/data-graph/domains';
import type { FocusRequest } from '@/features/data-graph/flow';
import { tableTitle } from '@/features/data-graph/text';
import type { SemanticStatus } from '@/features/data-graph/types';
import './data-graph.css';

// 深色工作区：画布、搜索框、右侧面板里的 antd 组件都用暗色算法渲染，和画布同一套底色。
const DARK_THEME = {
  algorithm: theme.darkAlgorithm,
  token: { colorPrimary: '#22d3ee', colorBgContainer: '#0a1b2e' },
};

// 语义层还没给出关系时，画布位置显示的话（设计文档 §6.5）。
function emptyCanvasText(status: SemanticStatus): string {
  if (status === null) return '这个系统的表关系还没整理。在「数据连接」里生成语义层后会自动出现。';
  if (status === 'RUNNING') return '正在整理表关系，完成后刷新页面即可看到。';
  if (status === 'FAILED') return '表关系整理没有成功，可在「数据连接」查看原因。';
  return '暂未发现可以确认的表关系。';
}

export default function DataGraphPage() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [search, setSearch] = useState('');

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

  useEffect(() => {
    setSelected(null);
    setFocus(null);
    setSearch('');
  }, [currentId]);

  const onSelect = useCallback((name: string | null) => setSelected(name), []);
  const pick = useCallback((name: string) => {
    setSelected(name);
    setFocus((previous) => ({ name, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  const titles = useMemo(
    () => new Map((graph?.tables ?? []).map((table) => [table.name, tableTitle(table)])),
    [graph?.tables],
  );
  const titleOf = useCallback((name: string) => titles.get(name) ?? name, [titles]);

  const counts = useMemo(
    () => ({
      tables: graph?.tables.length ?? 0,
      confirmed: graph?.relations.filter((relation) => relation.tier === 'CONFIRMED').length ?? 0,
      inferred: graph?.relations.filter((relation) => relation.tier === 'INFERRED').length ?? 0,
      isolated: graph?.tables.filter((table) => !table.related).length ?? 0,
    }),
    [graph],
  );

  const searchOptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!graph || !keyword) return [];
    return graph.tables
      .filter(
        (table) =>
          table.name.toLowerCase().includes(keyword) ||
          (table.displayName ?? '').toLowerCase().includes(keyword) ||
          (table.comment ?? '').toLowerCase().includes(keyword),
      )
      .slice(0, 20)
      .map((table) => ({
        value: table.name,
        label: (
          <div className="dg-search-option">
            <strong>{tableTitle(table)}</strong>
            {table.displayName ? <span>{table.name}</span> : null}
          </div>
        ),
      }));
  }, [graph, search]);

  const semanticLink = currentId
    ? `/console/connectors/${currentId}/semantic`
    : '/console/connectors';

  return (
    <main className="data-graph-page" data-testid="data-graph-page">
      <header className="data-graph-header">
        <h2 className="data-graph-header__title">数据星图</h2>
        <p className="data-graph-header__lead">
          查看各业务系统里有哪些表、表与表之间怎样关联。关系来自数据连接的语义层，语义层更新后这里自动同步。
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
        <section className="data-graph-blank">
          <Empty
            description={
              <span>
                还没有可以展示的业务系统。<Link to="/console/connectors">去「数据连接」</Link>
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
              onChange={(value) => setParams({ system: String(value) })}
              options={systems.map((system) => ({
                value: system.connectorId,
                label: (
                  <span>
                    {system.displayName || system.name} · {system.tableCount} 张表
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
              message="这个系统的表关系没有加载出来"
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
                  <span>表</span>
                  <strong>{counts.tables}</strong>
                </div>
                <div>
                  <span>已确认关系</span>
                  <strong>{counts.confirmed}</strong>
                </div>
                <div>
                  <span>推断关系</span>
                  <strong>{counts.inferred}</strong>
                </div>
                <div>
                  <span>未发现关联的表</span>
                  <strong>{counts.isolated}</strong>
                </div>
              </section>
              {graph.semanticStatus === 'RUNNING' && graph.relations.length > 0 ? (
                <p className="data-graph-note">语义层正在更新，完成后刷新页面可看到最新关系</p>
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
                        placeholder="搜索表（中文名或表名）"
                        notFoundContent={search.trim() ? '没有匹配的表' : null}
                      />
                    </div>
                    {graph.relations.length > 0 ? (
                      <DataGraphCanvas
                        key={graph.connectorId}
                        graph={graph}
                        domains={domainOptions(graph.tables)}
                        selected={selected}
                        domainFilter={null}
                        focus={focus}
                        titleOf={titleOf}
                        onSelect={onSelect}
                      />
                    ) : (
                      <div className="data-graph-empty-canvas" data-testid="dg-empty">
                        <p>{emptyCanvasText(graph.semanticStatus)}</p>
                        {graph.semanticStatus !== 'READY' ? (
                          <Link to={semanticLink}>去「数据连接」</Link>
                        ) : null}
                      </div>
                    )}
                    <div className="data-graph-legend" aria-label="图例">
                      <span>
                        <i className="dg-swatch is-confirmed" aria-hidden />
                        已确认：数据核对通过或业务方确认
                      </span>
                      <span>
                        <i className="dg-swatch is-inferred" aria-hidden />
                        推断：按表结构，尚未核对
                      </span>
                    </div>
                  </div>
                  <DataGraphSidePanel
                    graph={graph}
                    selected={selected}
                    titleOf={titleOf}
                    onPick={pick}
                    onBack={() => setSelected(null)}
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
