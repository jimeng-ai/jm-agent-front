import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Segmented, Select, Space, Typography } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { skillApi } from '@/features/skill/api';
import SkillTheme from '@/features/skill/SkillTheme';
import SkillDetailDrawer from './SkillDetailDrawer';
import SkillCardGrid from './components/SkillCardGrid';
import './skill.css';

const { Title, Text } = Typography;

type FilterKey = 'ALL' | 'MINE';
type TypeFilter = 'ALL' | 'PROMPT' | 'DOER';
type StatusFilter = 'ALL' | 'ACTIVE' | 'DISABLED' | 'DRAFT';

export default function SkillListPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);

  // 全局搜索（⌘K）跳转 /console/skills?skillId=xxx 时，自动打开该技能详情抽屉。
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const skillId = searchParams.get('skillId');
    if (skillId) {
      setDetailId(skillId);
      // 消费掉，避免刷新/回退再次弹出；replace 不污染历史。
      const next = new URLSearchParams(searchParams);
      next.delete('skillId');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const mine = filter === 'MINE' ? true : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'list', filter],
    queryFn: () => skillApi.list(mine),
  });

  const skills = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (typeFilter !== 'ALL' && s.skillType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (kw) {
        const hay = `${s.name} ${s.description ?? ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [skills, search, typeFilter, statusFilter]);

  const hasFilter = search.trim() !== '' || typeFilter !== 'ALL' || statusFilter !== 'ALL';

  function clearFilters() {
    setSearch('');
    setTypeFilter('ALL');
    setStatusFilter('ALL');
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ['skill', 'list'] });
  }

  function onMutError(err: { message?: string }) {
    message.error(err?.message || '操作失败');
  }

  const uploadMut = useMutation({
    mutationFn: skillApi.upload,
    onSuccess: () => {
      message.success('上传成功');
      refresh();
    },
    onError: (err: { message?: string }) => message.error(err?.message || '上传失败'),
  });

  const shareMut = useMutation({
    mutationFn: skillApi.share,
    onSuccess: () => {
      message.success('已共享给团队');
      refresh();
    },
    onError: onMutError,
  });

  const unshareMut = useMutation({
    mutationFn: skillApi.unshare,
    onSuccess: () => {
      message.success('已取消共享');
      refresh();
    },
    onError: onMutError,
  });

  const enableMut = useMutation({
    mutationFn: skillApi.enable,
    onSuccess: () => {
      message.success('已启用');
      refresh();
    },
    onError: onMutError,
  });

  const disableMut = useMutation({
    mutationFn: skillApi.disable,
    onSuccess: () => {
      message.success('已停用');
      refresh();
    },
    onError: onMutError,
  });

  const removeMut = useMutation({
    mutationFn: skillApi.remove,
    onSuccess: () => {
      message.success('已删除');
      refresh();
    },
    onError: (err: { message?: string }) => message.error(err?.message || '删除失败'),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMut.mutate(file);
    e.target.value = '';
  }

  return (
    <SkillTheme>
      <div
        style={{
          // 抵消 .atlas-content 的 32/32/64 内边距,让 slate 底色铺满内容区
          margin: '-32px -32px -64px',
          padding: '32px 32px 64px',
          minHeight: '100%',
          background: '#F8FAFC',
        }}
      >
        {/* 标题区 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              技能 Skills
            </Title>
            <Text type="secondary">管理租户 Skill · 共 {skills.length} 个</Text>
          </div>
          <Space>
            <Button type="primary" onClick={() => navigate('/console/skill/builder')}>
              ✦ AI 生成
            </Button>
            <Button
              icon={<UploadOutlined />}
              loading={uploadMut.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              上传 SKILL.md
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </Space>
        </div>

        {/* 工具条 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            margin: '16px 0',
          }}
        >
          <Segmented<FilterKey>
            value={filter}
            onChange={(v) => setFilter(v)}
            options={[
              { label: '全部可见', value: 'ALL' },
              { label: '我创建的', value: 'MINE' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索名称 / 描述"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          <Select<TypeFilter>
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 120 }}
            options={[
              { label: '全部类型', value: 'ALL' },
              { label: 'Doer', value: 'DOER' },
              { label: 'Prompt', value: 'PROMPT' },
            ]}
          />
          <Select<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            options={[
              { label: '全部状态', value: 'ALL' },
              { label: '启用', value: 'ACTIVE' },
              { label: '停用', value: 'DISABLED' },
              { label: '草稿', value: 'DRAFT' },
            ]}
          />
        </div>

        {/* 网格(随 .atlas-content 自然滚动,不嵌套滚动条) */}
        <SkillCardGrid
          skills={filtered}
          loading={isLoading}
          filteredEmpty={hasFilter && filtered.length === 0}
          onClearFilters={clearFilters}
          onView={(id: string) => setDetailId(id)}
          onShare={(id: string) => shareMut.mutate(id)}
          onUnshare={(id: string) => unshareMut.mutate(id)}
          onEnable={(id: string) => enableMut.mutate(id)}
          onDisable={(id: string) => disableMut.mutate(id)}
          onRemove={(id: string) => removeMut.mutate(id)}
        />

        <SkillDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      </div>
    </SkillTheme>
  );
}
