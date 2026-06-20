# Skill 管理与详情 UI 重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Skill 列表页改成卡片网格、把详情抽屉重做成 sticky 头部 + 轻量元数据 + SKILL.md + 文件 tab 查看器,整体走 slate/navy 克制高级感,仅作用于 Skill 页面。

**Architecture:** 纯前端视觉/交互重做。用嵌套 `ConfigProvider`（`SkillTheme`）把令牌罩在 Skill 子树;抽离 `features/skill/meta.tsx` 做 label/color 单一来源并导出芯片/状态点组件;新增 `SkillCard`/`SkillCardGrid`/`SkillDetailHeader`/`FileTabsViewer` 表现组件;`SkillListPage`/`SkillDetailDrawer` 收敛为薄壳。不改 `api.ts`/`types.ts`、不改后端。

**Tech Stack:** React 18 + TS + Vite 5 + Ant Design 5.21 + @tanstack/react-query。**本仓库无测试框架**（见 `CLAUDE.md`）,每个任务用 `npm run typecheck` + `npm run lint`（`--max-warnings 0`）作为验证门,最后在 docker `:8082` 实跑(jerry 硬性要求,非 vite :5173)。

**Spec:** `docs/superpowers/specs/2026-06-20-skill-management-ui-redesign-design.md`

---

## File Structure

新建:

- `src/features/skill/meta.tsx` — label/color 单一来源 + `SkillTypeChip`/`SkillScopeChip`/`SkillStatusDot`
- `src/features/skill/SkillTheme.tsx` — 作用域 `ConfigProvider`
- `src/pages/console/skill/skill.css` — 仅 Skill 页面的卡片 hover / 代码块 / 行截断样式
- `src/pages/console/skill/components/SkillCard.tsx`
- `src/pages/console/skill/components/SkillCardGrid.tsx`
- `src/pages/console/skill/components/SkillDetailHeader.tsx`
- `src/pages/console/skill/components/FileTabsViewer.tsx`

改写:

- `src/pages/console/skill/SkillListPage.tsx` — Table → 卡片网格 + 工具条(搜索/类型/状态)
- `src/pages/console/skill/SkillDetailDrawer.tsx` — Descriptions/Collapse → 新结构

不动:`src/features/skill/api.ts`、`src/features/skill/types.ts`、后端。

---

### Task 1: meta 单一来源 + 芯片/状态点组件

**Files:**

- Create: `src/features/skill/meta.tsx`

- [ ] **Step 1: 写 `src/features/skill/meta.tsx`**

