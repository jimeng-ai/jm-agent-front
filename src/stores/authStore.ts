import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { decodeJwt } from '@/utils/jwt';
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
  activeStorage = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(STORAGE_KEY);
}

interface AuthState {
  token: string | null;
  tenantId: string | null;
  user: AdminUser | null;
  setAuth: (payload: { token: string; user?: AdminUser }) => void;
  /** 滑动续期：仅替换 token，保留现有 user / tenantId（不可复用 setAuth，它会把 user 置空）。 */
  renewToken: (token: string) => void;
  setUser: (user: AdminUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      tenantId: null,
      user: null,
      setAuth: ({ token, user }) => {
        const payload = decodeJwt(token);
        set({
          token,
          tenantId: user?.tenantId ?? payload?.tenant_id ?? null,
          user: user ?? null,
        });
      },
      renewToken: (token) => set({ token }),
      setUser: (user) => set({ user, tenantId: user.tenantId ?? null }),
      logout: () => set({ token: null, tenantId: null, user: null }),
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
