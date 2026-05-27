import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { decodeJwt } from '@/utils/jwt';
import { type ApiResponse, BizError, RESP_CODE, isCode } from './types';

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
    if (isAuthError(response.status, body.respCode, body.respMsg)) {
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
    if (isAuthError(error.response?.status, respCode, respMsg)) {
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
