import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';

// 仅作用于 Skill 页面的 slate/navy 令牌。嵌套在全局 ConfigProvider 之内,不影响其它模块。
// 注意:Drawer 默认 portal 到 body,处于本 provider 子树之外,抽屉内容需单独再包一层 SkillTheme。
export default function SkillTheme({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#0F172A',
          colorInfo: '#0369A1',
          colorBorderSecondary: '#E2E8F0',
          colorText: '#0F172A',
          colorTextSecondary: '#64748B',
          borderRadius: 8,
        },
        components: {
          Card: { borderRadiusLG: 12 },
          Segmented: { itemSelectedBg: '#0F172A', itemSelectedColor: '#FFFFFF' },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
