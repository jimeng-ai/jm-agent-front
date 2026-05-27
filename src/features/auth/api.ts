import { post, get } from '@/api/client';
import type { AdminUser, LoginResult } from '@/api/types';

export const authApi = {
  login: (payload: { username: string; password: string }) =>
    post<LoginResult>('/admin/auth/login', payload),
  me: () => get<AdminUser>('/admin/auth/me'),
  changePassword: (payload: { oldPassword: string; newPassword: string }) =>
    post<void>('/admin/auth/change-password', payload),
};
