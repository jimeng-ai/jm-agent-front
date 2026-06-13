import type { ReactNode } from 'react';
import { Typography } from 'antd';

/** auth_config 表单统一的「标签 + 控件 + 说明」竖排布局 */
export default function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {required && <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>}
          {label}
        </Typography.Text>
      </div>
      {children}
      {hint && (
        <div style={{ marginTop: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {hint}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
