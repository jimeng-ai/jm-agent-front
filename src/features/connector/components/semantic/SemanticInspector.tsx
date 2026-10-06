import { Button, Divider, Tag, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined,
  InfoCircleOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  confidenceOf,
  detailEntries,
  evidenceMeta,
  formatTime,
  historyEntries,
  isHuman,
  joinTarget,
  rowAnchor,
  rowStatusMeta,
  scopeMeta,
  semanticModelVisibility,
  sourceMeta,
  type SemanticFailedContext,
  verifiedMeta,
} from '@/features/connector/semantic';
import type { ConnectorSemanticRow } from '@/features/connector/types';
import { SemanticTag } from './SemanticSignals';

interface Props {
  row: ConnectorSemanticRow | null;
  tier: string | null | undefined;
  answeredTerms: ReadonlySet<string>;
  connectionStatus?: string | null;
  failedContext: SemanticFailedContext;
  deletePending: boolean;
  onDelete: (row: ConnectorSemanticRow) => void;
}

function FactList({
  facts,
  empty,
}: {
  facts: Array<{ key: string; label: string; value: string }>;
  empty: string;
}) {
  if (facts.length === 0) return <p className="semantic-inspector-empty">{empty}</p>;
  return (
    <dl className="semantic-fact-list">
      {facts.map((fact) => (
        <div key={fact.key}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function SemanticInspector({
  row,
  tier,
  answeredTerms,
  connectionStatus,
  failedContext,
  deletePending,
  onDelete,
}: Props) {
  const visibility = row
    ? semanticModelVisibility(row, tier, connectionStatus, failedContext, answeredTerms)
    : null;
  const details = row ? detailEntries(row, tier) : [];
  const history = row ? historyEntries(row) : [];
  const confidence = row ? confidenceOf(row) : null;
  const target = row?.scope === 'JOIN' ? joinTarget(row) : null;

  return (
    <aside
      className="semantic-inspector"
      data-testid="semantic-inspector"
      aria-label="说明详情"
    >
      <div className="semantic-inspector-head">
        <div className="semantic-eyebrow">LIVE CONTEXT INSPECTOR</div>
        {row ? (
          <>
            <h2>{rowAnchor(row)}</h2>
            <p>
              {scopeMeta(row.scope).label}
              {target ? ` · 指向 ${target}` : ''}
            </p>
          </>
        ) : (
          <>
            <h2>尚未选择</h2>
            <p>选一条说明查看详情。</p>
          </>
        )}
      </div>

      <section className="semantic-inspector-section is-visible">
        <h3>AI 能看到</h3>
        {visibility?.connectionContext && (
          <div className="semantic-inspector-context">
            <InfoCircleOutlined />
            {visibility.connectionContext}
          </div>
        )}
        {visibility && !visibility.visible && (
          <div className="semantic-inspector-warning">
            <WarningOutlined />
            AI 看不到这条：{visibility.hiddenReason}
          </div>
        )}
        <FactList
          facts={visibility?.current ?? []}
          empty={row ? '暂无内容。' : '选中一条说明后显示。'}
        />
      </section>

      <section className="semantic-inspector-section is-retained">
        <h3>AI 看不到</h3>
        <div className="semantic-inspector-subhead">已保存，未提供</div>
        <FactList
          facts={visibility?.retained ?? []}
          empty={row ? '暂无内容。' : '选中一条说明后显示。'}
        />
        <div className="semantic-inspector-subhead">允许但尚未取得</div>
        <FactList
          facts={visibility?.allowedMissing ?? []}
          empty={row ? '暂无内容。' : '选中一条说明后显示。'}
        />
      </section>

      <section className="semantic-inspector-section is-trust">
        <h3>信任与来源</h3>
        {row ? (
          <>
            <div className="semantic-trust-tags">
              <SemanticTag
                meta={sourceMeta(row.source)}
                icon={isHuman(row) ? <UserOutlined aria-hidden="true" /> : undefined}
              />
              <SemanticTag meta={evidenceMeta(row)} />
              <SemanticTag meta={verifiedMeta(row)} />
              <SemanticTag meta={rowStatusMeta(row.status, row.scope)} />
            </div>
            {(row.answeredName || row.answeredAt) && (
              <p className="semantic-trust-line">
                回答人：{row.answeredName || '未知'}
                {row.answeredAt ? ` · ${formatTime(row.answeredAt)}` : ''}
              </p>
            )}
            {confidence !== null && (
              <p className="semantic-trust-line">AI 自评可信度：{confidence} / 100</p>
            )}
            {details.length > 0 && (
              <dl className="semantic-detail-list">
                {details.map((detail) => (
                  <div key={detail.key}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {row.traceId && (
              <p className="semantic-trust-line">
                来自对话：
                <Typography.Text copyable code>
                  {row.traceId}
                </Typography.Text>
              </p>
            )}
            {history.length > 0 && (
              <div className="semantic-history">
                <b>修改记录 · {history.length} 次</b>
                <ol>
                  {history.map((entry, index) => (
                    <li key={`${index}-${entry.at ?? ''}`}>
                      {formatTime(entry.at)}
                      {entry.byName ? ` · ${entry.byName}` : ''}
                      <span>改前：{entry.fromGloss || '（空）'}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {row.updateTime && (
              <p className="semantic-trust-line">最后更新：{formatTime(row.updateTime)}</p>
            )}
          </>
        ) : (
          <p className="semantic-inspector-empty">选中一条说明后显示。</p>
        )}
      </section>

      <section className="semantic-inspector-section is-danger">
        <h3>危险区</h3>
        <p>删除后无法恢复。</p>
        <Divider />
        <Tooltip title={row ? '删除当前说明' : '请先选一条说明'}>
          <span>
            <Button
              danger
              block
              icon={<DeleteOutlined />}
              disabled={!row}
              loading={deletePending}
              onClick={() => row && onDelete(row)}
            >
              删除这条说明
            </Button>
          </span>
        </Tooltip>
        {row && isHuman(row) && <Tag color="red">人工确认的口径</Tag>}
      </section>
    </aside>
  );
}
