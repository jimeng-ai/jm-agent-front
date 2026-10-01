import { useMemo, useState } from 'react';
import { Alert, Input, Skeleton, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { dataGraphApi } from '../api';
import { colorOf, type DomainOption } from '../domains';
import {
  domainLabel,
  groupByCounterpart,
  relationSentence,
  relationSource,
  selfReferenceSentence,
  tableTitle,
  technicalLine,
} from '../text';

interface TableDetailPanelProps {
  connectorId: string;
  tableName: string;
  domains: DomainOption[];
  titleOf: (table: string) => string;
  onBack: () => void;
}

const FIELD_SEARCH_THRESHOLD = 30;

/**
 * 一个对象的详情（设计文档 §8.3）：它是什么 → 和谁有关 → 技术信息（默认折叠）。
 * 默认展开的两段只用业务名和角色名；表名、字段名、字段对应只在技术信息里。
 * 父组件按对象 key 这个组件：换一个对象，字段搜索词这类状态整个重置（v2 审查 #1）。
 */
export default function TableDetailPanel({
  connectorId,
  tableName,
  domains,
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
        message="这个对象的详情没有加载出来"
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
  const groups = groupByCounterpart(detail.relations, detail.name, titleOf);
  return (
    <div className="dg-detail" data-testid="dg-detail">
      <button type="button" className="dg-link dg-detail__back" onClick={onBack}>
        ← 返回全部关联
      </button>

      <section className="dg-detail__section">
        <h4>它是什么</h4>
        <h3 className="dg-detail__title">{title}</h3>
        <span className="dg-detail__domain">
          <i style={{ background: colorOf(domains, detail.domain) }} aria-hidden />
          {domainLabel(detail.domain)}
        </span>
        {detail.summary ? (
          <p className="dg-detail__summary">{detail.summary}</p>
        ) : (
          <p className="dg-muted">暂无说明</p>
        )}
      </section>

      <section className="dg-detail__section">
        <h4>和谁有关</h4>
        {detail.selfReferences.length ? (
          <ul className="dg-sentences">
            {detail.selfReferences.map((ref) => (
              <li key={`self:${ref.fromColumn}`} className="is-self">
                <span>{selfReferenceSentence(title, ref)}</span>
                <span className="dg-source">{relationSource(ref)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {groups.map((group) => (
          <section key={group.key} className="dg-group">
            <h5 className="dg-group__title">{group.title}</h5>
            <ul className="dg-sentences">
              {group.relations.map((relation) => (
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
          </section>
        ))}
        {!groups.length && !detail.selfReferences.length ? (
          <p className="dg-muted">暂未发现与其他对象的关联</p>
        ) : null}
      </section>

      <details className="dg-tech">
        <summary>技术信息</summary>
        <div className="dg-tech__body">
          <p className="dg-tech__row">
            表名 <code>{detail.name}</code>
            {detail.objectType === 'VIEW' ? <Tag>视图</Tag> : null}
          </p>
          {detail.comment && detail.comment !== title ? (
            <p className="dg-tech__row">表注释：{detail.comment}</p>
          ) : null}
          {detail.relations.length || detail.selfReferences.length ? (
            <ul className="dg-tech__mapping">
              {detail.selfReferences.map((ref) => (
                <li key={`self:${ref.fromColumn}`}>
                  {`${detail.name}.${ref.fromColumn} → ${detail.name}.${ref.toColumn} · ${relationSource(ref)}`}
                </li>
              ))}
              {detail.relations.map((relation) => (
                <li key={relation.id}>{technicalLine(relation)}</li>
              ))}
            </ul>
          ) : null}
          <h5 className="dg-group__title">字段（{detail.fields.length}）</h5>
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
        </div>
      </details>
    </div>
  );
}
