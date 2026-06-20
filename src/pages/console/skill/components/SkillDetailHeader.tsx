import { Button, Popconfirm, Space, Typography } from 'antd';
import {
  DeleteOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { SkillDetailView } from '@/features/skill/types';
import { SkillScopeChip, SkillStatusDot, SkillTypeChip } from '@/features/skill/meta';

interface Props {
  skill: SkillDetailView;
  /** DOER 文件数,>0 时头部显示「N 个文件」可点芯片 */
  fileCount?: number;
  onJumpToFiles?: () => void;
  onShare: () => void;
  onUnshare: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onRemove: () => void;
}

export default function SkillDetailHeader(props: Props) {
  const { skill: s } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {s.name}
      </Typography.Title>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SkillTypeChip type={s.skillType} />
        <SkillScopeChip scope={s.scope} />
        <SkillStatusDot status={s.status} />
        <span style={{ fontSize: 12, color: '#94A3B8' }}>v{s.version}</span>
        {props.fileCount ? (
          <button type="button" className="skill-files-chip" onClick={props.onJumpToFiles}>
            <FolderOpenOutlined />
            {props.fileCount} 个文件
          </button>
        ) : null}
      </div>

      {s.description && (
        <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
          {s.description}
        </Typography.Text>
      )}

      <Space size="small" style={{ marginTop: 4 }}>
        {s.scope === 'PRIVATE' ? (
          <Button size="small" icon={<ShareAltOutlined />} onClick={props.onShare}>
            共享给团队
          </Button>
        ) : (
          <Button size="small" icon={<StopOutlined />} onClick={props.onUnshare}>
            取消共享
          </Button>
        )}
        {s.status === 'ACTIVE' ? (
          <Popconfirm title="停用该 Skill?" onConfirm={props.onDisable}>
            <Button size="small" icon={<PauseCircleOutlined />}>
              停用
            </Button>
          </Popconfirm>
        ) : (
          <Popconfirm title="启用该 Skill?" onConfirm={props.onEnable}>
            <Button size="small" icon={<PlayCircleOutlined />}>
              启用
            </Button>
          </Popconfirm>
        )}
        <Popconfirm title="确认删除该 Skill?" okType="danger" onConfirm={props.onRemove}>
          <Button size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      </Space>
    </div>
  );
}
