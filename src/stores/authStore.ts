import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { decodeJwt } from '@/utils/jwt';
import type { AdminUser } from '@/api/types';

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
      name: 'jm-agent-auth',
      partialize: (state) => ({
        token: state.token,
        tenantId: state.tenantId,
        user: state.user,
      }),
    },
  ),
);
