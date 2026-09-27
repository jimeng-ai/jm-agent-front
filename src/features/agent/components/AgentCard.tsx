import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  MoreOutlined,
  SendOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Card, Dropdown, Space, Tag, Tooltip, Typography } from 'antd';
import type { Agent } from '@/api/types';
import { parseKbCount } from '@/features/agent/api';
import type { AgentCardAction } from '@/features/agent/types';

interface AgentCardProps {
  agent: Agent;
  pendingAction: AgentCardAction;
  onEdit: () => void;
  onDebug: () => void;
  onShare: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}

function primaryLabel(agent: Agent) {
  if (agent.status !== 'PUBLISHED') return '继续创建';
  if (agent.hasUnpublishedChanges) return '查看变更';
  return '继续配置';
}

export default function AgentCard({
  agent,
  pendingAction,
  onEdit,
  onDebug,
  onShare,
  onPublish,
  onUnpublish,
  onDelete,
}: AgentCardProps) {
  const pending = pendingAction !== null;
  const kbCount = parseKbCount(agent.kbConfig);
  const initial = agent.name.trim().slice(0, 1).toLocaleUpperCase() || 'A';

  return (
    <article
      className={`agent-entity-card${pending ? ' agent-entity-card--pending' : ''}`}
      data-testid="agent-card"
      data-agent-id={agent.id}
      data-agent-name={agent.name}
      aria-busy={pending}
    >
      <Card bordered={false}>
        <div className="agent-card-head">
          <Avatar src={agent.avatarUrl} size={46} className="agent-card-avatar">
            {initial}
          </Avatar>
          <div className="agent-card-identity">
            <Typography.Title level={4} ellipsis={{ tooltip: agent.name }}>
              {agent.name}
            </Typography.Title>
            <Typography.Text code ellipsis={{ tooltip: agent.code }}>
              {agent.code}
            </Typography.Text>
          </div>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'debug',
                  icon: <ExperimentOutlined />,
                  label: '打开调试台',
                  onClick: onDebug,
                },
                {
                  key: 'share',
                  icon: <ShareAltOutlined />,
                  label: '分享',
                  onClick: onShare,
                },
                { type: 'divider' },
                agent.status === 'PUBLISHED'
                  ? {
                      key: 'unpublish',
                      icon: <DownloadOutlined />,
                      label: '下架',
                      onClick: onUnpublish,
                    }
                  : {
                      key: 'publish',
                      icon: <SendOutlined />,
                      label: '发布',
                      onClick: onPublish,
                    },
                {
                  key: 'delete',
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: '删除',
                  onClick: onDelete,
                },
              ],
            }}
          >
            <Tooltip title="更多操作">
              <Button
                type="text"
                shape="circle"
                aria-label={`${agent.name} 的更多操作`}
                data-testid="agent-more-actions"
                disabled={pending}
                icon={<MoreOutlined />}
              />
            </Tooltip>
          </Dropdown>
        </div>

        <div className="agent-card-status" aria-label="Agent 状态">
          <Tag
            color={agent.status === 'PUBLISHED' ? 'green' : 'default'}
            data-testid="agent-publish-status"
            data-agent-status={agent.status}
          >
            {agent.status === 'PUBLISHED' ? '已发布' : '草稿'}
          </Tag>
          {agent.hasUnpublishedChanges && (
            <Tag color="gold" data-testid="agent-draft-delta">
              有未发布更新
            </Tag>
          )}
          {pendingAction && (
            <Tag color="processing">正在{pendingAction === 'delete' ? '删除' : '更新'}</Tag>
          )}
        </div>

        <Typography.Paragraph className="agent-card-description" ellipsis={{ rows: 2 }}>
          {agent.description?.trim() || '暂未填写用途说明'}
        </Typography.Paragraph>

        <dl className="agent-card-facts">
          <div>
            <dt>模型</dt>
            <dd>{agent.model || '未配置'}</dd>
          </div>
          <div>
            <dt>知识库</dt>
            <dd>{kbCount ? `${kbCount} 个` : '未绑定'}</dd>
          </div>
          <div>
            <dt>创建人</dt>
            <dd>{agent.creatorName || '—'}</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{agent.updateTime || '—'}</dd>
          </div>
        </dl>

        <div className="agent-card-footer">
          <Button
            type="primary"
            icon={<EditOutlined />}
            aria-label={`编辑 ${agent.name}`}
            data-testid="agent-primary-action"
            loading={pending}
            onClick={onEdit}
          >
            {primaryLabel(agent)}
          </Button>
          <Space size={4} className="agent-card-footnote">
            <span className="agent-card-footnote-dot" aria-hidden />
            草稿保存后仅调试台生效
          </Space>
        </div>
      </Card>
    </article>
  );
}
