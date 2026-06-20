# Skill Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tenant Skill management UI (list, detail drawer, GitHub import modal) mirroring the existing plugin feature in this React+TS+Vite+Ant Design 5 app.

**Architecture:** Three files under `src/features/skill/` (types + api) and three under `src/pages/console/skill/` (SkillListPage + SkillDetailDrawer + ImportSkillModal), then wired into the router and sidebar nav. API layer uses the same `get/post/del/upload` helpers from `@/api/client` that plugin/api.ts uses.

**Tech Stack:** React 18, TypeScript, Ant Design 5 (`App`, `Table`, `Drawer`, `Modal`, `Form`, `Segmented`, `Tag`, `Button`, `Popconfirm`, `Tooltip`, `Space`, `Typography`, `Input`), TanStack Query v5 (`useQuery`, `useMutation`, `useQueryClient`), React Router v6 (`useNavigate`, `lazy`).

---

## File Map

| File                                            | Action | Responsibility                                                 |
| ----------------------------------------------- | ------ | -------------------------------------------------------------- |
| `src/features/skill/types.ts`                   | CREATE | `SkillView` interface                                          |
| `src/features/skill/api.ts`                     | CREATE | `skillApi` — all 9 endpoint calls                              |
| `src/pages/console/skill/SkillListPage.tsx`     | CREATE | Table + toolbar + filter toggle + action column                |
| `src/pages/console/skill/SkillDetailDrawer.tsx` | CREATE | Drawer showing SkillView metadata                              |
| `src/pages/console/skill/ImportSkillModal.tsx`  | CREATE | Modal form: owner/repo/ref/path → `skillApi.importGithub`      |
| `src/router/index.tsx`                          | MODIFY | Add `/console/skills` + `/console/skill/builder` (stub) routes |
| `src/components/atlas/workbenchNav.ts`          | MODIFY | Add "技能" nav item                                            |

---

### Task 1: `src/features/skill/types.ts`

**Files:**

- Create: `src/features/skill/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/features/skill/types.ts
export interface SkillView {
  id: string;
  name: string;
  description: string;
  scope: 'PRIVATE' | 'TENANT';
  skillType: 'PROMPT' | 'DOER';
  source: 'UPLOAD' | 'MARKET' | 'AI_GEN';
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  ownerUserId: string;
  version: number;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck`
Expected: no errors (file is a pure type declaration, nothing to fail).

---

### Task 2: `src/features/skill/api.ts`

**Files:**

- Create: `src/features/skill/api.ts`

- [ ] **Step 1: Create the API client**

