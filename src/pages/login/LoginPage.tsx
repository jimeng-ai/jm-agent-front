import { useEffect } from 'react';
import { Button, Form, Input, App, Checkbox, Modal } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/features/auth/api';
import { useAuthStore, setRememberMe } from '@/stores/authStore';
import { decodeJwt } from '@/utils/jwt';
import type { BizError } from '@/api/types';
import './LoginPage.css';

export default function LoginPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const payload = decodeJwt(token);
    const expired = typeof payload?.exp === 'number' && payload.exp * 1000 < Date.now();
    if (!payload || expired) {
      logout();
      return;
    }
    // 本地 token 未过期 ≠ 账号仍有效（可能已被禁用 / 会话已失效）。
    // 先向服务端确认（me() 会被网关 + AccountStatusFilter 校验），成功才进站；
    // 401 等失败则清掉本地登录态，留在登录页重新登录——避免被禁用成员凭旧 token 自动进站。
    let cancelled = false;
    authApi
      .me()
      .then(() => {
        if (cancelled) return;
        const redirect = params.get('redirect');
        const dest = redirect ? decodeURIComponent(redirect) : '/console';
        navigate(dest, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        logout();
      });
    return () => {
      cancelled = true;
    };
  }, [token, navigate, params, logout]);

  const loginMut = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth({ token: data.token, user: data.user });
      message.success('登录成功');
    },
    onError: (e: BizError) => {
      // 把 toast 推迟到下一个微任务：避免 antd message 的同步渲染插在 react-query
      // 状态通知之前，导致按钮 loading 的重渲染被推迟到 message 3s 自动消失时才发生。
      queueMicrotask(() => message.error(e.message || '登录失败'));
    },
  });

  const onForgotPassword = () => {
    Modal.info({
      title: '忘记密码',
      content: '请联系企业超级管理员或平台运营协助重置密码。',
      okText: '我知道了',
    });
  };

  const onFinish = (values: { username: string; password: string; remember?: boolean }) => {
    setRememberMe(!!values.remember);
    loginMut.mutate({ username: values.username, password: values.password });
  };

  return (
    <div className="login-root">
      <div className="login-card">
        {/* 左：品牌 / 氛围 */}
        <aside className="login-brand">
          <div className="login-brand-grid" />
          <span className="login-blob login-blob--1" />
          <span className="login-blob login-blob--2" />
          <span className="login-blob login-blob--3" />
          <div className="login-brand-inner">
            <div className="login-logo">
              <div className="login-logo-mark">JM</div>
              <div className="login-logo-name">JM Agent 平台</div>
            </div>
            <div className="login-pitch">
              <h2>
                让每个团队
                <br />
                都有自己的 AI 助理
              </h2>
              <p>统一接入、编排与知识库。把复杂留给系统，你只需专注业务。</p>
              <div className="login-chips">
                <span className="login-chip">多租户隔离</span>
                <span className="login-chip">插件生态</span>
                <span className="login-chip">知识库问答</span>
              </div>
            </div>
            <div className="login-foot">© 2026 JM Agent · 企业智能体平台</div>
          </div>
        </aside>

        {/* 右：表单 */}
        <main className="login-panel">
          <Form
            className="login-form"
            layout="vertical"
            initialValues={{ remember: true }}
            onFinish={onFinish}
            autoComplete="off"
            requiredMark={false}
          >
            <h1 className="login-hi">欢迎回来 👋</h1>
            <p className="login-hi-sub">登录以继续你的工作台</p>

            <Form.Item
              label="账号"
              name="username"
              rules={[{ required: true, message: '请输入账号' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="请输入账号" size="large" autoFocus />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" size="large" />
            </Form.Item>

            <div className="login-row">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>记住我</Checkbox>
              </Form.Item>
              <span className="login-link" onClick={onForgotPassword}>
                忘记密码？
              </span>
            </div>

            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loginMut.isPending}
              className="login-submit"
            >
              登录
            </Button>

            <p className="login-terms">登录即代表同意服务条款与隐私政策</p>
          </Form>
        </main>
      </div>
    </div>
  );
}
