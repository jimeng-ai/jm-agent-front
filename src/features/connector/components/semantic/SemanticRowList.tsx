import { useEffect, useId, useState } from 'react';
import { Button, Empty, Pagination, Tag, Tooltip } from 'antd';
import { EyeOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons';
import {
  evidenceMeta,
  formatTime,
  isHuman,
  joinCare,
  joinTarget,
  rowAnchor,
  rowStatusMeta,
  semanticAttentionReasons,
  sourceMeta,
  tableShapeOf,
  verifiedMeta,
} from '@/features/connector/semantic';
import type { ConnectorSemanticRow } from '@/features/connector/types';
import { JoinCareSummary, KeyValueCare, SemanticTag, TableShapeSummary } from './SemanticSignals';

const PAGE_THRESHOLD = 20;

interface Props {
  rows: ConnectorSemanticRow[];
  title: string;
  subtitle: string;
  tier: string | null | undefined;
  tierText: string;
  answeredTerms: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (row: ConnectorSemanticRow | null) => void;
  onOpenInspector: () => void;
}

const attentionColor = (tone: 'danger' | 'warning' | 'info') =>
  tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : 'blue';

export default function SemanticRowList({
  rows,
  title,
  subtitle,
  tier,
  tierText,
  answeredTerms,
  selectedId,
  onSelect,
  onOpenInspector,
}: Props) {
  const [page, setPage] = useState(1);
  const titleId = useId();
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_THRESHOLD));

  useEffect(() => {
    setPage(1);
  }, [title]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const visibleRows =
    rows.length > PAGE_THRESHOLD
      ? rows.slice((page - 1) * PAGE_THRESHOLD, page * PAGE_THRESHOLD)
      : rows;

  useEffect(() => {
    const currentPageRows =
      rows.length > PAGE_THRESHOLD
        ? rows.slice((page - 1) * PAGE_THRESHOLD, page * PAGE_THRESHOLD)
        : rows;
    if (currentPageRows.some((row) => row.id === selectedId)) return;
    onSelect(currentPageRows[0] ?? null);
  }, [onSelect, page, rows, selectedId]);

  const changePage = (nextPage: number) => {
    setPage(nextPage);
    const first = rows[(nextPage - 1) * PAGE_THRESHOLD] ?? null;
    onSelect(first);
  };

  return (
    <section
      className="semantic-row-list"
      data-testid="semantic-row-list"
      aria-labelledby={titleId}
    >
      <div className="semantic-list-head">
        <div>
          <div className="semantic-eyebrow">ASSERTION LEDGER</div>
          <h2 id={titleId}>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="semantic-list-actions">
          <Tag>{rows.length} 条</Tag>
          <Button
            className="semantic-inspector-trigger"
            icon={<EyeOutlined />}
            disabled={!selectedId}
            onClick={onOpenInspector}
          >
            查看所选详情
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个视图目前没有语义条目" />
      ) : (
        <div className="semantic-card-stack" role="group" aria-label={`${title}语义列表`}>
          {visibleRows.map((row, index) => {
            const source = sourceMeta(row.source);
            const evidence = evidenceMeta(row);
            const verified = verifiedMeta(row);
            const status = rowStatusMeta(row.status, row.scope);
            const care = joinCare(row, tier);
            const shape = tableShapeOf(row);
            const target = row.scope === 'JOIN' ? joinTarget(row) : null;
            const attention = semanticAttentionReasons(row, tier, answeredTerms);
            const domKey = `${page}-${index}-${row.id}`.replace(/[^A-Za-z0-9_-]/g, '-');
            const anchorId = `semantic-row-anchor-${domKey}`;
            const glossId = `semantic-row-gloss-${domKey}`;
            const trustId = `semantic-row-trust-${domKey}`;
            return (
              <button
                type="button"
                key={row.id}
                className={`semantic-row-card ${selectedId === row.id ? 'is-selected' : ''} ${
                  isHuman(row) ? 'is-human' : ''
                }`}
                aria-labelledby={`${anchorId} ${glossId}`}
                aria-describedby={trustId}
                aria-current={selectedId === row.id ? 'true' : undefined}
                onClick={() => onSelect(row)}
              >
                <div className="semantic-row-anchor">
                  <code id={anchorId}>{rowAnchor(row)}</code>
                  {target && <span className="semantic-target">→ {target}</span>}
                  <div className="semantic-shape-line">
                    {care && (
                      <Tooltip title={care.hint}>
                        <Tag color="orange" icon={<WarningOutlined />}>
                          {care.label}
                        </Tag>
                      </Tooltip>
                    )}
                    {shape && <TableShapeSummary shape={shape} />}
                  </div>
                </div>

                <div className="semantic-row-body">
                  <div id={glossId} className="semantic-gloss">
                    {row.gloss || '—'}
                  </div>
                  {care && <JoinCareSummary care={care} tierText={tierText} />}
                  {shape?.kind === 'SHAPE' && shape.keyValue && <KeyValueCare shape={shape} />}
                  {attention.length > 0 && (
                    <div className="semantic-attention-tags" aria-label="需关注原因">
                      {attention.map((reason) => (
                        <Tooltip title={reason.hint} key={reason.code}>
                          <Tag color={attentionColor(reason.tone)}>{reason.label}</Tag>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>

                <div id={trustId} className="semantic-row-trust">
                  <SemanticTag
                    meta={source}
                    icon={isHuman(row) ? <UserOutlined aria-hidden="true" /> : undefined}
                  />
                  <SemanticTag meta={evidence} />
                  <SemanticTag meta={verified} />
                  <SemanticTag meta={status} />
                  {row.answeredName && (
                    <span className="semantic-answerer">
                      {row.answeredName}
                      {row.answeredAt ? ` · ${formatTime(row.answeredAt, 'MM-DD HH:mm')}` : ''}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {rows.length > PAGE_THRESHOLD && (
        <div className="semantic-pagination">
          <Pagination
            current={page}
            pageSize={PAGE_THRESHOLD}
            total={rows.length}
            size="small"
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 条 · 每页 ${PAGE_THRESHOLD} 条`}
            onChange={changePage}
          />
        </div>
      )}
    </section>
  );
}
