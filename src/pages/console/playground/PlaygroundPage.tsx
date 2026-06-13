import { useMemo, useState } from 'react';
import { Card, Col, Row, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { agentApi, parseKbCount } from '@/features/agent/api';
import ChatPanel from '@/features/chat-admin/components/ChatPanel';
import PlaygroundEmpty from './PlaygroundEmpty';

export default function PlaygroundPage() {
  const { agentId: routeAgentId } = useParams();
  const [agentId, setAgentId] = useState<string | undefined>(routeAgentId);

  const agentsQuery = useQuery({
    queryKey: ['agent', 'list', 'all'],
    queryFn: () => agentApi.list(),
  });

  // 选中 Agent 后拉详情 + 绑定插件：用于把空状态对齐到对话页的 hero（头像/自我介绍/能力胶囊/预设问题）。
  // 调试台用实时草稿配置（preview），detail 返回的就是草稿态，正好。
  const agentQuery = useQuery({
    queryKey: ['agent', 'detail', agentId],
    queryFn: () => agentApi.detail(agentId as string),
    enabled: !!agentId,
  });
  const pluginsQuery = useQuery({
    queryKey: ['agent', 'plugins', agentId],
    queryFn: () => agentApi.listPlugins(agentId as string),
    enabled: !!agentId,
  });

  const agent = agentQuery.data;
  const kbCount = parseKbCount(agent?.kbConfig);
  const toolCount = pluginsQuery.data?.length ?? 0;

  // 知识库不再手动挂载：Agent 已绑定的知识库由后端按 agentId 自动启用（RagSkillToolExecutor
  // 在无显式 kb_id 时回退 agent.getKbIds()）。调试台保持与对话端一致。
  const panelKey = useMemo(() => agentId ?? '', [agentId]);

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
            {agentId ? (
              <ChatPanel
                key={panelKey}
                agentId={agentId}
                topK={5}
                rerank={false}
                preview
                agentName={agent?.name}
                agentDescription={agent?.description}
                agentAvatar={agent?.avatarUrl}
                agentModel={agent?.model}
                kbCount={kbCount}
                toolCount={toolCount}
                presetQuestions={agent?.presetQuestions}
              />
            ) : (
              <PlaygroundEmpty />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