```typescript
// src/features/skill/api.ts
import { del, get, post, upload } from '@/api/client';
import type { SkillView } from './types';

export interface ImportGithubPayload {
  owner: string;
  repo: string;
  ref: string;
  path?: string;
}

export const skillApi = {
  list: (mine?: boolean) =>
    get<SkillView[]>('/tenant/skills', mine !== undefined ? { mine } : undefined),

  get: (id: string) => get<SkillView>(`/tenant/skills/${id}`),

  upload: (file: File) => upload<SkillView>('/tenant/skills/upload', file, 'file'),

  importGithub: (payload: ImportGithubPayload) => post<SkillView>('/tenant/skills/import', payload),

  share: (id: string) => post<void>(`/tenant/skills/${id}/share`),
  unshare: (id: string) => post<void>(`/tenant/skills/${id}/unshare`),
  enable: (id: string) => post<void>(`/tenant/skills/${id}/enable`),
  disable: (id: string) => post<void>(`/tenant/skills/${id}/disable`),
  remove: (id: string) => del<void>(`/tenant/skills/${id}`),
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front
git add src/features/skill/types.ts src/features/skill/api.ts
git commit -m "$(cat <<'EOF'
feat(skill-ui): skill api client + types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `src/pages/console/skill/SkillDetailDrawer.tsx`

**Files:**

- Create: `src/pages/console/skill/SkillDetailDrawer.tsx`

- [ ] **Step 1: Create the detail drawer**

```typescript
// src/pages/console/skill/SkillDetailDrawer.tsx
import { Drawer, Descriptions, Tag, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { skillApi } from '@/features/skill/api';

interface Props {
  id: string | null;
  onClose: () => void;
}

const SCOPE_LABEL: Record<string, string> = { PRIVATE: '私有', TENANT: '团队共享' };
const SCOPE_COLOR: Record<string, string> = { PRIVATE: 'default', TENANT: 'blue' };
const TYPE_LABEL: Record<string, string> = { PROMPT: 'Prompt', DOER: 'Doer' };
const TYPE_COLOR: Record<string, string> = { PROMPT: 'purple', DOER: 'orange' };
const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', ACTIVE: '启用', DISABLED: '停用' };
const STATUS_COLOR: Record<string, string> = { DRAFT: 'default', ACTIVE: 'green', DISABLED: 'red' };
const SOURCE_LABEL: Record<string, string> = { UPLOAD: '上传', MARKET: '市场', AI_GEN: 'AI 生成' };

export default function SkillDetailDrawer({ id, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'detail', id],
    queryFn: () => skillApi.get(id!),
    enabled: !!id,
  });

  return (
    <Drawer
      title="Skill 详情"
      open={!!id}
      onClose={onClose}
      width={480}
    >
      {isLoading ? (
        <Spin />
      ) : data ? (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="名称">{data.name}</Descriptions.Item>
          <Descriptions.Item label="描述">{data.description || '—'}</Descriptions.Item>
          <Descriptions.Item label="类型">
            <Tag color={TYPE_COLOR[data.skillType]}>{TYPE_LABEL[data.skillType] ?? data.skillType}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="范围">
            <Tag color={SCOPE_COLOR[data.scope]}>{SCOPE_LABEL[data.scope] ?? data.scope}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="来源">{SOURCE_LABEL[data.source] ?? data.source}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS_COLOR[data.status]}>{STATUS_LABEL[data.status] ?? data.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="版本">{data.version}</Descriptions.Item>
          <Descriptions.Item label="所有人 ID">{data.ownerUserId}</Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck`
Expected: no errors.

---

### Task 4: `src/pages/console/skill/ImportSkillModal.tsx`

**Files:**

- Create: `src/pages/console/skill/ImportSkillModal.tsx`

- [ ] **Step 1: Create the import modal**

```typescript
// src/pages/console/skill/ImportSkillModal.tsx
import { Modal, Form, Input, App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { skillApi, type ImportGithubPayload } from '@/features/skill/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ImportSkillModal({ open, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<ImportGithubPayload>();

  const importMut = useMutation({
    mutationFn: skillApi.importGithub,
    onSuccess: (skill) => {
      const note =
        skill.skillType === 'DOER'
          ? '导入成功，DOER 类型需在沙箱运行后方可使用'
          : '导入成功，PROMPT 类型可立即使用';
      message.success(note);
      qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      form.resetFields();
      onClose();
    },
    onError: (err: { message?: string }) => {
      message.error(err?.message || '导入失败');
    },
  });

  return (
    <Modal
      title="从 GitHub 导入 Skill"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => form.submit()}
      confirmLoading={importMut.isPending}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ref: 'main' }}
        onFinish={(v) => importMut.mutate(v)}
      >
        <Form.Item label="仓库所有人 (owner)" name="owner" rules={[{ required: true, message: '请填写 owner' }]}>
          <Input placeholder="e.g. my-org" />
        </Form.Item>
        <Form.Item label="仓库名 (repo)" name="repo" rules={[{ required: true, message: '请填写 repo' }]}>
          <Input placeholder="e.g. my-skills" />
        </Form.Item>
        <Form.Item label="分支 / Tag (ref)" name="ref" rules={[{ required: true, message: '请填写 ref' }]}>
          <Input placeholder="main" />
        </Form.Item>
        <Form.Item label="文件路径 (path，可选)" name="path">
          <Input placeholder="skills/my-skill.md" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck`
Expected: no errors.

---

### Task 5: `src/pages/console/skill/SkillListPage.tsx`

**Files:**

- Create: `src/pages/console/skill/SkillListPage.tsx`

- [ ] **Step 1: Create the list page**

```typescript
// src/pages/console/skill/SkillListPage.tsx
import { useRef, useState } from 'react';
import {
  App,
  Button,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { skillApi } from '@/features/skill/api';
import type { SkillView } from '@/features/skill/types';
import SkillDetailDrawer from './SkillDetailDrawer';
import ImportSkillModal from './ImportSkillModal';

const { Title, Text } = Typography;

type FilterKey = 'ALL' | 'MINE';

const SCOPE_LABEL: Record<string, string> = { PRIVATE: '私有', TENANT: '团队' };
const SCOPE_COLOR: Record<string, string> = { PRIVATE: 'default', TENANT: 'blue' };
const TYPE_LABEL: Record<string, string> = { PROMPT: 'Prompt', DOER: 'Doer' };
const TYPE_COLOR: Record<string, string> = { PROMPT: 'purple', DOER: 'orange' };
const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', ACTIVE: '启用', DISABLED: '停用' };
const STATUS_COLOR: Record<string, string> = { DRAFT: 'default', ACTIVE: 'green', DISABLED: 'red' };
const SOURCE_LABEL: Record<string, string> = { UPLOAD: '上传', MARKET: '市场', AI_GEN: 'AI 生成' };

export default function SkillListPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const mine = filter === 'MINE' ? true : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'list', filter],
    queryFn: () => skillApi.list(mine),
  });

  const skills = data ?? [];

  function refresh() {
    qc.invalidateQueries({ queryKey: ['skill', 'list'] });
  }

  const uploadMut = useMutation({
    mutationFn: skillApi.upload,
    onSuccess: () => { message.success('上传成功'); refresh(); },
    onError: (err: { message?: string }) => { message.error(err?.message || '上传失败'); },
  });

  const shareMut = useMutation({
    mutationFn: skillApi.share,
    onSuccess: () => { message.success('已共享给团队'); refresh(); },
    onError: (err: { message?: string }) => { message.error(err?.message || '操作失败'); },
  });

  const unshareMut = useMutation({
    mutationFn: skillApi.unshare,
    onSuccess: () => { message.success('已取消共享'); refresh(); },
    onError: (err: { message?: string }) => { message.error(err?.message || '操作失败'); },
  });

  const enableMut = useMutation({
    mutationFn: skillApi.enable,
    onSuccess: () => { message.success('已启用'); refresh(); },
    onError: (err: { message?: string }) => { message.error(err?.message || '操作失败'); },
  });

  const disableMut = useMutation({
    mutationFn: skillApi.disable,
    onSuccess: () => { message.success('已停用'); refresh(); },
    onError: (err: { message?: string }) => { message.error(err?.message || '操作失败'); },
  });

  const removeMut = useMutation({
    mutationFn: skillApi.remove,
    onSuccess: () => { message.success('已删除'); refresh(); },
    onError: (err: { message?: string }) => { message.error(err?.message || '删除失败'); },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMut.mutate(file);
    e.target.value = '';
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 表头：标题 + 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            技能 (Skills)
          </Title>
          <Text type="secondary">
            管理租户 Skill · 共 {skills.length} 个
          </Text>
        </div>
        <Space>
          <Button onClick={() => navigate('/console/skill/builder')}>AI 生成</Button>
          <Button onClick={() => setImportOpen(true)}>从 GitHub 导入</Button>
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

      {/* 筛选行 */}
      <div style={{ margin: '16px 0 12px' }}>
        <Segmented<FilterKey>
          value={filter}
          onChange={(v) => setFilter(v)}
          options={[
            { label: '全部可见', value: 'ALL' },
            { label: '我创建的', value: 'MINE' },
          ]}
        />
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Table<SkillView>
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={skills}
          scroll={{ y: 'calc(100vh - 300px)' }}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 个`,
          }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              ellipsis: true,
              render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
            },
            {
              title: '描述',
              dataIndex: 'description',
              ellipsis: true,
              render: (v?: string) => <Text type="secondary">{v || '—'}</Text>,
            },
            {
              title: '类型',
              dataIndex: 'skillType',
              width: 100,
              render: (v: string) => (
                <Tag color={TYPE_COLOR[v]}>{TYPE_LABEL[v] ?? v}</Tag>
              ),
            },
            {
              title: '来源',
              dataIndex: 'source',
              width: 100,
              render: (v: string) => SOURCE_LABEL[v] ?? v,
            },
            {
              title: '范围',
              dataIndex: 'scope',
              width: 100,
              render: (v: string) => (
                <Tag color={SCOPE_COLOR[v]}>{SCOPE_LABEL[v] ?? v}</Tag>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => (
                <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v] ?? v}</Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 160,
              render: (_, s) => (
                <Space
                  size="middle"
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: 'default' }}
                >
                  <Tooltip title="查看详情">
                    <EyeOutlined onClick={() => setDetailId(s.id)} />
                  </Tooltip>

                  {s.scope === 'PRIVATE' ? (
                    <Tooltip title="共享给团队">
                      <ShareAltOutlined onClick={() => shareMut.mutate(s.id)} />
                    </Tooltip>
                  ) : (
                    <Tooltip title="取消共享">
                      <StopOutlined onClick={() => unshareMut.mutate(s.id)} />
                    </Tooltip>
                  )}

                  {s.status === 'ACTIVE' ? (
                    <Popconfirm title="停用该 Skill？" onConfirm={() => disableMut.mutate(s.id)}>
                      <Tooltip title="停用">
                        <PauseCircleOutlined />
                      </Tooltip>
                    </Popconfirm>
                  ) : (
                    <Popconfirm title="启用该 Skill？" onConfirm={() => enableMut.mutate(s.id)}>
                      <Tooltip title="启用">
                        <PlayCircleOutlined />
                      </Tooltip>
                    </Popconfirm>
                  )}

                  <Popconfirm
                    title="确认删除该 Skill？"
                    onConfirm={() => removeMut.mutate(s.id)}
                  >
                    <Tooltip title="删除">
                      <DeleteOutlined style={{ color: '#ff4d4f' }} />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <SkillDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      <ImportSkillModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit tasks 2–5**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front
git add src/pages/console/skill/
git commit -m "$(cat <<'EOF'
feat(skill-ui): skill list page + detail drawer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire router + nav

**Files:**

- Modify: `src/router/index.tsx`
- Modify: `src/components/atlas/workbenchNav.ts`

- [ ] **Step 1: Add routes to router**

In `src/router/index.tsx`:

1. Add lazy import near the top (after existing lazy imports):

```typescript
const SkillListPage = lazy(() => import('@/pages/console/skill/SkillListPage'));
const StubPage = lazy(() => import('@/components/StubPage'));
```

2. Add routes inside the `/console` Route, after the feedback route:

```tsx
{/* Skills: 登录态即可访问，不受模块限制 */}
<Route path="skills" element={<SkillListPage />} />
<Route path="skill/builder" element={<StubPage />} />
```

- [ ] **Step 2: Add nav item**

In `src/components/atlas/workbenchNav.ts`, add to `WORKBENCH_NAV` after the plugins entry:

```typescript
import { ..., SparklesIcon } from '@/components/icons/AtlasIcons';

// in WORKBENCH_NAV array, after plugins:
{
  key: 'skills',
  label: '技能',
  path: '/console/skills',
  Icon: SparklesIcon,
},
```

Note: check which icons are available in `src/components/icons/AtlasIcons.tsx` — if `SparklesIcon` is taken by chat, pick another (e.g. `PlayIcon` or `ListIcon`). The exact icon matters less than compiling cleanly.

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/jerry/Desktop/jm/jm-agent-front && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jerry/Desktop/jm/jm-agent-front
git add src/router/index.tsx src/components/atlas/workbenchNav.ts
git commit -m "$(cat <<'EOF'
feat(skill-ui): github import modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** types.ts (Task 1), api.ts (Task 2) with all 9 endpoints, SkillDetailDrawer (Task 3), ImportSkillModal (Task 4), SkillListPage (Task 5) with all toolbar buttons/filter/columns/actions, router+nav (Task 6).
- [x] **No placeholders:** all steps have real code.
- [x] **Type consistency:** `SkillView` defined in Task 1, imported by api.ts (Task 2), used in SkillListPage (Task 5) and SkillDetailDrawer (Task 3). `ImportGithubPayload` defined in api.ts (Task 2), imported by ImportSkillModal (Task 4).
- [x] **Router:** SkillListPage at `/console/skills`, builder stub at `/console/skill/builder`.
- [x] **Commit trailers:** all commits include `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
