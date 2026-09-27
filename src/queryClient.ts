import { QueryClient } from '@tanstack/react-query';

/**
 * 全应用唯一 QueryClient。
 *
 * 账号/租户切换时必须从同一个实例清理缓存；若实例藏在 main.tsx 里，auth store 无法在
 * 写入下一位用户身份前同步清掉上一位用户的权限、连接与语义数据。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/**
 * 立即隔离上一段账号会话的数据。
 *
 * cancelQueries 先终止在途读取，clear 再同步移除 query + mutation cache，保证下一位用户
 * 首次渲染时没有上一租户的 stale data 可闪现。Mutation 的远端请求无法被通用地中止，
 * 但从 cache 移除后不会被下一段会话复用。
 */
export function clearAccountScopedClientState() {
  void queryClient.cancelQueries({}, { silent: true });
  queryClient.clear();
}
