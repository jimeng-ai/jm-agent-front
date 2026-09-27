import { Alert, Button, Result, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { BizError, RESP_CODE, isCode } from '@/api/types';
import { connectorApi } from '@/features/connector/api';
import ConnectorSemanticContent from '@/features/connector/components/semantic/ConnectorSemanticContent';

function isConnectorNotFound(error: unknown): boolean {
  // data-service 的业务异常是 HTTP 200 非成功信封；client.ts 会把 respCode 原样保存在 BizError.code。
  return error instanceof BizError && isCode(error.code, RESP_CODE.NOT_FOUND);
}

export default function SemanticWorkbenchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const connectorQuery = useQuery({
    queryKey: ['connector', 'detail', id],
    queryFn: () => connectorApi.get(id!),
    enabled: Boolean(id),
    // 连接级状态是异步任务的唯一进度源。只有 RUNNING 每 5 秒刷新，其它状态完全停轮询。
    refetchInterval: (query) => (query.state.data?.semanticStatus === 'RUNNING' ? 5_000 : false),
  });

  if (!id) {
    return (
      <Result
        status="404"
        title="缺少连接 id"
        subTitle="请从数据连接列表重新进入语义层。"
        extra={<Button onClick={() => navigate('/console/connectors')}>返回数据连接</Button>}
      />
    );
  }

  if (connectorQuery.isLoading) {
    return (
      <div className="semantic-page-loading" aria-label="正在读取连接详情">
        <Spin size="large" />
      </div>
    );
  }

  if (connectorQuery.isError && isConnectorNotFound(connectorQuery.error)) {
    return (
      <Result
        status="404"
        title="连接不存在或已删除"
        subTitle={connectorQuery.error.message}
        extra={<Button onClick={() => navigate('/console/connectors')}>返回数据连接</Button>}
      />
    );
  }

  if (connectorQuery.isError && !connectorQuery.data) {
    return (
      <Result
        status="error"
        title="没能读取连接详情"
        subTitle={(connectorQuery.error as Error)?.message}
        extra={[
          <Button key="back" onClick={() => navigate('/console/connectors')}>
            返回数据连接
          </Button>,
          <Button
            key="retry"
            type="primary"
            loading={connectorQuery.isFetching}
            onClick={() => void connectorQuery.refetch()}
          >
            重试连接详情
          </Button>,
        ]}
      />
    );
  }

  if (!connectorQuery.data) {
    return (
      <Result
        status="404"
        title="连接不存在或已删除"
        subTitle="它可能已经被删除。"
        extra={<Button onClick={() => navigate('/console/connectors')}>返回数据连接</Button>}
      />
    );
  }

  return (
    <div className="semantic-page-shell">
      {connectorQuery.isError && (
        <Alert
          className="semantic-detail-refresh-error"
          type="error"
          showIcon
          message="连接详情刷新失败，继续显示上一次成功内容"
          description={(connectorQuery.error as Error)?.message}
          action={
            <Button
              size="small"
              loading={connectorQuery.isFetching}
              onClick={() => void connectorQuery.refetch()}
            >
              重试连接详情
            </Button>
          }
        />
      )}
      <ConnectorSemanticContent
        connector={connectorQuery.data}
        onBack={() => navigate('/console/connectors')}
      />
    </div>
  );
}
