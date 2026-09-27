# Agents 与数据连接工作台重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agents、数据连接和语义层改造成已确认的沉浸式工作台，在不改变后端契约与安全语义的前提下，让少于 20 个实体的管理更直观、无横向滚动，并明确草稿、发布和即时授权三种生效模型。

**Architecture:** 保持 `src/pages` 为路由壳，把卡片、工具栏、编辑 Drawer、Inspector 和语义工作台拆入既有 `features/agent` 与 `features/connector`。所有筛选在前端完成；连接 Inspector 由 URL 驱动并懒加载页签；语义枚举和模型可见性继续只从 `features/connector/semantic.ts` 派生。

**Tech Stack:** React 18、TypeScript、Vite 5、Ant Design 5、React Router 6、TanStack Query 5、现有 Playwright E2E 脚本；不新增依赖。

---

## 文件结构与并行边界

### Agents 线

- Create: `src/features/agent/components/AgentCard.tsx` — 单个 Agent 的身份、状态、主动作与更多菜单。
- Create: `src/features/agent/components/AgentListToolbar.tsx` — 搜索与状态筛选。
- Create: `src/features/agent/components/AgentEditorHeader.tsx` — 吸顶实体头与保存/发布动作。
- Create: `src/features/agent/components/AgentEditorNav.tsx` — “Agent 配置 / 即时授权”纵向导航。
- Create: `src/features/agent/components/AgentPublishSummary.tsx` — 当前发布检查摘要。
- Create: `src/features/agent/components/AgentConnectionGrantPanel.tsx` — 搜索式连接授权器与真实权限/错误反馈。
- Create: `src/features/agent/hooks/useUnsavedChangesGuard.tsx` — Data Router 下的 SPA/浏览器离开确认。
- Create: `src/features/agent/types.ts` — Agent 工作台本地视图类型。
- Create: `src/pages/console/agent/agent-workbench.css` — Agents 范围内的卡片、编辑器和响应式样式。
- Modify: `src/pages/console/agent/AgentListPage.tsx` — 查询、筛选、错误/空状态和 mutation 编排。
- Modify: `src/pages/console/agent/AgentEditorPage.tsx` — 页面布局、脏状态、离开确认和缓存失效。
- Modify: `src/features/agent/components/KnowledgeBindPanel.tsx` — 保持受控并把知识库变化纳入草稿 dirty。
- Modify: `src/features/agent/components/SkillBindPanel.tsx` — 补齐即时生效状态与错误态。
- Delete: `src/features/agent/components/ConnectorBindPanel.tsx` — 由 `AgentConnectionGrantPanel` 取代。

### 数据连接线

- Create: `src/features/connector/presentation.tsx` — 连接状态与四段安全轮廓的共享展示函数/小组件，不复制接口枚举。
- Create: `src/features/connector/components/ConnectorCard.tsx` — 连接卡和单实体 loading。
- Create: `src/features/connector/components/ConnectorSecurityProfile.tsx` — 可复用的四段账号/策略/语义/出库轮廓。
- Create: `src/features/connector/components/ConnectorListToolbar.tsx` — 搜索与治理筛选。
- Create: `src/features/connector/components/ConnectorFormDrawer.tsx` — 分区编辑、动态 schema、probe 指纹与一次性提交。
- Create: `src/features/connector/components/ConnectorInspector.tsx` — URL 驱动的 overview/schema/semantic/audit 容器。
- Create: `src/features/connector/components/ConnectorOverviewPanel.tsx` — 安全边界、能力与最近验证。
- Create: `src/pages/console/connector/connector-workbench.css` — 连接列表、Inspector、表单 Drawer 的局部样式。
- Modify: `src/pages/console/connector/ConnectorListPage.tsx` — 只保留权限、列表查询、筛选、卡片与 mutation 编排。
- Modify: `src/features/connector/components/ConnectorAuditDrawer.tsx` — 导出可嵌入的 `ConnectorAuditPanel`，保留兼容 wrapper。
- Modify: `src/features/connector/components/ConnectorSchemaDrawer.tsx` — 导出可嵌入的 `ConnectorSchemaPanel`，保留刷新归属与漂移语义。

### 语义层线

- Create: `src/features/connector/components/semantic/SemanticHeader.tsx` — 状态、coverage、档位和重跑入口。
- Create: `src/features/connector/components/semantic/SemanticScopeRail.tsx` — 固定 scope 顺序与“需关注”。
- Create: `src/features/connector/components/semantic/SemanticRowList.tsx` — 条目列表、分页与可信链摘要。
- Create: `src/features/connector/components/semantic/SemanticInspector.tsx` — 模型可见/留存不可见/信任/危险区。
- Create: `src/pages/console/connector/SemanticWorkbenchPage.tsx` — 完整语义工作台路由壳。
- Create: `src/pages/console/connector/semantic-workbench.css` — 三栏语义工作台与窄屏样式。
- Modify: `src/features/connector/components/ConnectorSemanticDrawer.tsx` — 将查询/mutation 和已有语义细节提取为可嵌入内容，Drawer 仅作兼容 wrapper。
- Modify: `src/features/connector/semantic.ts` — 仅新增“需关注”纯派生函数，保留所有现有映射为单一真相源。

