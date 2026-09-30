import { useMemo, useState } from 'react';
import { Alert, Input, Skeleton, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { dataGraphApi } from '../api';
import { relationSentence, relationSource, selfReferenceSentence, tableTitle } from '../text';

interface TableDetailPanelProps {
  connectorId: string;
  tableName: string;
  titleOf: (table: string) => string;
  onBack: () => void;
}

const FIELD_SEARCH_THRESHOLD = 30;

export default function TableDetailPanel({
  connectorId,
  tableName,
  titleOf,
  onBack,
}: TableDetailPanelProps) {
  const [fieldQuery, setFieldQuery] = useState('');
  const query = useQuery({
    queryKey: ['data-graph', 'table', connectorId, tableName],
    queryFn: () => dataGraphApi.table(connectorId, tableName),
  });
  const detail = query.data;
  const fields = useMemo(() => {
    const all = detail?.fields ?? [];
    const keyword = fieldQuery.trim().toLowerCase();
    if (!keyword) return all;
    return all.filter(
      (field) =>
        field.name.toLowerCase().includes(keyword) ||
        (field.comment ?? '').toLowerCase().includes(keyword),
    );
  }, [detail?.fields, fieldQuery]);

  if (query.isPending) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (query.isError || !detail) {
    return (
      <Alert
        type="error"
        showIcon
        message="这张表的详情没有加载出来"
        description={query.error instanceof Error ? query.error.message : undefined}
        action={
          <button type="button" className="dg-link" onClick={() => void query.refetch()}>
            重试
          </button>
        }
      />
    );
  }

  const title = tableTitle(detail);
  return (
    <div className="dg-detail" data-testid="dg-detail">
      <button type="button" className="dg-link dg-detail__back" onClick={onBack}>
        ← 返回全部关系
      </button>
      <h3 className="dg-detail__title">{title}</h3>
      {detail.displayName ? <div className="dg-detail__name">{detail.name}</div> : null}
      {detail.comment && detail.comment !== detail.displayName ? (
        <p className="dg-detail__comment">{detail.comment}</p>
      ) : null}

      <section className="dg-detail__section">
        <h4>关系</h4>
        {detail.relations.length === 0 && detail.selfReferences.length === 0 ? (
          <p className="dg-muted">暂未发现与其他表的关系</p>
        ) : (
          <ul className="dg-sentences">
            {detail.selfReferences.map((ref) => (
              <li key={`self:${ref.fromColumn}`}>{selfReferenceSentence(title, ref)}</li>
            ))}
            {detail.relations.map((relation) => (
              <li key={relation.id}>
                <span
                  className={`dg-swatch ${relation.tier === 'INFERRED' ? 'is-inferred' : 'is-confirmed'}`}
                  aria-hidden
                />
                <span>{relationSentence(relation, titleOf)}</span>
                <span className="dg-source">{relationSource(relation)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dg-detail__section">
        <h4>字段（{detail.fields.length}）</h4>
        {detail.fields.length > FIELD_SEARCH_THRESHOLD ? (
          <Input
            allowClear
            size="small"
            placeholder="搜索字段"
            value={fieldQuery}
            onChange={(event) => setFieldQuery(event.target.value)}
          />
        ) : null}
        <ul className="dg-fields">
          {fields.map((field) => (
            <li key={field.name} className={field.inRelation ? 'is-related' : undefined}>
              <span className="dg-fields__name">{field.name}</span>
              {field.key === 'PRIMARY' ? <Tag color="cyan">主键</Tag> : null}
              {field.key === 'UNIQUE' ? <Tag color="blue">唯一</Tag> : null}
              {field.type ? <span className="dg-fields__type">{field.type}</span> : null}
              {field.comment ? <span className="dg-fields__comment">{field.comment}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
