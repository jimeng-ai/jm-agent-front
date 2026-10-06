import { Button, Tag, Tooltip } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  formatTime,
  semanticStatusMeta,
  semanticTierVisibility,
} from '@/features/connector/semantic';
import type { ConnectorView } from '@/features/connector/types';

interface Props {
  connector: ConnectorView;
  rowCount: number;
  derivePending: boolean;
  deriveBlocked: boolean;
  onDerive: () => void;
  onBack?: () => void;
}

export default function SemanticHeader({
  connector,
  rowCount,
  derivePending,
  deriveBlocked,
  onDerive,
  onBack,
}: Props) {
  const status = connector.semanticStatus;
  const statusMeta = semanticStatusMeta(status, {
    previousSuccessKnown: Boolean(connector.semanticSyncedAt),
    storedRowsPresent: rowCount > 0,
  });
  const running = status === 'RUNNING';
  const deriveDisabled = deriveBlocked || running || status === 'NOT_APPLICABLE';
  const tier = semanticTierVisibility(connector.semanticDataTier);
  const tierText = connector.semanticDataTierLabel || connector.semanticDataTier || '未知档位';

  return (
    <header className="semantic-header">
      <div className="semantic-header-topline">
        <div className="semantic-title-wrap">
          {onBack && (
            <Button
              type="text"
              className="semantic-back"
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              aria-label="返回数据连接列表"
            />
          )}
          <div>
            <div className="semantic-eyebrow">SEMANTIC CONTROL ROOM</div>
            <h1>{connector.displayName || connector.name}</h1>
            <div className="semantic-connector-meta">
              <code>{connector.name}</code>
              <span>{connector.kindLabel || connector.kind}</span>
              <span>{rowCount} 条说明</span>
            </div>
          </div>
        </div>
        <Tooltip
          title={
            status === 'NOT_APPLICABLE'
              ? '这类连接不适用语义层。'
              : running
                ? '正在生成，请稍候。'
                : deriveBlocked
                  ? '已提交，正在排队，请稍候。'
                  : undefined
          }
        >
          <span>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={derivePending}
              disabled={deriveDisabled}
              onClick={onDerive}
            >
              {status === 'NONE' ? '开始生成' : '重新生成'}
            </Button>
          </span>
        </Tooltip>
      </div>

      <div className="semantic-header-bands">
        <section
          className={`semantic-status semantic-status-${statusMeta.alert}`}
          data-testid="semantic-status"
          aria-live="polite"
          aria-label={`语义层状态：${statusMeta.label}`}
        >
          <div className="semantic-band-label">生成状态</div>
          <div className="semantic-band-title">
            <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
            {status === 'READY' && rowCount > 0 && <span>AI 可读 {rowCount} 条</span>}
          </div>
          <p>{statusMeta.hint}</p>
          {running && connector.semanticClaimAt && (
            <p>本次开始于：{formatTime(connector.semanticClaimAt)}</p>
          )}
          {connector.semanticSyncedAt && (
            <p>最近一次成功生成：{formatTime(connector.semanticSyncedAt)}</p>
          )}
          {connector.semanticNote && (
            <p className="semantic-note">最新说明：{connector.semanticNote}</p>
          )}
        </section>

        <section className="semantic-tier" data-testid="semantic-tier" aria-label="数据出库档位">
          <div className="semantic-band-label">数据出库档位</div>
          <div className="semantic-band-title">{tierText}</div>
          <dl>
            <div>
              <dt>AI 能看到</dt>
              <dd>{tier.modelVisible}</dd>
            </div>
            <div>
              <dt>AI 看不到</dt>
              <dd>{tier.retainedHidden}</dd>
            </div>
          </dl>
          <p>{connector.semanticDataTierEgress || tier.hint}</p>
          <Link
            className="semantic-tier-edit"
            to={`/console/connectors?connector=${encodeURIComponent(connector.id)}&action=edit&section=semantic`}
          >
            修改档位
          </Link>
        </section>
      </div>
    </header>
  );
}