### 根代理独占的共享集成文件

- Modify: `src/router/index.tsx` — 注册 `/console/connectors/:id/semantic`。
- Modify: `src/App.tsx`、`src/main.tsx` — 将现有 BrowserRouter 迁移为 Data Router，支持完整的脏状态阻断。
- Create: `src/router/SuperAdminRoute.tsx` — 超管治理入口的直链门控，权限失败时 fail-open。
- Modify: `src/pages/console/connection/ConnectionListPage.tsx`、`src/pages/console/connector/PendingWritePage.tsx` — 删除重复且假 fail-open 的页面内权限查询。
- Modify: `src/components/atlas/workbenchNav.ts` — 兼容入口改名并标记超管专属项。
- Modify: `src/components/atlas/WorkbenchSidebar.tsx` — 权限已确认非超管后隐藏治理入口，失败时 fail-open。
- Modify: `src/styles/global.css` — 只追加工作台通用 token、焦点态、reduced-motion；业务样式留在局部 CSS。
- Modify: `e2e/lib.mjs`、`e2e/connector-ui-check.mjs`、`e2e/connector-writepolicy-check.mjs`、`e2e/connector-probe-check.mjs` — 改用语义选择器和 Drawer。
- Create: `e2e/agent-workbench-check.mjs` — Agent 搜索、筛选、编辑器和脏状态实跑。
- Create: `e2e/semantic-workbench-check.mjs` — 深链、状态/coverage、scope、Inspector 和窄屏实跑。

---

### Task 1: 建立工作台通用视觉与导航权限模型

**Files:**
- Modify: `src/styles/global.css`
- Modify: `src/components/atlas/workbenchNav.ts`
- Modify: `src/components/atlas/WorkbenchSidebar.tsx`
- Create: `src/router/SuperAdminRoute.tsx`
- Modify: `src/router/index.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/pages/console/connection/ConnectionListPage.tsx`
- Modify: `src/pages/console/connector/ConnectorListPage.tsx`
- Modify: `src/pages/console/connector/PendingWritePage.tsx`

- [ ] **Step 1: 扩展导航项类型并标出超管治理入口**

在 `NavItem` 中加入 `superAdminOnly?: boolean`，将兼容入口改名并给三项治理入口加标记：

```ts
export type NavItem = {
  key: string;
  label: string;
  path: string;
  Icon: (p: { size?: number; className?: string }) => JSX.Element;
  module?: string;
  superAdminOnly?: boolean;
};

{ key: 'connections', label: 'HTTP 出站（兼容）', path: '/console/connections', Icon: PlugIcon, superAdminOnly: true }
{ key: 'connectors', label: '数据连接', path: '/console/connectors', Icon: DatabaseIcon, superAdminOnly: true }
{ key: 'pending-writes', label: '写操作审批', path: '/console/pending-writes', Icon: BellIcon, superAdminOnly: true }
```

- [ ] **Step 2: 保持权限失败 fail-open，只在成功确认非超管时隐藏**

```ts
const { data: perm, isSuccess: permissionResolved } = useQuery({
  queryKey: ['me', 'permissions'],
  queryFn: authApi.mePermissions,
  enabled: !!token,
  staleTime: 60_000,
});

const canSee = (item: NavItem) => {
  if (permissionResolved && perm && !perm.superAdmin && item.superAdminOnly) return false;
  if (!perm || perm.superAdmin) return true;
  return !item.module || perm.modules.includes(item.module);
};
```

- [ ] **Step 3: 建立真正 fail-open 的超管路由门控**

`SuperAdminRoute` 与 `ModuleRoute` 同样复用 `['me','permissions']`：加载时显示 Spin；明确非超管时显示 403；请求失败或无数据时放行，让后端继续作为安全边界。

```tsx
const allowed = !perm || perm.superAdmin;
if (!allowed) return <Result status="403" title="仅企业超管可访问" />;
return <>{children}</>;
```

将 `/console/connections`、`/console/connectors`、`/console/connectors/:id/semantic`、`/console/pending-writes` 包在该 Route 下。删除兼容页、连接页和审批页内部 `enabled: perm?.superAdmin === true` 的假 fail-open：一旦路由已放行，数据 query 必须发出；后端 403 要显示为请求错误。

