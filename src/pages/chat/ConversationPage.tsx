import { useQuery } from '@tanstack/react-query';
import { Avatar, Empty, Spin, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import ChatPanel from '@/features/chat-admin/components/ChatPanel';

export default function ConversationPage() {
  const { agentId = '' } = useParams();
  const agentQuery = useQuery({
    queryKey: ['agent', 'detail', agentId],
    queryFn: () => agentApi.detail(agentId),
    enabled: !!agentId,
  });

  if (agentQuery.isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!agentQuery.data) {
    return <Empty description="未找到该 Agent" style={{ marginTop: 120 }} />;
  }

  const agent = agentQuery.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Avatar
          src={agent.avatar}
          icon={!agent.avatar && <RobotOutlined />}
          style={{ marginRight: 12 }}
        />
        <div>
          <Typography.Text strong>{agent.name}</Typography.Text>
          {agent.description && (
            <div style={{ fontSize: 12, color: '#999' }}>{agent.description}</div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
        <ChatPanel
          agentId={agentId}
          simple
          placeholder={`你好，我是 ${agent.name}。有什么可以帮你？`}
        />
      </div>
    </div>
  );
}
