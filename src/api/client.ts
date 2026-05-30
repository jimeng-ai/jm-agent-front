import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { decodeJwt, type JwtPayload } from '@/utils/jwt';
import { type ApiResponse, type LoginResult, BizError, RESP_CODE, isCode } from './types';

const baseURL = import.meta.env.VITE_API_BASE || '/data';

export const httpClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 30_000,
});

const AUTH_WHITELIST = [/\/admin\/auth\/login$/];
function isWhitelisted(url: string | undefined): boolean {
  if (!url) return false;
  return AUTH_WHITELIST.some((re) => re.test(url));
}

// 滑动续期：token 剩余有效期低于该阈值时，在后台静默换发一枚新的 12h token
// （阈值默认 6h，即 token 寿命的一半）。只要在该窗口内有任意请求，会话就持续顺延；
// 超过约 6–12h 完全无操作才会真正过期、需要重新登录。
const RENEW_BEFORE_MS = 6 * 60 * 60 * 1000;
const REFRESH_URL = '/admin/auth/refresh';

let renewing: Promise<void> | null = null;
function maybeRenewToken(payload: JwtPayload, url: string) {
  if (renewing) return; // 已有续期在途，避免并发重复换发
  if (url.includes(REFRESH_URL)) return; // 别让 refresh 请求自身再触发续期（防递归）
  if (typeof payload.exp !== 'number') return;
  const remaining = payload.exp * 1000 - Date.now();
  if (remaining <= 0 || remaining >= RENEW_BEFORE_MS) return;
  // 当前请求继续用旧 token（仍有效）发出；新 token 落库后从下一个请求开始生效。
  renewing = httpClient
    .post<LoginResult>(REFRESH_URL)
    .then((r) => {
      const next = r.data?.token;
      if (next) useAuthStore.getState().renewToken(next);
    })
    .catch(() => {
      // 续期失败不打断业务请求；token 真到期时自然会走 401 → 跳登录
    })
    .finally(() => {
      renewing = null;
    });
}

httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { token, tenantId } = useAuthStore.getState();
  const url = config.url ?? '';
  if (token && !isWhitelisted(url)) {
    const payload = decodeJwt(token);
    const expired = typeof payload?.exp === 'number' && payload.exp * 1000 < Date.now();
    if (!payload || expired) {
      // Token is malformed or expired — drop it before the gateway sees it.
      redirectToLogin('登录已过期，请重新登录');
      return Promise.reject(new BizError(RESP_CODE.UNAUTHORIZED, '本地登录态失效'));
    }
    // Backend contract (LoginResponse#token): raw JWT, no "Bearer " prefix.
    config.headers.set('Authorization', token);
    maybeRenewToken(payload, url); // 临近过期则后台静默续期，不阻塞当前请求
  } else if (token) {
    config.headers.set('Authorization', token);
  }
  if (tenantId) {
    config.headers.set('X-Tenant-Id', tenantId);
  }
  return config;
});

let redirecting: Promise<void> | null = null;
function redirectToLogin(reason: string) {
  if (window.location.pathname === '/login') return Promise.resolve();
  if (redirecting) return redirecting;
  redirecting = Promise.resolve().then(() => {
    useAuthStore.getState().logout();
    message.error(reason);
    const here = window.location.pathname + window.location.search;
    const redirect = encodeURIComponent(here);
    window.location.replace(`/login?redirect=${redirect}`);
  });
  return redirecting;
}

function isAuthError(
  status: number | undefined,
  respCode: number | string | undefined,
  respMsg: string | undefined,
): boolean {
  if (status === 401 || status === 403) return true;
  if (isCode(respCode, RESP_CODE.UNAUTHORIZED)) return true;
  // Gateway may return a non-401 status for malformed/invalid JWTs; sniff the message.
  if (respMsg && /jwt|token/i.test(respMsg)) return true;
  return false;
}

httpClient.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse;
    if (!body || typeof body !== 'object' || !('respCode' in body)) {
      return response;
    }
    if (isCode(body.respCode, RESP_CODE.SUCCESS)) {
      response.data = body.data;
      return response;
    }
    // 白名单接口（如登录）本就不携带会话，其失败一律是业务错误：后端把
    // “用户名或密码错误”也用 4001 返回，与会话过期的 4001 撞码 —— 绝不能据此跳登录。
    if (!isWhitelisted(response.config?.url) && isAuthError(response.status, body.respCode, body.respMsg)) {
      redirectToLogin('登录已过期，请重新登录');
      throw new BizError(body.respCode, body.respMsg);
    }
    throw new BizError(body.respCode, body.respMsg || '请求失败');
  },
  (error: AxiosError<ApiResponse>) => {
    const respBody = error.response?.data;
    const respCode =
      respBody && typeof respBody === 'object' && 'respCode' in respBody
        ? respBody.respCode
        : undefined;
    const respMsg =
      respBody && typeof respBody === 'object' && 'respMsg' in respBody
        ? respBody.respMsg
        : undefined;
    if (!isWhitelisted(error.config?.url) && isAuthError(error.response?.status, respCode, respMsg)) {
      redirectToLogin('未授权，请登录');
      return Promise.reject(new BizError(respCode ?? RESP_CODE.UNAUTHORIZED, respMsg ?? '未授权'));
    }
    if (respCode !== undefined) {
      return Promise.reject(new BizError(respCode, respMsg || '请求失败'));
    }
    return Promise.reject(new BizError(RESP_CODE.SERVER_ERROR, error.message || '网络错误'));
  },
);

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const r = await httpClient.get<T>(url, { params });
  return r.data;
}

export async function post<T>(url: string, data?: unknown): Promise<T> {
  const r = await httpClient.post<T>(url, data);
  return r.data;
}

export async function put<T>(url: string, data?: unknown): Promise<T> {
  const r = await httpClient.put<T>(url, data);
  return r.data;
}

export async function del<T>(url: string): Promise<T> {
  const r = await httpClient.delete<T>(url);
  return r.data;
}

export async function upload<T>(
  url: string,
  file: File,
  fieldName = 'file',
  extra?: Record<string, string>,
): Promise<T> {
  const fd = new FormData();
  fd.append(fieldName, file);
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  }
  const r = await httpClient.post<T>(url, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return r.data;
}