- [ ] **Step 4: 同步迁移为 Data Router**

用 `createBrowserRouter(createRoutesFromElements(...))` 重建原有路由树，保留全部 `ProtectedRoute`、`ModuleRoute`、lazy/Suspense 与 404 行为；`main.tsx` 删除 `BrowserRouter`，`App.tsx` 渲染 `RouterProvider`。这一步是 Task 3 使用 `useBlocker` 完整拦截 SPA 导航的前置条件。

- [ ] **Step 5: 增加通用 workbench token、键盘焦点与 reduced-motion**

在 `:root` 增加深墨色、成功色和 160ms transition token，并追加：

```css
:root {
  --workbench-ink: #0b1220;
  --workbench-ink-soft: #111c2f;
  --workbench-cobalt: #2563eb;
  --workbench-emerald: #10b981;
  --workbench-transition: 160ms ease;
}

.workbench-focus:focus-visible,
.entity-card:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--primary) 28%, transparent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .entity-card,
  .workbench-transition {
    transition: none !important;
    transform: none !important;
  }
}
```

- [ ] **Step 6: 运行静态门禁与路由烟测并提交**

Run: `npm run typecheck && npm run lint`

Expected: 两条命令均退出 0，无 warning。

```bash
git add src/styles/global.css src/components/atlas/workbenchNav.ts src/components/atlas/WorkbenchSidebar.tsx src/router/SuperAdminRoute.tsx src/router/index.tsx src/App.tsx src/main.tsx src/pages/console/connection/ConnectionListPage.tsx src/pages/console/connector/ConnectorListPage.tsx src/pages/console/connector/PendingWritePage.tsx
git commit -m "feat: add workbench navigation foundations"
```

### Task 2: 将 Agent 列表改为可搜索的实体卡片

**Files:**
- Create: `src/features/agent/components/AgentCard.tsx`
- Create: `src/features/agent/components/AgentListToolbar.tsx`
- Create: `src/pages/console/agent/agent-workbench.css`
- Modify: `src/pages/console/agent/AgentListPage.tsx`

- [ ] **Step 1: 先给 E2E 约定稳定的语义选择器**

卡片、搜索框、筛选器与状态使用：

```tsx
<article data-testid="agent-card" data-agent-id={agent.id} />
<Input aria-label="搜索 Agent" data-testid="agent-search" />
<Segmented aria-label="筛选 Agent 状态" data-testid="agent-filter" />
<span data-testid="agent-draft-delta">有未发布更新</span>
```

- [ ] **Step 2: 实现列表工具栏的受控接口**

```ts
export type AgentListFilter = 'all' | 'unpublished' | 'draft';

interface AgentListToolbarProps {
  query: string;
  filter: AgentListFilter;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: AgentListFilter) => void;
}
```

搜索字段覆盖 `name`、`description`、`code`、`model`，匹配前统一 `toLocaleLowerCase()`。

- [ ] **Step 3: 实现 AgentCard 并收敛动作层级**

主按钮根据状态显示“继续配置 / 查看变更”，点击进入编辑器；更多菜单承载调试、分享、发布/下架、删除。`pendingAction` 只禁用当前卡：

```ts
type AgentCardAction = 'publish' | 'unpublish' | 'delete' | null;

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
```

状态同时显示 `status` 与 `hasUnpublishedChanges`；没有可从列表接口可靠得到的绑定数量时不伪造数字，只展示当前可得的模型/描述/更新时间。

- [ ] **Step 4: 重写 AgentListPage 的查询状态与前端筛选**

明确区分：

```tsx
if (query.isError && !query.data) {
  return <Result status="error" title="Agent 加载失败" subTitle={errorMessage(query.error)} extra={<Button onClick={() => query.refetch()}>重试</Button>} />;
}

const filtered = rows.filter(matchesQuery).filter(matchesStatus);
```

初次加载显示 4 张 Skeleton 卡；真实空数据展示创建入口；过滤空展示“清除筛选”。页头摘要使用总数、发布数和 `hasUnpublishedChanges` 数。

- [ ] **Step 5: 为 1280/1024 布局增加局部样式**

```css
.agent-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1120px) { .agent-card-grid { grid-template-columns: minmax(0, 1fr); } }
```

卡片必须无固定宽度、无横向 overflow，hover 只使用轻微阴影和边框变化。

