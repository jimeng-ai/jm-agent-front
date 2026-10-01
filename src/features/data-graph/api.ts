import { get } from '@/api/client';
import type {
  SystemGraph,
  SystemGraphWire,
  SystemSummary,
  SystemSummaryWire,
  TableDetail,
} from './types';

const ROOT = '/admin/data-graph';

const toCount = (value: number | string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const dataGraphApi = {
  systems: async (): Promise<SystemSummary[]> =>
    (await get<SystemSummaryWire[]>(`${ROOT}/systems`)).map((system) => ({
      ...system,
      tableCount: toCount(system.tableCount),
    })),
  system: async (connectorId: string): Promise<SystemGraph> => {
    const wire = await get<SystemGraphWire>(`${ROOT}/systems/${encodeURIComponent(connectorId)}`);
    return {
      ...wire,
      tables: wire.tables.map((table) => ({ ...table, fieldCount: toCount(table.fieldCount) })),
    };
  },
  table: (connectorId: string, name: string): Promise<TableDetail> =>
    get<TableDetail>(`${ROOT}/systems/${encodeURIComponent(connectorId)}/tables`, { name }),
};