```tsx
import type { SkillView } from './types';

type SkillType = SkillView['skillType']; // 'PROMPT' | 'DOER'
type SkillScope = SkillView['scope']; // 'PRIVATE' | 'TENANT'
type SkillStatus = SkillView['status']; // 'DRAFT' | 'ACTIVE' | 'DISABLED'
type SkillSource = SkillView['source']; // 'UPLOAD' | 'MARKET' | 'AI_GEN'

export const TYPE_LABEL: Record<SkillType, string> = { PROMPT: 'Prompt', DOER: 'Doer' };
export const SCOPE_LABEL: Record<SkillScope, string> = { PRIVATE: '私有', TENANT: '团队共享' };
export const STATUS_LABEL: Record<SkillStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '启用',
  DISABLED: '停用',
};
export const SOURCE_LABEL: Record<SkillSource, string> = {
  UPLOAD: '上传',
  MARKET: '市场',
  AI_GEN: 'AI 生成',
};

const STATUS_DOT: Record<SkillStatus, string> = {
  ACTIVE: '#10B981',
  DISABLED: '#94A3B8',
  DRAFT: '#F59E0B',
};

const TYPE_STYLE: Record<SkillType, { color: string; bg: string; border: string }> = {
  DOER: { color: '#4338CA', bg: '#EEF2FF', border: '#C7D2FE' },
  PROMPT: { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
};

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: '0 8px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 6,
  lineHeight: 1,
};

export function SkillTypeChip({ type }: { type: SkillType }) {
  const s = TYPE_STYLE[type] ?? TYPE_STYLE.PROMPT;
  return (
    <span
      style={{ ...chipBase, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

export function SkillScopeChip({ scope }: { scope: SkillScope }) {
  const tenant = scope === 'TENANT';
  return (
    <span
      style={{
        ...chipBase,
        color: tenant ? '#0369A1' : '#475569',
        background: tenant ? '#F0F9FF' : '#F1F5F9',
        border: `1px solid ${tenant ? '#BAE6FD' : '#E2E8F0'}`,
      }}
    >
      {SCOPE_LABEL[scope] ?? scope}
    </span>
  );
}

export function SkillStatusDot({ status }: { status: SkillStatus }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        color: '#475569',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: STATUS_DOT[status] ?? '#94A3B8',
          flex: 'none',
        }}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过(无错误)。`meta.tsx` 使用 JSX,扩展名 `.tsx` 必需。

- [ ] **Step 3: 提交**

```bash
git add src/features/skill/meta.tsx
git commit -m "feat(skill): add meta single-source labels/colors + chip/dot components"
```

---

### Task 2: SkillTheme 作用域主题

**Files:**

- Create: `src/features/skill/SkillTheme.tsx`

- [ ] **Step 1: 写 `src/features/skill/SkillTheme.tsx`**

```tsx
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';

// 仅作用于 Skill 页面的 slate/navy 令牌。嵌套在全局 ConfigProvider 之内,不影响其它模块。
// 注意:Drawer 默认 portal 到 body,处于本 provider 子树之外,抽屉内容需单独再包一层 SkillTheme。
export default function SkillTheme({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#0F172A',
          colorInfo: '#0369A1',
          colorBorderSecondary: '#E2E8F0',
          colorText: '#0F172A',
          colorTextSecondary: '#64748B',
          borderRadius: 8,
        },
        components: {
          Card: { borderRadiusLG: 12 },
          Segmented: { itemSelectedBg: '#0F172A', itemSelectedColor: '#FFFFFF' },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/features/skill/SkillTheme.tsx
git commit -m "feat(skill): add scoped SkillTheme ConfigProvider (slate/navy)"
```

---

### Task 3: Skill 页面作用域 CSS

**Files:**

- Create: `src/pages/console/skill/skill.css`

- [ ] **Step 1: 写 `src/pages/console/skill/skill.css`**

```css
/* 仅 Skill 列表/详情用到的样式:卡片 hover、操作淡入、2 行截断、代码块、Markdown 行宽 */
.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.skill-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition:
    box-shadow 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;
}
.skill-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 6px 20px -8px rgba(15, 23, 42, 0.18);
  transform: translateY(-2px);
}
.skill-card:focus-visible {
  outline: 2px solid #0f172a;
  outline-offset: 2px;
}

.skill-card__desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
  min-height: 39px;
}

.skill-card__actions {
  opacity: 0;
  transition: opacity 160ms ease;
}
.skill-card:hover .skill-card__actions,
.skill-card:focus-within .skill-card__actions {
  opacity: 1;
}

.skill-code {
  margin: 0;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  font-family:
    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  white-space: pre;
  overflow-x: auto;
  max-height: 480px;
}

.skill-frontmatter {
  margin: 0 0 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #eef2f6;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  font-family:
    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: #64748b;
}

.skill-md-body {
  max-width: 72ch;
}

