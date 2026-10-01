import { Tabs } from 'antd';
import TableDetailPanel from './TableDetailPanel';
import type { DomainOption } from '../domains';
import { groupByPair, relationSentence, relationSource, tableTitle } from '../text';
import type { SystemGraph } from '../types';

export type SidePanelTab = 'relations' | 'isolated';

interface DataGraphSidePanelProps {
  graph: SystemGraph;
  domains: DomainOption[];
  selected: string | null;
  tab: SidePanelTab;
  emptyText: string;
  titleOf: (table: string) => string;
  onTabChange: (tab: SidePanelTab) => void;
  onPick: (table: string) => void;
  onBack: () => void;
}

// 未选中对象：关联清单 / 暂未发现关联的对象，停在哪个页签由页面记着（v2 审查 #9）；
// 选中对象：该对象的详情（不在画布上的对象也从这里看）。
export default function DataGraphSidePanel({
  graph,
  domains,
  selected,
  tab,
  emptyText,
  titleOf,
  onTabChange,
  onPick,
  onBack,
}: DataGraphSidePanelProps) {
  const isolated = graph.tables.filter((table) => !table.related);
  return (
    <aside className="dg-side" aria-label="对象与关联" data-testid="dg-side">
      {selected ? (
        <TableDetailPanel
          key={selected}
          connectorId={graph.connectorId}
          tableName={selected}
          domains={domains}
          titleOf={titleOf}
          onBack={onBack}
        />
      ) : (
        <Tabs
          size="small"
          activeKey={tab}
          onChange={(key) => onTabChange(key as SidePanelTab)}
          items={[
            {
              key: 'relations',
              label: `关联清单（${graph.relations.length}）`,
              children: graph.relations.length ? (
                <div className="dg-groups" data-testid="dg-relation-list">
                  {groupByPair(graph.relations, titleOf).map((group) => (
                    <section key={group.key} className="dg-group">
                      <h5 className="dg-group__title">{group.title}</h5>
                      <ul className="dg-sentences">
                        {group.relations.map((relation) => (
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
                              <span>{relationSentence(relation, titleOf)}</span>
                            </button>
                            <span className="dg-source">{relationSource(relation)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="dg-muted" data-testid="dg-relations-empty">
                  {emptyText}
                </p>
              ),
            },
            {
              key: 'isolated',
              label: `暂未发现关联的对象（${isolated.length}）`,
              children: isolated.length ? (
                <ul className="dg-table-list" data-testid="dg-isolated-list">
                  {isolated.map((table) => (
                    <li key={table.name}>
                      <button type="button" className="dg-link" onClick={() => onPick(table.name)}>
                        <span className="dg-table-list__title">{tableTitle(table)}</span>
                        {table.selfReferences.length ? <span className="dg-badge">内部关联</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dg-muted">所有对象都已连进关系图。</p>
              ),
            },
          ]}
        />
      )}
    </aside>
  );
}
