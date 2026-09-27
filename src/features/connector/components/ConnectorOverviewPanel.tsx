import { Alert, Descriptions, Space, Tag, Typography } from 'antd';
import type { ConnectorView } from '../types';
import {
  CapabilityTags,
  HealthBadge,
  connectorAttentionIssues,
} from '../presentation';
import ConnectorSecurityProfile from './ConnectorSecurityProfile';

interface Props {
  connector: ConnectorView;
}

const formatDateTime = (value?: string | null) =>
  value ? value.replace('T', ' ').slice(0, 19) : '—';

export default function ConnectorOverviewPanel({ connector }: Props) {
  const issues = connectorAttentionIssues(connector);
  const params = Object.entries(connector.params ?? {});

  return (
    <div data-testid="connector-overview-panel" className="connector-overview-panel">
      {issues.length ? (
        <section className="connector-overview-panel__issues" aria-label="需要处理的问题">
          {issues.map((issue) => (
            <Alert
              key={issue.key}
              type="warning"
              showIcon
              message={issue.title}
              description={
                <>
                  <div>后果：{issue.consequence}</div>
                  <div>下一步：{issue.nextStep}</div>
                </>
              }
            />
          ))}
        </section>
      ) : (
        <Alert type="success" showIcon message="当前没有待处理异常" />
      )}

      <section className="connector-overview-panel__section">
        <Typography.Title level={5}>安全轮廓</Typography.Title>
        <ConnectorSecurityProfile connector={connector} />
      </section>

      <section className="connector-overview-panel__section">
        <Typography.Title level={5}>连接概览</Typography.Title>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="标识">{connector.name}</Descriptions.Item>
          <Descriptions.Item label="类型">
            <Tag>{connector.kindLabel || connector.kind}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="运行状态">
            <Space>
              {connector.status === 'ACTIVE' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
              <HealthBadge connector={connector} />
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="可用能力">
            <CapabilityTags capabilities={connector.capabilities} />
          </Descriptions.Item>
          <Descriptions.Item label="最近健康检查">
            {formatDateTime(connector.healthCheckedAt)}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDateTime(connector.createTime)}</Descriptions.Item>
        </Descriptions>
      </section>

      <section className="connector-overview-panel__section">
        <Typography.Title level={5}>非敏感连接参数</Typography.Title>
        {params.length ? (
          <dl className="connector-parameter-list">
            {params.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Typography.Text type="secondary">这类连接没有可展示的非敏感参数。</Typography.Text>
        )}
      </section>
    </div>
  );
}