- [ ] **Step 6: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/agent/components/AgentCard.tsx src/features/agent/components/AgentListToolbar.tsx src/pages/console/agent/AgentListPage.tsx src/pages/console/agent/agent-workbench.css
git commit -m "feat: redesign agent list as entity cards"
```

### Task 3: 将 Agent 编辑器重组为纵向工作台

**Files:**
- Create: `src/features/agent/components/AgentEditorHeader.tsx`
- Create: `src/features/agent/components/AgentEditorNav.tsx`
- Create: `src/features/agent/components/AgentPublishSummary.tsx`
- Create: `src/features/agent/hooks/useUnsavedChangesGuard.tsx`
- Create: `src/features/agent/types.ts`
- Modify: `src/pages/console/agent/AgentEditorPage.tsx`
- Modify: `src/features/agent/components/KnowledgeBindPanel.tsx`
- Modify: `src/pages/console/agent/agent-workbench.css`

- [ ] **Step 1: 定义六个 section 和两组生效模型**

```ts
export type AgentEditorSection = 'base' | 'prompt' | 'model' | 'knowledge' | 'skills' | 'connectors';

export const AGENT_EDITOR_GROUPS = [
  { title: 'Agent 配置', items: ['base', 'prompt', 'model', 'knowledge'] as AgentEditorSection[] },
  { title: '即时授权', items: ['skills', 'connectors'] as AgentEditorSection[] },
];
```

Nav 使用真实 button，当前项带 `aria-current="page"`；即时授权组常驻说明“更改后立即生效，不随草稿保存”。

- [ ] **Step 2: 实现吸顶 Header 与发布摘要**

Header 接收 `dirty`、`saving`、`publishing` 和动作回调；草稿已改时显示独立状态。PublishSummary 只读取当前表单值、`kbBinding` 以及技能/连接查询返回的计数，不自行发写请求。

- [ ] **Step 3: 接入表单脏状态和浏览器/SPA 离开确认**

使用 `Form` 的 `onValuesChange` 设置 `dirty`，保存/发布成功后清零；`beforeunload` 处理浏览器关闭，站内返回按钮先确认：

```ts
const blocker = useBlocker(dirty);
useBeforeUnload(
  useCallback((event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }, [dirty]),
);
```

当 `blocker.state === 'blocked'` 时用 AntD `modal.confirm` 让用户选择 `blocker.proceed()` 或 `blocker.reset()`，从而覆盖侧栏、浏览器前进后退和页面内导航；浏览器关闭/刷新由 `useBeforeUnload` 兜底。

- [ ] **Step 4: 让知识库变更也进入草稿 dirty**

`KnowledgeBindPanel` 保持 `value/onChange` 受控，避免在编辑器外层 Form 内再嵌套独立 Form；父页面包装 `onChange` 同时 `setKbBinding(next)` 与 `setDirty(true)`。技能/连接授权不走这个回调。

- [ ] **Step 5: 修正保存/发布错误与缓存失效**

```ts
const invalidateAgentSurfaces = async () => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['agent', 'detail', id] }),
    qc.invalidateQueries({ queryKey: ['agent', 'list'] }),
    qc.invalidateQueries({ queryKey: ['agent', 'list', 'all'] }),
    qc.invalidateQueries({ queryKey: ['chat', 'agents'] }),
    qc.invalidateQueries({ queryKey: ['dashboard', 'agents'] }),
  ]);
};
```

`saveMut` 和 `publishMut` 都加入 `onError`；发布仍然先校验并保存当前表单，再调用 publish。查询失败显示错误页和重试，不再返回 `null` 白屏。

- [ ] **Step 6: 用三栏布局替换 Tabs**

桌面为 `208px / minmax(0, 1fr) / 280px`；1024px 以下右栏折叠为内容顶部摘要，左栏保持可横向滚动的 section 导航。中间沿用现有 Form.Item 与业务组件，不改 payload 序列化。

- [ ] **Step 7: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/agent/components/AgentEditorHeader.tsx src/features/agent/components/AgentEditorNav.tsx src/features/agent/components/AgentPublishSummary.tsx src/features/agent/hooks/useUnsavedChangesGuard.tsx src/features/agent/types.ts src/features/agent/components/KnowledgeBindPanel.tsx src/pages/console/agent/AgentEditorPage.tsx src/pages/console/agent/agent-workbench.css
git commit -m "feat: reorganize agent editor workbench"
```

### Task 4: 重做 Agent 数据连接即时授权

**Files:**
- Create: `src/features/agent/components/AgentConnectionGrantPanel.tsx`
- Modify: `src/features/agent/components/SkillBindPanel.tsx`
- Modify: `src/pages/console/agent/AgentEditorPage.tsx`
- Delete: `src/features/agent/components/ConnectorBindPanel.tsx`
- Modify: `src/pages/console/agent/agent-workbench.css`

- [ ] **Step 1: 用搜索卡片双栏替换固定宽 Transfer**

