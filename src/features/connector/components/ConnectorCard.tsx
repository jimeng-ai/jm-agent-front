import { Button, Dropdown, Space, Spin, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  EllipsisOutlined,
  ExperimentOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ConnectorView } from '../types';
import { CapabilityTags, HealthBadge, connectorAttentionIssues } from '../presentation';
import ConnectorSecurityProfile from './ConnectorSecurityProfile';

interface Props {
  connector: ConnectorView;
  /** 这类连接能自描述（有表结构），才有数据星图：卡片上带「查看星图」。 */
  graphable?: boolean;
  busy?: boolean;
  onOpen: (connector: ConnectorView) => void;
  onTest: (connector: ConnectorView) => void;
  onEdit: (connector: ConnectorView) => void;
  onToggle: (connector: ConnectorView) => void;
  onDelete: (connector: ConnectorView) => void;
}

const TEST_RISK_KEYS = new Set([
  'unhealthy',
  'unknown-health',
  'readonly',
  'write-account-mismatch',
]);
const SEMANTIC_RISK_KEYS = new Set(['semantic-failed', 'semantic-partial']);

function riskPriority(key: string): number {
  if (TEST_RISK_KEYS.has(key)) return 3;
  if (SEMANTIC_RISK_KEYS.has(key)) return 2;
  return 1;
}

export default function ConnectorCard({
  connector,
  graphable = false,
  busy = false,
  onOpen,
  onTest,
  onEdit,
  onToggle,
  onDelete,
}: Props) {
  const issues = connectorAttentionIssues(connector);
  const primaryIssue = [...issues].sort(
    (left, right) => riskPriority(right.key) - riskPriority(left.key),
  )[0];
  const requiresTest = issues.some((issue) => TEST_RISK_KEYS.has(issue.key));
  const hasSemanticGap = issues.some((issue) => SEMANTIC_RISK_KEYS.has(issue.key));
  const titleId = `connector-card-title-${connector.id}`;
  const menuItems: MenuProps['items'] = [
    { key: 'test', icon: <ExperimentOutlined />, label: '测试连接' },
    { key: 'edit', icon: <SettingOutlined />, label: '编辑' },
    {
      key: 'toggle',
      icon: connector.status === 'ACTIVE' ? <PauseCircleOutlined /> : <PlayCircleOutlined />,
      label: connector.status === 'ACTIVE' ? '停用' : '启用',
    },
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
  ];

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'test') onTest(connector);
    else if (key === 'edit') onEdit(connector);
    else if (key === 'toggle') onToggle(connector);
    else if (key === 'delete') onDelete(connector);
  };

  return (
    <article
      className={`connector-card${issues.length ? ' has-attention' : ''}${busy ? ' is-busy' : ''}`}
      data-testid="connector-card"
      data-connector-id={connector.id}
      data-connector-name={connector.name}
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <header className="connector-card__header">
        <div className="connector-card__identity">
          <span className="connector-card__kind-icon" aria-hidden>
            <ApiOutlined />
          </span>
          <div className="connector-card__names">
            <Space size={8} wrap>
              <Typography.Title level={5} id={titleId} ellipsis={{ tooltip: true }}>
                {connector.displayName || connector.name}
              </Typography.Title>
              {connector.status === 'ACTIVE' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
            </Space>
            <Typography.Text type="secondary" ellipsis={{ tooltip: connector.name }}>
              {connector.name}
            </Typography.Text>
          </div>
        </div>
        <div className="connector-card__health">
          <HealthBadge connector={connector} />
        </div>
      </header>

      <div className="connector-card__meta">
        <Tag className="connector-card__kind" title={connector.kindLabel || connector.kind}>
          {connector.kindLabel || connector.kind}
        </Tag>
        <CapabilityTags capabilities={connector.capabilities} />
      </div>

      <ConnectorSecurityProfile connector={connector} compact />

      {primaryIssue ? (
        <div className="connector-card__issues" aria-label="需要处理的问题">
          <div key={primaryIssue.key} className="connector-card__issue">
            <strong>{primaryIssue.title}</strong>
            <span>后果：{primaryIssue.consequence}</span>
            <span>下一步：{primaryIssue.nextStep}</span>
          </div>
          {issues.length > 1 ? (
            <span className="connector-card__issue-more">
              另有 {issues.length - 1} 项需处理，详见连接详情
            </span>
          ) : null}
        </div>
      ) : (
        <div className="connector-card__all-clear">当前没有待处理异常</div>
      )}

      <footer className="connector-card__footer">
        {graphable ? (
          <Link
            data-testid="connector-card-graph"
            className={`connector-card__link${busy ? ' is-disabled' : ''}`}
            to={`/console/connectors/${connector.id}/graph`}
            aria-disabled={busy}
            tabIndex={busy ? -1 : undefined}
            onClick={busy ? (event) => event.preventDefault() : undefined}
          >
            查看星图
          </Link>
        ) : null}
        {requiresTest ? (
          <Button
            data-testid="connector-card-primary-action"
            type="primary"
            onClick={() => onTest(connector)}
            disabled={busy}
          >
            重新测试
          </Button>
        ) : hasSemanticGap ? (
          <Link
            data-testid="connector-card-primary-action"
            className={`connector-card__primary-link${busy ? ' is-disabled' : ''}`}
            to={`/console/connectors/${connector.id}/semantic`}
            aria-disabled={busy}
            tabIndex={busy ? -1 : undefined}
            onClick={busy ? (event) => event.preventDefault() : undefined}
          >
            查看缺口
          </Link>
        ) : (
          <Button
            data-testid="connector-card-primary-action"
            type="primary"
            onClick={() => onOpen(connector)}
            disabled={busy}
          >
            打开连接
          </Button>
        )}
        <Dropdown
          trigger={['click']}
          menu={{ items: menuItems, onClick: onMenuClick }}
          disabled={busy}
        >
          <Button
            data-testid="connector-card-more"
            icon={busy ? <Spin size="small" /> : <EllipsisOutlined />}
            aria-label={`更多操作：${connector.displayName || connector.name}`}
          >
            更多
          </Button>
        </Dropdown>
      </footer>
    </article>
  );
}
