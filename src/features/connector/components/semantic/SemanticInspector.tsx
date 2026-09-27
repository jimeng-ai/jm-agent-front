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
      aria-label="语义条目详情"
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
            <p>从中间列表选择一条语义，核对模型输入与平台留存边界。</p>
          </>
        )}
      </div>

      <section className="semantic-inspector-section is-visible">
        <h3>模型此刻读到</h3>
        {visibility?.connectionContext && (
          <div className="semantic-inspector-context">
            <InfoCircleOutlined />
            {visibility.connectionContext}
          </div>
        )}
        {visibility && !visibility.visible && (
          <div className="semantic-inspector-warning">
            <WarningOutlined />
            语义断言不注入：{visibility.hiddenReason}
          </div>
        )}
        <FactList
          facts={visibility?.current ?? []}
          empty={row ? '这一条当前没有内容进入模型上下文。' : '选择一条语义后显示。'}
        />
      </section>

      <section className="semantic-inspector-section is-retained">
        <h3>平台留存但模型当前看不到</h3>
        <div className="semantic-inspector-subhead">已留存 · 被状态或档位挡下</div>
        <FactList
          facts={visibility?.retained ?? []}
          empty={row ? '没有被挡下的留存内容。' : '选择一条语义后显示。'}
        />
        <div className="semantic-inspector-subhead">当前允许 · 但尚未取得</div>
        <FactList
          facts={visibility?.allowedMissing ?? []}
          empty={row ? '没有“允许但未取得”的内容。' : '选择一条语义后显示。'}
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
              <p className="semantic-trust-line">模型自评置信度：{confidence} / 100</p>
            )}
            {row.anchorKind && row.anchorKind !== 'NONE' && (
              <p className="semantic-trust-line">结构锚定：{row.anchorKind}</p>
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
                <b>口径覆盖历史 · {history.length} 次</b>
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
          <p className="semantic-inspector-empty">选择一条语义后显示。</p>
        )}
      </section>

      <section className="semantic-inspector-section is-danger">
        <h3>危险区</h3>
        <p>
          删除是物理删除、不可恢复。机器推断行下次重新生成会回来；人工确认行会连同覆盖历史一起消失。
        </p>
        <Divider />
        <Tooltip title={row ? '删除当前语义条目' : '请先选择一条语义'}>
          <span>
            <Button
              danger
              block
              icon={<DeleteOutlined />}
              disabled={!row}
              loading={deletePending}
              onClick={() => row && onDelete(row)}
            >
              物理删除这一行
            </Button>
          </span>
        </Tooltip>
        {row && isHuman(row) && <Tag color="red">当前选中的是人工确认口径</Tag>}
      </section>
    </aside>
  );
}