左栏显示可授权连接，右栏显示已授权；卡片显示健康、只读验证、语义状态/coverage 和写策略。对每条连接保留 `aria-label="授权 <name>"` 或 `aria-label="撤销 <name>"`。

- [ ] **Step 2: 将 query 错误与空数据分开**

```tsx
if (allQuery.isError) {
  return <Alert type="error" showIcon message="无法读取企业数据连接" description={errorMessage(allQuery.error)} action={<Button onClick={() => allQuery.refetch()}>重试</Button>} />;
}
if (boundQuery.isError) {
  return <Alert type="error" showIcon message="无法读取当前授权" description={errorMessage(boundQuery.error)} />;
}
```

非超管只读查看；若列表 API 本身被拒绝，如实显示权限说明，不伪装成“暂无连接”。

- [ ] **Step 3: 实现逐连接即时生效状态**

用 `pendingConnectionId` 与 `lastOutcome` 展示“保存中 / 已生效 / 保存失败”；成功只失效 `['agent', agentId, 'connections']`。技能和连接授权均不修改父 Form，因此不进入草稿 dirty 状态。

- [ ] **Step 4: 给技能授权补齐同一套即时生效反馈**

`SkillBindPanel` 保留现有 API 与 Transfer 交互，但增加“即时生效”说明、query error + retry、按受影响 skill 的 pending 状态和“已生效 / 保存失败”反馈；不接入父 Form。

- [ ] **Step 5: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/agent/components/AgentConnectionGrantPanel.tsx src/features/agent/components/SkillBindPanel.tsx src/pages/console/agent/AgentEditorPage.tsx src/pages/console/agent/agent-workbench.css && git rm src/features/agent/components/ConnectorBindPanel.tsx
git commit -m "feat: streamline agent connection grants"
```

### Task 5: 将数据连接列表改为安全轮廓卡片

**Files:**
- Create: `src/features/connector/presentation.tsx`
- Create: `src/features/connector/components/ConnectorCard.tsx`
- Create: `src/features/connector/components/ConnectorSecurityProfile.tsx`
- Create: `src/features/connector/components/ConnectorListToolbar.tsx`
- Create: `src/pages/console/connector/connector-workbench.css`
- Modify: `src/pages/console/connector/ConnectorListPage.tsx`

- [ ] **Step 1: 提取列表展示元数据，不移动业务语义映射**

`presentation.tsx` 组合 `semanticStatusMeta()`、`semanticCoverageOf()` 与后端 label，导出：

```ts
export interface ConnectorRisk {
  tone: 'neutral' | 'info' | 'warning' | 'danger';
  title: string;
  consequence: string;
  nextAction?: string;
}

export function primaryConnectorRisk(row: ConnectorView): ConnectorRisk | null;
export function matchesConnectorQuery(row: ConnectorView, query: string): boolean;
```

不得复制 `SemanticStatus`、gap、source、verified 或模型可见性映射。

- [ ] **Step 2: 实现固定四段 ConnectorCard**

```tsx
<article data-testid="connector-card" data-connector-id={row.id}>
  <ConnectorSecurityProfile row={row} />
  <Button data-testid="connector-open" onClick={onOpen}>打开连接</Button>
</article>
```

四段固定顺序：账号权限、平台写策略、语义状态/coverage、数据出库档位。异常区写后果和唯一下一步；更多菜单保留测试、编辑、启停、删除。

- [ ] **Step 3: 实现搜索和筛选**

筛选状态至少包括 `all / attention`、类型、健康、写策略、语义状态；全部在 `useMemo` 内对少于 20 条数据处理。工具栏控件都带可读 label。

- [ ] **Step 4: 重写 ConnectorListPage 的页面编排**

保留权限查询、kinds query、只在任一行 `RUNNING` 时的 5 秒轮询和全部 mutation 语义；删除宽 Table。错误/真实空/过滤空分别渲染；首次加载显示 Skeleton 卡。页头统计总数、健康数、需处理数、生成中数。

- [ ] **Step 5: 保证每个 mutation 只加载当前连接**

状态、测试和删除 mutation 都使用 `variables` 或显式 `pendingId`；禁止整页按钮同时进入 loading。

- [ ] **Step 6: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/connector/presentation.tsx src/features/connector/components/ConnectorCard.tsx src/features/connector/components/ConnectorSecurityProfile.tsx src/features/connector/components/ConnectorListToolbar.tsx src/pages/console/connector/ConnectorListPage.tsx src/pages/console/connector/connector-workbench.css
git commit -m "feat: redesign connector list as security cards"
```

### Task 6: 将连接新建/编辑改为分区 Drawer 并绑定 probe 指纹

**Files:**
- Create: `src/features/connector/components/ConnectorFormDrawer.tsx`
- Modify: `src/pages/console/connector/ConnectorListPage.tsx`
- Modify: `src/pages/console/connector/connector-workbench.css`

