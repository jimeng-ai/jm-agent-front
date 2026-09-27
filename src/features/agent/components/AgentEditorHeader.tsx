import {
  ArrowLeftOutlined,
  ExperimentOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Space, Tag, Tooltip, Typography } from 'antd';
import type { Agent } from '@/api/types';

interface AgentEditorHeaderProps {
  agent: Agent;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  onBack: () => void;
  onDebug: () => void;
  onSave: () => void;
  onPublish: () => void;
}

export default function AgentEditorHeader({
  agent,
  dirty,
  saving,
  publishing,
  onBack,
  onDebug,
  onSave,
  onPublish,
}: AgentEditorHeaderProps) {
  const initial = agent.name.trim().slice(0, 1).toLocaleUpperCase() || 'A';

  return (
    <header className="agent-editor-header" data-testid="agent-editor-header">
      <div className="agent-editor-header-main">
        <Tooltip title="返回 Agents">
          <Button
            type="text"
            shape="circle"
            aria-label="返回 Agents"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
          />
        </Tooltip>
        <Avatar src={agent.avatarUrl} size={38} className="agent-card-avatar">
          {initial}
        </Avatar>
        <div className="agent-editor-title">
          <Typography.Title level={3}>{agent.name}</Typography.Title>
          <Space size={4} wrap>
            <Tag color={agent.status === 'PUBLISHED' ? 'green' : 'default'}>
              {agent.status === 'PUBLISHED' ? '已发布' : '草稿'}
            </Tag>
            {agent.hasUnpublishedChanges && <Tag color="gold">有未发布更新</Tag>}
            {dirty && <Tag color="processing">有未保存变更</Tag>}
          </Space>
        </div>
      </div>

      <div className="agent-editor-header-actions">
        <Button icon={<ExperimentOutlined />} aria-label="打开调试台" onClick={onDebug}>
          调试台
        </Button>
        <Tooltip title="保存当前编辑，仅在调试台生效，不影响对话端用户">
          <Button
            icon={<SaveOutlined />}
            aria-label="保存 Agent 草稿"
            loading={saving}
            disabled={publishing}
            onClick={onSave}
          >
            保存草稿
          </Button>
        </Tooltip>
        <Tooltip title="先保存当前编辑，再把快照发布到对话端">
          <Button
            type="primary"
            icon={<SendOutlined />}
            aria-label="保存并发布 Agent"
            loading={publishing}
            disabled={saving}
            onClick={onPublish}
          >
            {agent.status === 'PUBLISHED' ? '发布更新' : '发布'}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