@media (prefers-reduced-motion: reduce) {
  .skill-card {
    transition:
      box-shadow 160ms ease,
      border-color 160ms ease;
  }
  .skill-card:hover {
    transform: none;
  }
  .skill-card__actions {
    opacity: 1;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/pages/console/skill/skill.css
git commit -m "feat(skill): add scoped skill.css for card/code/markdown styling"
```

---

### Task 4: SkillCard 卡片组件

**Files:**

- Create: `src/pages/console/skill/components/SkillCard.tsx`

- [ ] **Step 1: 写 `src/pages/console/skill/components/SkillCard.tsx`**

```tsx
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
import { SkillScopeChip, SkillStatusDot, SkillTypeChip, SOURCE_LABEL } from '@/features/skill/meta';

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
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run typecheck && npm run lint`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/console/skill/components/SkillCard.tsx
git commit -m "feat(skill): add SkillCard with hover actions and overflow menu"
```

---

### Task 5: SkillCardGrid（网格 + 骨架 + 空态）

**Files:**

- Create: `src/pages/console/skill/components/SkillCardGrid.tsx`

- [ ] **Step 1: 写 `src/pages/console/skill/components/SkillCardGrid.tsx`**

```tsx
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
          {filteredEmpty && <a onClick={onClearFilters}>清除筛选</a>}
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
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run typecheck && npm run lint`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/console/skill/components/SkillCardGrid.tsx
git commit -m "feat(skill): add SkillCardGrid with skeleton and empty states"
```

---

### Task 6: 改写 SkillListPage（卡片网格 + 工具条）

**Files:**

- Modify: `src/pages/console/skill/SkillListPage.tsx`（全量替换）

- [ ] **Step 1: 全量替换 `src/pages/console/skill/SkillListPage.tsx`**

```tsx
import { useMemo, useRef, useState } from 'react';
import { App, Button, Input, Segmented, Select, Space, Typography } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { skillApi } from '@/features/skill/api';
import type { SkillView } from '@/features/skill/types';
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

  function mkMut(fn: (id: string) => Promise<unknown>, ok: string) {
    return useMutation({
      mutationFn: fn,
      onSuccess: () => {
        message.success(ok);
        refresh();
      },
      onError: (err: { message?: string }) => message.error(err?.message || '操作失败'),
    });
  }

  const uploadMut = useMutation({
    mutationFn: skillApi.upload,
    onSuccess: () => {
      message.success('上传成功');
      refresh();
    },
    onError: (err: { message?: string }) => message.error(err?.message || '上传失败'),
  });
  const shareMut = mkMut(skillApi.share, '已共享给团队');
  const unshareMut = mkMut(skillApi.unshare, '已取消共享');
  const enableMut = mkMut(skillApi.enable, '已启用');
  const disableMut = mkMut(skillApi.disable, '已停用');
  const removeMut = mkMut(skillApi.remove, '已删除');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMut.mutate(file);
    e.target.value = '';
  }

  return (
    <SkillTheme>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: '#F8FAFC',
          margin: -24,
          padding: 24,
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

        {/* 网格 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
        </div>

        <SkillDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      </div>
    </SkillTheme>
  );
}

// 避免未使用类型告警(SkillView 由子组件使用,这里仅做类型锚点)
export type { SkillView };
```

> 实现说明:`mkMut` 在组件体内调用 `useMutation`,顺序固定(每次渲染调用次数一致),符合 Hooks 规则。若 ESLint 的 `react-hooks/rules-of-hooks` 对「自定义函数内调用 hook」报错,把 `mkMut` 改名为 `useSkillMut` 即可(以 `use` 开头,eslint 视为自定义 hook)。**优先用 `useSkillMut` 命名以规避告警。**

- [ ] **Step 2: 若 lint 对 `mkMut` 报 hooks 告警,改名为 `useSkillMut`**

把 `function mkMut(` 改为 `function useSkillMut(`,并把三处 `mkMut(` 调用同步改为 `useSkillMut(`。删除末尾 `export type { SkillView };`(若 `SkillView` 已无未使用告警)。

- [ ] **Step 3: 类型检查 + lint**

Run: `npm run typecheck && npm run lint`
Expected: 通过(`--max-warnings 0`)。重点确认无 `react-hooks/rules-of-hooks`、无未使用变量告警。

- [ ] **Step 4: 提交**

```bash
git add src/pages/console/skill/SkillListPage.tsx
git commit -m "feat(skill): rewrite list page as card grid with search/type/status filters"
```

---

### Task 7: SkillDetailHeader（抽屉 sticky 头部）

**Files:**

- Create: `src/pages/console/skill/components/SkillDetailHeader.tsx`

- [ ] **Step 1: 写 `src/pages/console/skill/components/SkillDetailHeader.tsx`**

```tsx
import { Button, Popconfirm, Space, Typography } from 'antd';
import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { SkillDetailView } from '@/features/skill/types';
import { SkillScopeChip, SkillStatusDot, SkillTypeChip } from '@/features/skill/meta';

interface Props {
  skill: SkillDetailView;
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
      </div>

      {s.description && (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
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
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run typecheck && npm run lint`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/console/skill/components/SkillDetailHeader.tsx
git commit -m "feat(skill): add SkillDetailHeader with chips and contextual actions"
```

---

### Task 8: FileTabsViewer（文件 tab + 代码查看器）

**Files:**

- Create: `src/pages/console/skill/components/FileTabsViewer.tsx`

- [ ] **Step 1: 写 `src/pages/console/skill/components/FileTabsViewer.tsx`**

```tsx
import { App, Button, Empty, Tabs, Tooltip, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import Markdown from '@/components/Markdown';
import type { SkillFileView } from '@/features/skill/types';

// size 后端按字符串下发,展示前 Number() 兜底(见 jm-api-numbers-as-strings 约定)
function fmtSize(size: string | number): string {
  const n = Number(size);
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileBody({ file }: { file: SkillFileView }) {
  const { message } = App.useApp();
  if (file.binary) {
    return <Typography.Text type="secondary">（二进制文件,不支持预览）</Typography.Text>;
  }
  const content = file.content ?? '';
  const isMd = file.path.toLowerCase().endsWith('.md');

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {fmtSize(file.size)}
          {file.truncated && ' · 文件较大,仅展示前 512KB'}
        </Typography.Text>
        <Tooltip title="复制">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(content);
              message.success('已复制');
            }}
          />
        </Tooltip>
      </div>
      {isMd ? (
        <div className="skill-md-body">
          <Markdown content={content} />
        </div>
      ) : (
        <pre className="skill-code">{content}</pre>
      )}
    </>
  );
}

export default function FileTabsViewer({ files }: { files: SkillFileView[] }) {
  if (files.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无脚本文件" />;
  }
  return (
    <Tabs
      type="line"
      items={files.map((f) => ({
        key: f.path,
        label: f.path,
        children: <FileBody file={f} />,
      }))}
    />
  );
}
```

> 说明:规范里「文件 > 6 个降级为左列表+右内容」属增强项;`Tabs` 自带 `more` 折叠超出的标签,先用 tab 满足主路径。若后续要严格两栏,在本组件内按 `files.length > 6` 分支即可,接口不变。

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run typecheck && npm run lint`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/console/skill/components/FileTabsViewer.tsx
git commit -m "feat(skill): add FileTabsViewer (tabbed code/markdown viewer)"
```

---

### Task 9: 改写 SkillDetailDrawer（组合新结构）

**Files:**

- Modify: `src/pages/console/skill/SkillDetailDrawer.tsx`（全量替换）

- [ ] **Step 1: 全量替换 `src/pages/console/skill/SkillDetailDrawer.tsx`**

```tsx
import { App, Button, Drawer, Spin, Tooltip, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { skillApi } from '@/features/skill/api';
import SkillTheme from '@/features/skill/SkillTheme';
import { SOURCE_LABEL } from '@/features/skill/meta';
import Markdown from '@/components/Markdown';
import SkillDetailHeader from './components/SkillDetailHeader';
import FileTabsViewer from './components/FileTabsViewer';
import './skill.css';

interface Props {
  id: string | null;
  onClose: () => void;
}

function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '24px 0 12px',
      }}
    >
      <Typography.Text strong style={{ fontSize: 13, color: '#475569' }}>
        {children}
      </Typography.Text>
      {extra}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
      <span style={{ width: 64, flex: 'none', fontSize: 13, color: '#64748B' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1E293B', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

export default function SkillDetailDrawer({ id, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'detail', id],
    queryFn: () => skillApi.get(id!),
    enabled: !!id,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['skill', 'list'] });
    qc.invalidateQueries({ queryKey: ['skill', 'detail', id] });
  }
  function mut(fn: (id: string) => Promise<unknown>, ok: string) {
    return () =>
      fn(id!)
        .then(() => {
          message.success(ok);
          refresh();
        })
        .catch((e: { message?: string }) => message.error(e?.message || '操作失败'));
  }

  const removeMut = useMutation({
    mutationFn: () => skillApi.remove(id!),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      onClose();
    },
    onError: (e: { message?: string }) => message.error(e?.message || '删除失败'),
  });

  const files = data?.files ?? [];
  const frontmatter = data
    ? `---\nname: ${data.name}\ndescription: ${data.description || ''}\n---`
    : '';
  const fullSkillMd = data ? `${frontmatter}\n\n${data.body || ''}` : '';

  return (
    <Drawer
      width={840}
      open={!!id}
      onClose={onClose}
      title={
        data ? (
          <SkillTheme>
            <SkillDetailHeader
              skill={data}
              onShare={mut(skillApi.share, '已共享给团队')}
              onUnshare={mut(skillApi.unshare, '已取消共享')}
              onEnable={mut(skillApi.enable, '已启用')}
              onDisable={mut(skillApi.disable, '已停用')}
              onRemove={() => removeMut.mutate()}
            />
          </SkillTheme>
        ) : (
          'Skill 详情'
        )
      }
    >
      <SkillTheme>
        {isLoading ? (
          <Spin />
        ) : data ? (
          <>
            {/* 元数据条 */}
            <div
              style={{
                padding: '4px 16px',
                background: '#F8FAFC',
                border: '1px solid #EEF2F6',
                borderRadius: 8,
              }}
            >
              <MetaRow label="来源" value={SOURCE_LABEL[data.source] ?? data.source} />
              <MetaRow
                label="所有人"
                value={
                  <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
                    {data.ownerUserId}
                  </span>
                }
              />
            </div>

            {/* SKILL.md */}
            <SectionTitle
              extra={
                <Tooltip title="复制完整 SKILL.md">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(fullSkillMd);
                      message.success('已复制');
                    }}
                  />
                </Tooltip>
              }
            >
              SKILL.md
            </SectionTitle>
            <pre className="skill-frontmatter">{frontmatter}</pre>
            {data.body ? (
              <div className="skill-md-body">
                <Markdown content={data.body} />
              </div>
            ) : (
              <Typography.Text type="secondary">无正文</Typography.Text>
            )}

            {/* 文件(仅 DOER) */}
            {data.skillType === 'DOER' && (
              <>
                <SectionTitle>文件 {files.length > 0 && `(${files.length})`}</SectionTitle>
                <FileTabsViewer files={files} />
              </>
            )}
          </>
        ) : null}
      </SkillTheme>
    </Drawer>
  );
}
```

> 关键点:`Drawer` portal 到 body,所以 `title` 与 body 各自再包一层 `<SkillTheme>`(规范里强调的坑)。删除后关闭抽屉并刷新列表。

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run typecheck && npm run lint`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/console/skill/SkillDetailDrawer.tsx
git commit -m "feat(skill): rebuild detail drawer (sticky header, light meta, SKILL.md, file tabs)"
```

---

### Task 10: 整体构建 + :8082 实测验收

**Files:** 无(验证任务)

- [ ] **Step 1: 全量构建(含类型检查)**

Run: `npm run build`
Expected: `tsc -b && vite build` 成功,无类型错误、无 lint 阻断。

- [ ] **Step 2: 在 docker :8082 重建容器并实测**

按 jerry 约定:改完前端必须重建容器才能在 `:8082` 看到(见 jm-frontend-verify-on-8082)。重建前端容器后,逐项核对:

- 列表:卡片网格渲染、`auto-fill` 自适应换行;搜索框过滤名称/描述;类型/状态下拉过滤;`全部可见/我创建的` 切换。
- 卡片:hover 上浮 + 操作淡入;`查看` 打开抽屉;`⋯` 菜单 共享/取消共享、启用/停用(确认弹窗)、删除(危险确认)。
- 状态:加载时 6 张骨架卡;无数据空态;筛选无命中空态 + 「清除筛选」。
- 详情抽屉:宽 840;sticky 头部(滚动 SKILL.md 时标题/操作常驻);芯片+状态点;头部 共享/启停/删除可用且 toast 正确;删除后抽屉关闭、列表刷新。
- 元数据条:来源、所有人 ID(等宽);SKILL.md frontmatter 块 + Markdown 正文;复制按钮 toast。
- 文件区(DOER):tab 切换;`.md` 渲 Markdown、其它走代码块;大小显示;复制 toast;二进制/截断提示;PROMPT 类型不显示文件区。
- 主题作用域:其它模块(agent/plugin/knowledge)观感不变(全局未被污染)。

- [ ] **Step 3: 验收无误后(可选)合并回 main**

按分支约定(feat/ 完成后合并 main,见 jm-branch-workflow),自测通过后再合并。本步骤等 jerry 确认。

---

## Self-Review

**1. Spec coverage（逐条对照 spec）:**

- §2.1 作用域 + Drawer portal 坑 → Task 2(SkillTheme)+ Task 9(title/body 双层包裹)✓
- §2.2 令牌 → Task 2 ✓
- §2.3 语义色（点+文字/类型芯片/范围芯片/来源文字）→ Task 1 ✓
- §3 卡片网格（标题区/工具条/搜索筛选/卡片解剖/空态/骨架）→ Task 4/5/6 ✓
- §4 抽屉（840/ sticky 头部/轻量元数据/SKILL.md/文件 tab）→ Task 7/8/9 ✓
- §5 meta 去重小重构 → Task 1 + 各组件引用 ✓
- §6 组件清单 → Task 1/2/4/5/7/8 全覆盖 ✓
- §7 A11y（点+文字/aria-label/focus-visible/reduced-motion/复制 toast）→ Task 1/3/4/8/9 ✓
- §9 验收（typecheck/lint/:8082）→ 各任务 + Task 10 ✓

**2. Placeholder scan:** 无 TODO/TBD;每步含完整可编译代码与确切命令。`mkMut` 的 hooks 告警已给确定的「改名 `useSkillMut`」处置方案,非占位。

**3. Type consistency:**

- `SkillView` / `SkillDetailView` / `SkillFileView` 均来自 `@/features/skill/types`,字段(`skillType`/`scope`/`status`/`source`/`version`/`ownerUserId`/`body`/`files`/`size`/`binary`/`truncated`/`content`/`path`)与 `types.ts` 一致 ✓
- 芯片/状态点 props:`SkillTypeChip{type}`、`SkillScopeChip{scope}`、`SkillStatusDot{status}` 在 meta 定义,卡片/头部调用一致 ✓
- `skillApi` 方法签名(`share/unshare/enable/disable/remove(id)`、`upload(file)`、`get(id)`)与 `api.ts` 一致 ✓
- `SkillCard`/`SkillCardGrid` 的 `onView/onShare/onUnshare/onEnable/onDisable/onRemove` 回调签名(`(id: string) => void`)上下游一致 ✓
