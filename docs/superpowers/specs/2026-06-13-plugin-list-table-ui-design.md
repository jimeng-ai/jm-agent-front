# 插件列表页：卡片网格 → 表格布局（仿 Atlas 参考图）

日期：2026-06-13
仓库：`jm-agent-front`（前端为主）+ `data-service`（后端补两个聚合字段）

## 背景与目标

现有 `PluginListPage` 是 Ant Design 卡片网格（`Row`/`Col`/`Card`）。要按参考图改成**密集表格**布局：顶部统计头 + 筛选 Tab + 名称搜索 + 表格。

参考图（Atlas）的列里有几项在当前数据模型中**没有真实来源**，因此按「数据诚实」裁剪——参考视觉骨架照搬，列只保留有真实数据支撑的。

代码库里 `TraceListPage.tsx` 已是同一套范式（`Title` + 统计副标题 + `Segmented` + `Input.Search` + `Table`），本页对齐它，保持一致。

## 各列数据可得性结论

| 参考图列             | 处理     | 来源                                                             |
| -------------------- | -------- | ---------------------------------------------------------------- |
| 插件(图标+名称+描述) | 保留     | `plugin.name/description/icon`                                   |
| 状态(草稿/已发布)    | 保留     | `plugin.status`                                                  |
| 创建者               | 保留     | `creatorName`（已回填）                                          |
| 更新时间             | 保留     | `updateTime`                                                     |
| 动作数               | **新增** | 后端 group-by `plugin_tool`                                      |
| 被引用(N Agent)      | **新增** | 后端 group-by `agent_plugin` distinct agent_id                   |
| 24H 调用             | **砍**   | 埋点 metadata 只有 pluginName 无 plugin_id，按名匹配脏；本期不做 |
| 类别                 | **砍**   | 无字段；不加 DB 列                                               |
| 实现(TypeScript/SQL) | **砍**   | 全是 HTTP 映射插件，无此概念                                     |
| 从模板导入 按钮      | **砍**   | 无此功能                                                         |
| 筛选 按钮            | **砍**   | 无额外筛选维度                                                   |

## 方案

### 后端（data-service）— 不改表

1. `Plugin` 实体加两个非持久化字段（照搬 `creatorName` 的 `@TableField(exist = false)`）：
   - `Integer toolCount`
   - `Integer refAgentCount`
2. `PluginCrudService.listPlugins()`：拿到列表后，用两条 group-by 批量回填（按 plugin id `IN`，一次查完，不 N+1；租户由 MyBatis-Plus 自动隔离）：
   - 动作数：`SELECT plugin_id, COUNT(*) FROM plugin_tool WHERE plugin_id IN (...) GROUP BY plugin_id`
   - 被引用：`SELECT plugin_id, COUNT(DISTINCT agent_id) FROM agent_plugin WHERE plugin_id IN (...) GROUP BY plugin_id`
     用 `QueryWrapper.select(...).groupBy(...)` + `selectMaps` 实现。空列表直接跳过查询。
3. Controller `listPlugins` 已直接返回实体，字段随 JSON 带出。`createUser` 已是 `BaseEntity` 字段、无 `@JsonIgnore`，本就序列化——无需后端改动，仅前端类型补声明。

### 前端类型（api/types.ts）

- `BaseEntity` 加 `createUser?: string`
- `Plugin` 加 `toolCount?: number; refAgentCount?: number`

### 前端 `PluginListPage` 重写

- **顶部头**：`Title`「插件」+ 副标题「团队自建 · N 个插件 · 共 M 个动作 · 被 K 个 Agent 引用」（N/M/K 前端聚合）+ 右上 `新建插件`（primary，沿用现有 Modal + createMut）。
- **筛选行**：`Segmented` 四 Tab + `Input.Search`（按名称，前端过滤）。Tab 带计数：
  - 全部 = 全部
  - 我创建 = `createUser === 当前用户 id`（`useAuthStore` 取 `user.id`）
  - 团队共享 = `createUser !== 当前用户 id`
  - 系统内置 = `tenantId == null` → 当前数据恒空（已确认，留空壳显示 0）
- **表格列**：插件(图标 avatar + 名称 + 状态 Tag + 描述省略) · 动作 · 被引用 · 更新(相对时间) · 创建者 · 操作。
  - 整行点击 → `navigate(/console/plugins/:id)`。
  - 操作列沿用现有 publish/unpublish/delete mutation + `ShareModal`，用 `Popconfirm` + 图标/或 `...` 菜单，`stopPropagation` 防误触发行点击。

### 不变

`新建插件 Modal`、`ShareModal`、所有 mutation、`pluginApi` 调用、路由都不动。

## 影响面 / 风险

- 后端：仅新增只读聚合，不改写路径、不改表、不动租户隔离。
- 前端：单文件页面重写 + 两处类型补字段。`npm run lint`（`--max-warnings 0`）+ `npm run typecheck` 必须过。
- 验证：后端实跑 list 接口看 toolCount/refAgentCount/createUser 是否带出 + 前端跑 dev 实测四 Tab/搜索/操作。
