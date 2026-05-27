import { Empty, Typography } from 'antd';

interface Props {
  title: string;
  hint?: string;
}

export default function StubPage({ title, hint }: Props) {
  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      <Empty description={hint ?? '该模块开发中'} style={{ marginTop: 80 }} />
    </div>
  );
}
