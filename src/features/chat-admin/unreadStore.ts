import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 会话「回答完毕未查看」红点的全局态。刻意放在模块级 store（而非 ConversationsPanel 内部 state）：
 * 切到别的菜单栏会让侧栏组件卸载，组件内 state 会丢——红点就消失了。放这里则跨导航保留。
 *
 * - `unread`：持久化到 localStorage，菜单切换 / 刷新都保留。
 * - `lastGenerating`：仅内存（模块级），用于跨「侧栏卸载→重挂载」检测「生成中→完成」跃迁；
 *   不持久化，避免刷新后把早已看过的历史会话误标成新回复。
 */
interface ChatUnreadState {
  unread: string[];
  lastGenerating: string[];
  /**
   * 用最新列表同步未读态：
   * - 上次生成中、本次已完成、且不是当前正在看的会话 → 加红点；
   * - 当前正在看的会话永不带红点（视为已读）；
   * - 已删除的会话从未读里剔除。
   */
  sync: (allIds: string[], generatingIds: string[], activeId?: string | null) => void;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export const useChatUnreadStore = create<ChatUnreadState>()(
  persist(
    (set, get) => ({
      unread: [],
      lastGenerating: [],
      sync: (allIds, generatingIds, activeId) => {
        // 列表为空通常是加载中：不动未读，避免把红点误清。
        if (allIds.length === 0) return;
        const prevGen = get().lastGenerating;
        const genSet = new Set(generatingIds);
        const known = new Set(allIds);
        // 先剔除已删除的会话和当前正在看的会话
        const next = get().unread.filter((id) => known.has(id) && id !== activeId);
        // 「上次生成中 → 本次已完成」的会话补红点（排除正在看的）
        for (const id of prevGen) {
          if (!genSet.has(id) && id !== activeId && known.has(id) && !next.includes(id)) {
            next.push(id);
          }
        }
        const cur = get();
        if (!sameList(next, cur.unread) || !sameList(generatingIds, cur.lastGenerating)) {
          set({ unread: next, lastGenerating: generatingIds });
        }
      },
    }),
    {
      name: 'jm-chat-unread',
      // 只持久化 unread；lastGenerating 留在内存，刷新即重置。
      partialize: (state) => ({ unread: state.unread }),
    },
  ),
);
