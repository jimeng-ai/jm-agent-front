import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { decodeJwt } from '@/utils/jwt';
import { clearAccountScopedClientState } from '@/queryClient';
import type { AdminUser } from '@/api/types';

const STORAGE_KEY = 'jm-agent-auth';

// 记住我：勾选→token 落 localStorage（关浏览器仍在登录态）；取消→落 sessionStorage（关浏览器即清）。
// activeStorage 是后续 setItem 的目标：rehydrate(getItem) 时按 token 实际所在的 storage 校正，
// 登录时由 setRememberMe 显式指定。默认 localStorage 仅作初值，会被 getItem 校正。
let activeStorage: Storage = localStorage;

const routedStorage: StateStorage = {
  getItem: (name) => {
    const fromLocal = localStorage.getItem(name);
    if (fromLocal !== null) {
      activeStorage = localStorage;
      return fromLocal;
    }
    const fromSession = sessionStorage.getItem(name);
    if (fromSession !== null) {
      activeStorage = sessionStorage;
      return fromSession;
    }
    return null;
  },
  setItem: (name, value) => {
    activeStorage.setItem(name, value);
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

/**
 * 登录提交时调用：按「记住我」选择后续持久化目标，并清掉另一个 storage 里的旧 token，
 * 避免取消勾选后仍残留一份可被 rehydrate 捡回的 localStorage token。
 */
export function setRememberMe(remember: boolean) {
  // 先清两个 storage，避免上一次相反选择残留的 token 在下次 rehydrate 时被 getItem 优先捡回，
  // 把本不该持久化的会话"提升"为 localStorage 持久化。
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  activeStorage = remember ? localStorage : sessionStorage;
}

interface AuthState {
  token: string | null;
  tenantId: string | null;
  user: AdminUser | null;
  /** 每次登录、退出或身份切换都会递增，用于拒绝上一段会话迟到的异步结果。 */
  sessionGeneration: number;
  setAuth: (payload: { token: string; user?: AdminUser }) => void;
  /** 滑动续期：仅替换 token，保留现有 user / tenantId（不可复用 setAuth，它会把 user 置空）。 */
  renewToken: (token: string) => boolean;
  setUser: (user: AdminUser) => void;
  logout: () => void;
}

function sessionIdentity(token: string | null, user?: AdminUser | null) {
  if (!token) return null;
  const payload = decodeJwt(token);
  const userId = user?.id ?? (typeof payload?.id === 'string' ? payload.id : null);
  const tenantId =
    user?.tenantId ?? (typeof payload?.tenant_id === 'string' ? payload.tenant_id : null);
  return userId || tenantId ? `${tenantId ?? ''}:${userId ?? ''}` : token;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      tenantId: null,
      user: null,
      sessionGeneration: 0,
      setAuth: ({ token, user }) => {
        // 登录成功也要清理：logout 后 store 虽已为空，QueryClient 仍可能留有上一账号的权限/业务数据。
        clearAccountScopedClientState();
        const payload = decodeJwt(token);
        set({
          token,
          tenantId: user?.tenantId ?? payload?.tenant_id ?? null,
          user: user ?? null,
          sessionGeneration: get().sessionGeneration + 1,
        });
      },
      renewToken: (token) => {
        const current = get();
        // refresh 只允许同一身份做 token rotation。身份切换只能走 setAuth，避免上一账号
        // 的迟到 refresh 把当前账号恢复回去并顺带清空当前账号缓存。
        if (
          !current.token ||
          sessionIdentity(current.token, current.user) !== sessionIdentity(token)
        ) {
          return false;
        }
        set({ token });
        return true;
      },
      setUser: (user) => {
        const current = get();
        const identityChanged =
          sessionIdentity(current.token, current.user) !== sessionIdentity(current.token, user);
        if (identityChanged) {
          clearAccountScopedClientState();
        }
        set({
          user,
          tenantId: user.tenantId ?? null,
          sessionGeneration: identityChanged
            ? current.sessionGeneration + 1
            : current.sessionGeneration,
        });
      },
      logout: () => {
        clearAccountScopedClientState();
        set((state) => ({
          token: null,
          tenantId: null,
          user: null,
          sessionGeneration: state.sessionGeneration + 1,
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => routedStorage),
      partialize: (state) => ({
        token: state.token,
        tenantId: state.tenantId,
        user: state.user,
      }),
    },
  ),
);

/** Axios、SSE 等异步链路统一使用这一会话栅栏，避免任一路径遗漏旧响应隔离。 */
export function isCurrentAuthSession(token: string | null, generation: number): boolean {
  const current = useAuthStore.getState();
  return current.token === token && current.sessionGeneration === generation;
}