- [ ] **Step 1: 搬迁现有动态表单且保持载荷不变**

Drawer props：

```ts
interface ConnectorFormDrawerProps {
  open: boolean;
  editing: ConnectorView | null;
  kinds: ConnectorKind[];
  onClose: () => void;
  onCreated: (connector: ConnectorView) => void;
  onUpdated: (connector: ConnectorView) => void;
}
```

保留 `SchemaForm`、`SecretField`、`GrantScriptPanel`、未知枚举原样回填、`semanticDataTier` 编辑回填和 `stripBlankSecrets()`。

- [ ] **Step 2: 实现四段可跳转目录**

目录锚点固定为 `basic / parameters / governance / verify`。它不是逐步提交向导，所有段共享同一个 Form，最后一次 create/update。

- [ ] **Step 3: 给 probe 结果绑定规范化指纹**

```ts
function probeFingerprint(payload: ConnectorUpsert): string {
  return JSON.stringify({
    kind: payload.kind ?? '',
    name: payload.name,
    writePolicy: payload.writePolicy ?? 'FORBIDDEN',
    params: Object.keys(payload.params).sort().reduce<Record<string, unknown>>((out, key) => {
      out[key] = payload.params[key];
      return out;
    }, {}),
  });
}

type ProbeState = { result: ProbeOutcome; fingerprint: string } | null;
```

表单变化后若当前指纹不同，Alert 显示“配置已变化，需要重新测试”，不能继续展示旧成功状态。

- [ ] **Step 4: 修正 probe 成功文案**

```ts
const successTitle = result.readonlyVerified
  ? '连接正常，只读权限已验证'
  : writePolicy === 'FORBIDDEN'
    ? '连接正常，但只读权限未验证'
    : '连接正常，当前策略允许写入';
```

仍显示能力和 `readonlyDetail`；可写策略绝不声称“只读已验证”。

- [ ] **Step 5: 保留相同目标的持久提示与凭据审计边界**

`sameTargetHint` 继续用需确认的 Modal/Alert；`revealCredential` 结果只活在 `SecretField` 局部 state，不写入 Form 或 query cache；Drawer 关闭销毁敏感 state。

- [ ] **Step 6: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/connector/components/ConnectorFormDrawer.tsx src/pages/console/connector/ConnectorListPage.tsx src/pages/console/connector/connector-workbench.css
git commit -m "feat: move connector editing into governed drawer"
```

### Task 7: 合并连接详情为 URL 驱动的懒加载 Inspector

**Files:**
- Create: `src/features/connector/components/ConnectorInspector.tsx`
- Create: `src/features/connector/components/ConnectorOverviewPanel.tsx`
- Modify: `src/features/connector/components/ConnectorAuditDrawer.tsx`
- Modify: `src/features/connector/components/ConnectorSchemaDrawer.tsx`
- Modify: `src/pages/console/connector/ConnectorListPage.tsx`
- Modify: `src/pages/console/connector/connector-workbench.css`

- [ ] **Step 1: 将 Audit 与 Schema 的内容导出为可嵌入 Panel**

保留旧默认 export wrapper，新增：

```ts
export function ConnectorAuditPanel({ connector }: { connector: ConnectorView }) { /* 现有查询与表格 */ }
export function ConnectorSchemaPanel({ connector }: { connector: ConnectorView }) { /* 现有刷新与漂移 UI */ }
```

Schema 的 mutation 归属、MutationCache pending 去重、语义缓存失效和守卫/截断/影响措辞必须原样保留。

- [ ] **Step 2: 实现 OverviewPanel**

展示四段安全轮廓、实际能力、最近健康检查、当前风险和创建时间。没有“最近使用”接口时不伪造；使用记录入口跳到 audit tab。

- [ ] **Step 3: 实现 URL 状态解析和写回**

```ts
export type ConnectorInspectorTab = 'overview' | 'schema' | 'semantic' | 'audit';

const connectorId = searchParams.get('connector');
const tab = normalizeInspectorTab(searchParams.get('tab'));
```

关闭只删除 `connector` 与 `tab`，保留其它查询参数；切 tab 使用 `setSearchParams`。无效连接 id 显示错误并可关闭。

- [ ] **Step 4: 让页签按需挂载/请求**

只有 active tab 渲染对应 Panel；semantic tab 只显示连接级状态/coverage/档位摘要和链接 `/console/connectors/${id}/semantic`，不提前请求全量语义行。

- [ ] **Step 5: 桌面宽 Drawer 与窄屏整页降级**

1280px 以上 Drawer 宽度 `min(920px, calc(100vw - 320px))`；低于 1024px 使用全视口容器。焦点关闭后返回触发卡。

- [ ] **Step 6: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/connector/components/ConnectorInspector.tsx src/features/connector/components/ConnectorOverviewPanel.tsx src/features/connector/components/ConnectorAuditDrawer.tsx src/features/connector/components/ConnectorSchemaDrawer.tsx src/pages/console/connector/ConnectorListPage.tsx src/pages/console/connector/connector-workbench.css
git commit -m "feat: unify connector details in inspector"
```

