import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Result, Skeleton, Space, Tabs, Typography } from 'antd';
import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { connectorApi } from '../api';
import type { ConnectorView } from '../types';
import { SemanticStatusTags } from '../presentation';
import { ConnectorAuditPanel } from './ConnectorAuditDrawer';
import { ConnectorSchemaPanel } from './ConnectorSchemaDrawer';
import ConnectorOverviewPanel from './ConnectorOverviewPanel';

type InspectorTab = 'overview' | 'schema' | 'semantic' | 'audit';

const VALID_TABS = new Set<InspectorTab>(['overview', 'schema', 'semantic', 'audit']);

function tabOf(value: string | null): InspectorTab {
  return value && VALID_TABS.has(value as InspectorTab) ? (value as InspectorTab) : 'overview';
}

function SemanticSummary({ connector }: { connector: ConnectorView }) {
  return (
    <div data-testid="connector-semantic-summary" className="connector-semantic-summary">
      <Alert
        type={connector.semanticStatus === 'FAILED' ? 'warning' : 'info'}
        showIcon
        message="这里只显示概况"
        description="完整说明在语义层页面查看。"
      />
      <div className="connector-semantic-summary__state">
        <Typography.Text type="secondary">当前状态</Typography.Text>
        <SemanticStatusTags connector={connector} />
        {connector.semanticNote ? (
          <Typography.Paragraph>{connector.semanticNote}</Typography.Paragraph>
        ) : null}
      </div>
      <Link
        className="connector-semantic-summary__link"
        to={`/console/connectors/${connector.id}/semantic`}
      >
        <ArrowRightOutlined aria-hidden />
        <span>打开语义层页面</span>
      </Link>
    </div>
  );
}

export default function ConnectorInspector() {
  const [searchParams, setSearchParams] = useSearchParams();
  // action=edit 由列表页消费；同一个 connector 参数此时不能再同时打开 Inspector。
  const connectorId = searchParams.get('action') === 'edit' ? null : searchParams.get('connector');
  const requestedTab = tabOf(searchParams.get('tab'));

  const detailQuery = useQuery({
    queryKey: ['connector', 'detail', connectorId],
    queryFn: () => connectorApi.get(connectorId!),
    enabled: !!connectorId,
    refetchOnMount: 'always',
    refetchInterval: (query) => (query.state.data?.semanticStatus === 'RUNNING' ? 5_000 : false),
  });

  const connector = detailQuery.data;
  const hasCachedDetail = connector !== undefined;
  const initialError = detailQuery.isError && !hasCachedDetail;
  const backgroundError = detailQuery.isError && hasCachedDetail;
  const supportsSchema = connector?.capabilities?.includes('DESCRIBE') === true;
  const activeTab =
    requestedTab === 'schema' && connector && !supportsSchema ? 'overview' : requestedTab;

  const replaceParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (requestedTab !== 'schema' || !connector || supportsSchema) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'overview');
    setSearchParams(next, { replace: true });
  }, [connector, requestedTab, searchParams, setSearchParams, supportsSchema]);

  const close = () =>
    replaceParams((next) => {
      next.delete('connector');
      next.delete('tab');
    });

  const setTab = (tab: string) =>
    replaceParams((next) => {
      next.set('tab', tab);
    });

  const tabItems = connector
    ? [
        {
          key: 'overview',
          label: <span data-testid="connector-inspector-tab-overview">概览</span>,
          children:
            activeTab === 'overview' ? <ConnectorOverviewPanel connector={connector} /> : null,
        },
        ...(supportsSchema
          ? [
              {
                key: 'schema',
                label: <span data-testid="connector-inspector-tab-schema">结构</span>,
                // Schema 刷新返回的 diffs 只存在于这一次响应里。进入过结构页后保持 Panel
                // 挂载，刷新途中切去概览也不会把结果 state 一并销毁；换连接时 key 会重置，
                // 关闭 Inspector 则由 Drawer.destroyOnClose 统一清空。
                children: <ConnectorSchemaPanel key={connector.id} connector={connector} />,
              },
            ]
          : []),
        {
          key: 'semantic',
          label: <span data-testid="connector-inspector-tab-semantic">语义层</span>,
          children: activeTab === 'semantic' ? <SemanticSummary connector={connector} /> : null,
        },
        {
          key: 'audit',
          label: <span data-testid="connector-inspector-tab-audit">使用记录</span>,
          children: activeTab === 'audit' ? <ConnectorAuditPanel connector={connector} /> : null,
        },
      ]
    : [];

  return (
    <Drawer
      data-testid="connector-inspector"
      className="connector-inspector"
      rootClassName="connector-inspector-root"
      title={connector ? connector.displayName || connector.name : '连接详情'}
      open={!!connectorId}
      onClose={close}
      width={960}
      destroyOnClose
      closeIcon={
        <span data-testid="connector-inspector-close">
          <CloseOutlined />
        </span>
      }
    >
      {detailQuery.isLoading && !hasCachedDetail ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : initialError ? (
        <Result
          status="error"
          title="连接详情加载失败"
          subTitle={(detailQuery.error as Error).message}
          extra={
            <Space>
              <Button onClick={close}>关闭</Button>
              <Button type="primary" onClick={() => detailQuery.refetch()}>
                重试
              </Button>
            </Space>
          }
        />
      ) : connector ? (
        <>
          {backgroundError ? (
            <Alert
              data-testid="connector-inspector-background-error"
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="连接详情刷新失败，下面保留的是上一次结果"
              description={(detailQuery.error as Error).message}
              action={
                <Button
                  size="small"
                  loading={detailQuery.isFetching}
                  onClick={() => void detailQuery.refetch()}
                >
                  重试
                </Button>
              }
            />
          ) : null}
          <Tabs activeKey={activeTab} onChange={setTab} items={tabItems} />
        </>
      ) : null}
    </Drawer>
  );
}
