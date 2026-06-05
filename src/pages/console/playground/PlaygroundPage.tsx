import { useMemo, useState } from 'react';
import { Card, Col, Row, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { agentApi } from '@/features/agent/api';
import { kbApi } from '@/features/knowledge/api';
import ChatPanel from '@/features/chat-admin/components/ChatPanel';

export default function PlaygroundPage() {
  const { agentId: routeAgentId } = useParams();
  const [agentId, setAgentId] = useState<string | undefined>(routeAgentId);
  const [kbId, setKbId] = useState<string | undefined>();

  const agentsQuery = useQuery({
    queryKey: ['agent', 'list', 'all'],
    queryFn: () => agentApi.list(),
  });
  const kbQuery = useQuery({
    queryKey: ['kb', 'list'],
    queryFn: kbApi.list,
  });

  const panelKey = useMemo(() => `${agentId ?? ''}-${kbId ?? ''}`, [agentId, kbId]);

  return (
    <div style={{ height: 'calc(100vh - 132px)', display: 'flex', flexDirection: 'column' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        调试台
      </Typography.Title>

      <Row gutter={16} style={{ flex: 1, minHeight: 0 }}>
        <Col span={6}>
          <Card title="参数" size="small" style={{ height: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 4 }}>Agent</div>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder="选择 Agent"
                  value={agentId}
                  onChange={setAgentId}
                  options={(agentsQuery.data ?? []).map((a) => ({
                    label: a.status === 'DRAFT' ? `${a.name}（草稿）` : a.name,
                    value: a.id,
                  }))}
                />
              </div>
              <div>
                <div style={{ marginBottom: 4 }}>知识库（可选，启用 RAG）</div>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder="挂载知识库"
                  value={kbId}
                  onChange={setKbId}
                  options={(kbQuery.data ?? []).map((k) => ({
                    label: k.name,
                    value: k.id,
                  }))}
                />
              </div>
            </Space>
          </Card>
        </Col>
        <Col span={18}>
          <Card
            size="small"
            style={{ height: '100%' }}
            styles={{ body: { height: 'calc(100% - 38px)', padding: 0 } }}
            title="对话"
          >
            <ChatPanel
              key={panelKey}
              agentId={agentId}
              kbId={kbId}
              topK={5}
              rerank={false}
              preview
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