### Task 8: 建立完整语义层工作台

**Files:**
- Create: `src/features/connector/components/semantic/SemanticHeader.tsx`
- Create: `src/features/connector/components/semantic/SemanticScopeRail.tsx`
- Create: `src/features/connector/components/semantic/SemanticRowList.tsx`
- Create: `src/features/connector/components/semantic/SemanticInspector.tsx`
- Create: `src/pages/console/connector/SemanticWorkbenchPage.tsx`
- Create: `src/pages/console/connector/semantic-workbench.css`
- Modify: `src/features/connector/components/ConnectorSemanticDrawer.tsx`
- Modify: `src/features/connector/semantic.ts`
- Modify: `src/router/index.tsx`

- [ ] **Step 1: 提取语义层查询和危险 mutation，保持现有语义**

将现有 Drawer 主体变为可嵌入的 `ConnectorSemanticContent`，保留：只在 RUNNING 时 5 秒轮询、异步派发文案、只覆盖 INFERRED 的说明、物理删除确认、HUMAN 历史丢失警告、`removed=0` 真实提示和旧内容不因失败清空。

- [ ] **Step 2: 在 semantic.ts 增加“需关注”派生，不复制映射**

```ts
export function semanticAttentionReasons(
  row: ConnectorSemanticRow,
  tier: string | null | undefined,
): string[] {
  const reasons: string[] = [];
  if (isStale(row)) reasons.push('结构已变');
  if (row.verified === 'REJECTED') reasons.push('数据不支持');
  if (row.verified === 'UNDECIDABLE') reasons.push('无法验证');
  if (row.scope === 'JOIN' && (row.verified ?? 'NONE') === 'NONE') reasons.push('表关系未经数据验证');
  if (joinCare(row, tier)) reasons.push('关联需要额外条件');
  if (isKeyValueTable(row)) reasons.push('键值对表');
  return reasons;
}
```

- [ ] **Step 3: 实现 Header 的双轴状态**

`semanticStatusMeta()` 与 `semanticCoverageOf()` 分开渲染。FAILED 时明确“连接仍可用”并保留旧条目；NOT_APPLICABLE 禁用重跑；RUNNING 显示 `semanticClaimAt` 并禁用重复派发；`semanticNote` 放入“本次生成详情”。档位常驻并链接回 `?connector=<id>&tab=overview` 的编辑入口。

- [ ] **Step 4: 实现 scope rail、条目列表和纯前端关注视图**

scope 顺序使用 `groupByScope()`；未知 scope 自动末尾。列表仍以现有 20 条阈值分页，gloss 为主，保留 anchor、join target、source/evidence/verified/status、回答人/时间、多态/复合键/表形态标签。

- [ ] **Step 5: 实现右侧证据 Inspector**

选择行后用现有 `detailEntries()`、`historyEntries()`、`joinCare()`、`tableShapeOf()` 等映射显示四组：模型此刻读到、平台留存但当前模型不可见、信任与来源、危险区。STALE 对 METRIC 与其它 scope 的差异措辞原样保留；HUMAN 显示回答人、时间、trace 与最多 20 条历史。

- [ ] **Step 6: 注册深链路由与错误状态**

```tsx
const SemanticWorkbenchPage = lazy(() => import('@/pages/console/connector/SemanticWorkbenchPage'));

<Route path="connectors/:id/semantic" element={<SuperAdminRoute><SemanticWorkbenchPage /></SuperAdminRoute>} />
```

页面查询 `connectorApi.get(id)`；404/权限错误显示原因与返回数据连接按钮，语义 query 错误与空结果分开。

- [ ] **Step 7: 实现三栏响应式布局**

桌面为 `220px / minmax(0, 1fr) / 340px`；低于 1180px 右侧 Inspector 作为 Drawer；低于 1024px scope rail 变横向滚动。任何断点都不得隐藏可信链字段。

- [ ] **Step 8: 运行门禁并提交**

Run: `npm run typecheck && npm run lint`

Expected: PASS。

```bash
git add src/features/connector/components/semantic src/features/connector/components/ConnectorSemanticDrawer.tsx src/features/connector/semantic.ts src/pages/console/connector/SemanticWorkbenchPage.tsx src/pages/console/connector/semantic-workbench.css src/router/index.tsx
git commit -m "feat: add semantic layer workbench"
```

