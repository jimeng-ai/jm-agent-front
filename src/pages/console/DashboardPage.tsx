import { Card, Col, Row, Statistic, Tooltip } from 'antd';
import {
  RobotOutlined,
  AppstoreOutlined,
  BookOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { agentApi } from '@/features/agent/api';
import { pluginApi } from '@/features/plugin/api';
import { kbApi } from '@/features/knowledge/api';

export default function DashboardPage() {
  const agentQ = useQuery({ queryKey: ['dashboard', 'agents'], queryFn: () => agentApi.list() });
  const pluginQ = useQuery({ queryKey: ['dashboard', 'plugins'], queryFn: () => pluginApi.list() });
  const kbQ = useQuery({ queryKey: ['dashboard', 'kbs'], queryFn: () => kbApi.list() });

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>仪表盘</h2>
      <Row gutter={16}>
        <Col span={6}>
          <Card loading={agentQ.isLoading}>
            <Statistic
              title="Agent 数量"
              value={agentQ.data?.length ?? 0}
              prefix={<RobotOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={pluginQ.isLoading}>
            <Statistic
              title="插件数量"
              value={pluginQ.data?.length ?? 0}
              prefix={<AppstoreOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={kbQ.isLoading}>
            <Statistic
              title="知识库数量"
              value={kbQ.data?.length ?? 0}
              prefix={<BookOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Tooltip title="后端暂未提供对话量统计接口">
              <Statistic title="今日对话" value="-" prefix={<MessageOutlined />} />
            </Tooltip>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
