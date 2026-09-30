import { Empty, Tabs } from 'antd';
import TableDetailPanel from './TableDetailPanel';
import { relationSentence, relationSource, tableTitle } from '../text';
import type { SystemGraph } from '../types';

interface DataGraphSidePanelProps {
  graph: SystemGraph;
  selected: string | null;
  titleOf: (table: string) => string;
  onPick: (table: string) => void;
  onBack: () => void;
}

// 未选中表：关系清单 / 未发现关联的表；选中表：该表详情（不在画布上的表也从这里看）。
export default function DataGraphSidePanel({
  graph,
  selected,
  titleOf,
  onPick,
  onBack,
}: DataGraphSidePanelProps) {
  const isolated = graph.tables.filter((table) => !table.related);
  return (
    <aside className="dg-side" aria-label="表与关系" data-testid="dg-side">
      {selected ? (
        <TableDetailPanel
          connectorId={graph.connectorId}
          tableName={selected}
          titleOf={titleOf}
          onBack={onBack}
        />
      ) : (
        <Tabs
          size="small"
          items={[
            {
              key: 'relations',
              label: `关系清单（${graph.relations.length}）`,
              children: graph.relations.length ? (
                <ul className="dg-sentences" data-testid="dg-relation-list">
                  {graph.relations.map((relation) => (
                    <li key={relation.id}>
                      <button
                        type="button"
                        className="dg-link"
                        onClick={() => onPick(relation.fromTable)}
                      >
                        <span
                          className={`dg-swatch ${relation.tier === 'INFERRED' ? 'is-inferred' : 'is-confirmed'}`}
                          aria-hidden
                        />
                        {relationSentence(relation, titleOf)}
                      </button>
                      <span className="dg-source">{relationSource(relation)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂未发现可以确认的表关系"
                />
              ),
            },
            {
              key: 'isolated',
              label: `未发现关联的表（${isolated.length}）`,
              children: isolated.length ? (
                <ul className="dg-table-list" data-testid="dg-isolated-list">
                  {isolated.map((table) => (
                    <li key={table.name}>
                      <button type="button" className="dg-link" onClick={() => onPick(table.name)}>
                        <span className="dg-table-list__title">{tableTitle(table)}</span>
                        {table.displayName ? (
                          <span className="dg-table-list__name">{table.name}</span>
                        ) : null}
                        {table.selfReferences.length ? (
                          <span className="dg-badge">有上下级</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所有表都已连进关系图" />
              ),
            },
          ]}
        />
      )}
    </aside>
  );
}
