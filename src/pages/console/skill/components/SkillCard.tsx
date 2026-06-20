import { App, Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  CodeOutlined,
  DeleteOutlined,
  FileTextOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { SkillView } from '@/features/skill/types';
import { SkillScopeChip, SkillStatusDot, SkillTypeChip } from '@/features/skill/meta';
import { SOURCE_LABEL } from '@/features/skill/skillMeta';

interface Props {
  skill: SkillView;
  onView: (id: string) => void;
  onShare: (id: string) => void;
  onUnshare: (id: string) => void;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function SkillCard(props: Props) {
  const { skill: s, onView } = props;
  const { modal } = App.useApp();
  const TypeIcon = s.skillType === 'DOER' ? CodeOutlined : FileTextOutlined;
  const iconTint =
    s.skillType === 'DOER'
      ? { color: '#4338CA', bg: '#EEF2FF' }
      : { color: '#7C3AED', bg: '#F5F3FF' };

  const menuItems: MenuProps['items'] = [
    s.scope === 'PRIVATE'
      ? { key: 'share', icon: <ShareAltOutlined />, label: '共享给团队' }
      : { key: 'unshare', icon: <StopOutlined />, label: '取消共享' },
    s.status === 'ACTIVE'
      ? { key: 'disable', icon: <PauseCircleOutlined />, label: '停用' }
      : { key: 'enable', icon: <PlayCircleOutlined />, label: '启用' },
    { type: 'divider' },
    { key: 'remove', icon: <DeleteOutlined />, label: '删除', danger: true },
  ];

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'share') props.onShare(s.id);
    else if (key === 'unshare') props.onUnshare(s.id);
    else if (key === 'enable') props.onEnable(s.id);
    else if (key === 'disable')
      modal.confirm({
        title: '停用该 Skill?',
        okText: '停用',
        cancelText: '取消',
        onOk: () => props.onDisable(s.id),
      });
    else if (key === 'remove')
      modal.confirm({
        title: '确认删除该 Skill?',
        okType: 'danger',
        okText: '删除',
        cancelText: '取消',
        onOk: () => props.onRemove(s.id),
      });
  };

  return (
    <div
      className="skill-card"
      role="button"
      tabIndex={0}
      aria-label={`查看 ${s.name}`}
      onClick={() => onView(s.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView(s.id);
        }
      }}
    >
      {/* 顶部:类型图标 + 名称 + 状态点 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: iconTint.bg,
            color: iconTint.color,
            flex: 'none',
          }}
        >
          <TypeIcon style={{ fontSize: 16 }} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: 600,
            fontSize: 15,
            color: '#0F172A',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={s.name}
        >
          {s.name}
        </span>
        <SkillStatusDot status={s.status} />
      </div>

      {/* 芯片行 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <SkillTypeChip type={s.skillType} />
        <SkillScopeChip scope={s.scope} />
      </div>

      {/* 描述(2 行截断) */}
      <div className="skill-card__desc">{s.description || '暂无描述'}</div>

      {/* 底部:来源·版本 + hover 浮出操作 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
          paddingTop: 10,
          borderTop: '1px solid #f1f5f9',
        }}
      >
        <span style={{ fontSize: 12, color: '#94A3B8' }}>
          {SOURCE_LABEL[s.source] ?? s.source} · v{s.version}
        </span>
        <div
          className="skill-card__actions"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="small" type="text" onClick={() => onView(s.id)}>
            查看
          </Button>
          <Dropdown
            menu={{ items: menuItems, onClick: onMenuClick }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button size="small" type="text" icon={<MoreOutlined />} aria-label="更多操作" />
          </Dropdown>
        </div>
      </div>
    </div>
  );
}
