import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Modal, Segmented, Select, Space, Typography } from 'antd';
import { GithubOutlined, UploadOutlined } from '@ant-design/icons';
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

/**
 * 解析 GitHub 上一个 skill 目录的位置。认三种写法：
 *   https://github.com/owner/repo/tree/<ref>/<path>   （浏览器地址栏里直接复制）
 *   owner/repo@<ref>:<path>                          （与后端 origin_ref 同一种写法）
 *   owner/repo                                        （仓库根就是 skill）
 * 解析不出来返回 null。
 */
function parseGithubSkillRef(raw: string): { owner: string; repo: string; ref?: string; path?: string } | null {
  const t = raw.trim().replace(/\/+$/, '');
  const url = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/(.+))?)?$/i.exec(t);
  if (url) {
    const path = url[4]?.replace(/\/SKILL\.md$/i, '');
    return { owner: url[1], repo: url[2].replace(/\.git$/i, ''), ref: url[3], path: path || undefined };
  }
  const short = /^([\w.-]+)\/([\w.-]+)(?:@([^:\s]+))?(?::(.+))?$/.exec(t);
  if (short) return { owner: short[1], repo: short[2], ref: short[3], path: short[4] };
  return null;
}

export default function SkillListPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRef, setImportRef] = useState('');

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

  const importMut = useMutation({
    mutationFn: skillApi.importFromGithub,
    onSuccess: (s) => {
      message.success(`已导入「${s.name}」`);
      setImportOpen(false);
      setImportRef('');
      refresh();
    },
    onError: (err: { message?: string }) => message.error(err?.message || '导入失败'),
  });
  const parsedImport = parseGithubSkillRef(importRef);

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
            <Button icon={<GithubOutlined />} onClick={() => setImportOpen(true)}>
              从 GitHub 导入
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
          onContinue={(sessionId: string) => navigate(`/console/skill/builder?session=${sessionId}`)}
        />

        <Modal
          title="从 GitHub 导入 Skill"
          open={importOpen}
          okText="导入"
          cancelText="取消"
          confirmLoading={importMut.isPending}
          okButtonProps={{ disabled: !parsedImport }}
          onOk={() => parsedImport && importMut.mutate(parsedImport)}
          onCancel={() => setImportOpen(false)}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            粘贴 skill 目录的 GitHub 地址（例如 https://github.com/anthropics/skills/tree/main/skills/pdf），
            或写成 owner/repo@分支:路径。导入后可以在详情里「用 AI 改进」它。
          </Typography.Paragraph>
          <Input
            value={importRef}
            onChange={(e) => setImportRef(e.target.value)}
            placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
            onPressEnter={() => parsedImport && importMut.mutate(parsedImport)}
          />
          {importRef.trim() && (
            <Typography.Text type={parsedImport ? 'secondary' : 'danger'} style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              {parsedImport
                ? `仓库 ${parsedImport.owner}/${parsedImport.repo}` +
                  (parsedImport.ref ? ` · 分支 ${parsedImport.ref}` : ' · 默认分支') +
                  (parsedImport.path ? ` · 路径 ${parsedImport.path}` : ' · 仓库根目录')
                : '认不出这个地址：请粘贴 GitHub 目录链接，或写成 owner/repo@分支:路径'}
            </Typography.Text>
          )}
        </Modal>

        <SkillDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      </div>
    </SkillTheme>
  );
}