### Task 9: 更新 E2E 语义选择器并覆盖关键 UX

**Files:**
- Modify: `e2e/lib.mjs`
- Modify: `e2e/connector-ui-check.mjs`
- Modify: `e2e/connector-schema-check.mjs`
- Modify: `e2e/connector-writepolicy-check.mjs`
- Modify: `e2e/connector-probe-check.mjs`
- Create: `e2e/agent-workbench-check.mjs`
- Create: `e2e/semantic-workbench-check.mjs`

- [ ] **Step 1: 集中新增稳定选择器**

```js
export const sel = {
  // existing selectors...
  agentCard: '[data-testid="agent-card"]',
  agentSearch: '[data-testid="agent-search"]',
  connectorCard: '[data-testid="connector-card"]',
  connectorOpen: '[data-testid="connector-open"]',
  connectorForm: '[data-testid="connector-form-drawer"]',
  connectorInspector: '[data-testid="connector-inspector"]',
  semanticWorkbench: '[data-testid="semantic-workbench"]',
};
```

- [ ] **Step 2: 移除表格列号和 `.ant-modal` 假设**

`connector-writepolicy-check.mjs` 不再读 `tds[5]`；按具名卡 `data-connector-id` 与 `data-testid` 读取写策略。四份 connector E2E 将 `.ant-modal`、表格行和独立 Drawer 假设改为稳定的 Drawer/Inspector selector，动态 schema、授权命令、probe、schema 漂移和“不落库”断言保持。

- [ ] **Step 3: 增加 Agent 工作台实跑**

覆盖：卡片渲染、搜索、筛选、编辑器六个 section、修改字段出现未保存状态、保存后消失、即时授权说明存在。脚本不创建/删除生产数据，使用现有实体做只读导航；有写动作的部分只在显式测试环境变量开启时运行。

- [ ] **Step 4: 增加语义工作台实跑**

从连接卡打开 Inspector，切换四个 tab，确认 URL 更新；进入完整语义工作台，验证状态与 coverage 独立、scope 顺序、行选中后四组 Inspector。用 1440、1280、1024 三个 viewport 断言 `document.documentElement.scrollWidth <= clientWidth`。

- [ ] **Step 5: 运行可用的 E2E 并提交**

Run: `cd e2e && npm install && E2E_BASE_URL=http://localhost:8082 node connector-ui-check.mjs`

Expected: 已启动本地栈时全部断言 PASS；环境不可用时保留脚本并在最终报告中明确“未实跑”，不得声称通过。

```bash
git add e2e/lib.mjs e2e/connector-ui-check.mjs e2e/connector-schema-check.mjs e2e/connector-writepolicy-check.mjs e2e/connector-probe-check.mjs e2e/agent-workbench-check.mjs e2e/semantic-workbench-check.mjs
git commit -m "test: cover agent connector and semantic workbenches"
```

### Task 10: 全量验证、视觉巡检与边界复核

**Files:**
- Modify: implementation files only if verification finds defects

- [ ] **Step 1: 运行全量静态门禁**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: 三条命令均退出 0；lint warning 为 0。

- [ ] **Step 2: 检查变更边界**

Run: `git diff --check && git status --short && git diff --stat HEAD~10..HEAD`

Expected: 无空白错误；只涉及 `jm-agent-front` 的 UI、E2E 和设计/计划文档；没有后端、依赖或部署配置变更。

- [ ] **Step 3: 手工检查三种视口**

在 1440×900、1280×800、1024×768 验证：Agents/连接列表无横向滚动；卡片降列；Inspector/语义侧栏正确降级；键盘 Tab、Escape、焦点返回与 reduced-motion 正常。

- [ ] **Step 4: 手工检查角色与失败语义**

企业超管验证全部写路径；普通成员确认治理入口在权限成功返回后隐藏，权限请求失败时导航 fail-open 但页面/后端仍拒绝；列表错误、空数据、筛选空和后台刷新失败互不伪装。

- [ ] **Step 5: 检查所有关键安全语义**

确认：动态 schema；凭据只在点击后取回且不入缓存；写策略/账号权限独立；档位原样回填；probe 指纹失效；语义五状态与未知状态；coverage 空值不标红；HUMAN/IMPORTED 不被重跑覆盖；删除不可恢复和 `removed=0` 文案；仅 RUNNING 轮询。

- [ ] **Step 6: 最终提交（仅在验证修复产生未提交变更时）**

```bash
git add src e2e docs/superpowers
git commit -m "fix: polish workbench verification findings"
```

不要 push；本仓库 `main` 的 push 会直接触发本机生产部署。
