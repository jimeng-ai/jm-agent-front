import { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography } from 'antd';
import {
  DashboardOutlined,
  RobotOutlined,
  AppstoreOutlined,
  BookOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/console/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/console/agents', icon: <RobotOutlined />, label: 'Agent' },
  { key: '/console/plugins', icon: <AppstoreOutlined />, label: '插件' },
  { key: '/console/knowledge', icon: <BookOutlined />, label: '知识库' },
  { key: '/console/playground', icon: <ExperimentOutlined />, label: '调试台' },
];

export default function ConsoleLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, tenantId, logout } = useAuthStore();

  const selectedKey =
    menuItems.find((m) => location.pathname.startsWith(m.key))?.key ?? '/console/dashboard';

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={220}>
        <div
          style={{
            color: '#fff',
            padding: '16px 20px',
            fontWeight: 600,
            fontSize: 18,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {collapsed ? 'JM' : 'JM Agent'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <Typography.Text type="secondary">
            {tenantId ? `租户：${tenantId}` : '未识别租户'}
          </Typography.Text>
          <Dropdown
            menu={{
              items: [
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.displayName || user?.username || '管理员'}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16, padding: 16, background: '#fff', borderRadius: 8, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
