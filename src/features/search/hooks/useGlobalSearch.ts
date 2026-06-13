import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../api';
import type { GlobalSearchResult, SearchItem } from '../types';

const EMPTY: GlobalSearchResult = { agents: [], documents: [], traces: [] };

/** 输入词 300ms 防抖；< 1 字不发请求。返回结果 + 拍平后的可选列表（用于键盘上下选择）。 */
export function useGlobalSearch(input: string, enabled: boolean) {
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const trimmed = input.trim();
    const t = setTimeout(() => setDebounced(trimmed), 300);
    return () => clearTimeout(t);
  }, [input]);

  const active = enabled && debounced.length >= 1;

  const query = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => searchApi.global(debounced),
    enabled: active,
    staleTime: 30_000,
  });

  const data = active ? (query.data ?? EMPTY) : EMPTY;

  // 拍平成有序列表：Agent → 文档 → Trace，键盘上下在其间移动。
  const items = useMemo<SearchItem[]>(() => {
    const list: SearchItem[] = [];
    data.agents.forEach((hit) => list.push({ kind: 'agent', hit }));
    data.documents.forEach((hit) => list.push({ kind: 'document', hit }));
    data.traces.forEach((hit) => list.push({ kind: 'trace', hit }));
    return list;
  }, [data]);

  return {
    data,
    items,
    loading: active && query.isFetching,
    /** 已输入有效查询但无任何命中。 */
    empty: active && !query.isFetching && items.length === 0,
    /** 是否处于「请输入关键词」的初始态。 */
    idle: !active,
  };
}
