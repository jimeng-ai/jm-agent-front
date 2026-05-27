import { useEffect } from 'react';
import { Button, Card, Form, Input, App, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/features/auth/api';
import { useAuthStore } from '@/stores/authStore';
import { decodeJwt } from '@/utils/jwt';
import type { BizError } from '@/api/types';

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
    const redirect = params.get('redirect');
    const dest = redirect ? decodeURIComponent(redirect) : '/console';
    navigate(dest, { replace: true });
  }, [token, navigate, params, logout]);

  const loginMut = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth({ token: data.token, user: data.user });
      message.success('登录成功');
    },
    onError: (e: BizError) => message.error(e.message || '登录失败'),
  });

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card style={{ width: 400 }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          JM Agent 平台
        </Typography.Title>
        <Form layout="vertical" onFinish={(v) => loginMut.mutate(v)} autoComplete="off">
          <Form.Item
            label="账号"
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入账号" autoFocus />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loginMut.isPending}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
