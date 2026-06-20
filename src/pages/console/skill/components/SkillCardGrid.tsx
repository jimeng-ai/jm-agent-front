import { Empty, Skeleton } from 'antd';
import type { SkillView } from '@/features/skill/types';
import SkillCard from './SkillCard';

interface Props {
  skills: SkillView[];
  loading: boolean;
  /** 是否处于「有数据但被搜索/筛选过滤为空」状态 */
  filteredEmpty: boolean;
  onClearFilters: () => void;
  onView: (id: string) => void;
  onShare: (id: string) => void;
  onUnshare: (id: string) => void;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function SkillCardGrid(props: Props) {
  const { skills, loading, filteredEmpty, onClearFilters, ...handlers } = props;

  if (loading) {
    return (
      <div className="skill-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: 16,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
            }}
          >
            <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 2 }} />
          </div>
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div style={{ paddingTop: 64 }}>
        <Empty description={filteredEmpty ? '没有匹配的技能' : '还没有技能'}>
          {filteredEmpty && (
            <a onClick={onClearFilters} role="button">
              清除筛选
            </a>
          )}
        </Empty>
      </div>
    );
  }

  return (
    <div className="skill-grid">
      {skills.map((s) => (
        <SkillCard key={s.id} skill={s} {...handlers} />
      ))}
    </div>
  );
}
