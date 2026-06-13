# 全局搜索(⌘K 命令面板)设计

日期:2026-06-13
仓库:`jm-agent-front`(前端) + `data-service`(后端)

## 背景与目标

顶栏右侧的搜索框(`ConsoleLayout.tsx:54-58`)目前是一块纯静态 `<div>`,
文案写着「搜索 Agent、文档、Trace… ⌘K」,但没有输入框、没有点击行为,是个假功能。

目标:把它实现为一个真实可用的 **⌘K 命令面板**,支持跨三类实体的快速搜索与跳转:

- **Agent**
- **文档**(知识库下的文档)
- **Trace**(调用日志)

定位是「快速跳转」,不是「全量检索」—— 每类只返回少量结果用于直达目标页面。

## 总体方案

- 交互形态:**⌘K 命令面板**(居中浮层,键盘驱动)。
- 聚合方式:**统一后端接口** `GET /data/admin/search`,一次调用返回三类分组结果。
- 隔离原则:租户隔离 + 行级隔离**全部落在后端、复用既有已验证的服务方法**,
  前端不做任何权限判断。

### 为什么用统一后端接口(而非前端并发三个接口)

- 文档没有现成的全局接口(文档挂在各知识库下),无论如何都要新增后端查询。
  既然要动后端,把三类收敛到一个接口最干净。
- 三类的隔离规则各不相同(Agent 走 RBAC、文档走 KB 级 RBAC、Trace 按 create_user 私有),
  集中在服务端用各自既有的查询方法处理,避免任何一类把别人的数据搜出来。
- 前端只发一次请求,防抖、loading、取消都简单。

## 后端设计(data-service)

### 接口

新增 `GlobalSearchController`:

```
GET /data/admin/search?q=<keyword>&limit=5
```

- `q`:搜索词。为空或 `trim` 后长度 < 1 → 直接返回三个空数组,**不打库**。
- `limit`:每类返回上限,默认 5,封顶(如 20)。
- 走全局响应封套 `{ success, respCode, respMsg, data }`(由 `GlobalResponseHandler` 统一包装,
  本接口返回 JSON 对象,不涉及二进制下载,无需特殊处理)。

返回结构(`GlobalSearchResult`):

```json
{
  "agents": [{ "id": "12", "name": "学生险助手", "status": "PUBLISHED" }],
  "documents": [
    {
      "id": "88",
      "title": "刘俊杰-1v1.docx",
      "kbId": "7",
      "kbName": "学生险",
      "sourceType": "docx"
    }
  ],
  "traces": [
    {
      "traceId": "abc",
      "agentName": "学生险助手",
      "status": "SUCCESS",
      "createTime": 1699999999000
    }
  ]
}
```

> 注意:`data-service` 会把 `Long`/`Integer` 序列化成字符串(已知约定),
> 故 `id`/`kbId`/`createTime` 在前端按字符串接收,需要做算术/比较时 `Number()` 兜底。

### 服务层(`GlobalSearchService`),三段查询各自复用既有隔离

1. **Agent**
   - 复用 `agentService.list(null)`,再经
     `permissionResolver.filterCurrent(list, ResourceType.AGENT, Agent::getId, Agent::getCreateUser)`
     —— 与 `AgentAdminController.agents()` 完全一致的可见性。
   - 在结果上按 `name LIKE %q%` 过滤(内存过滤即可,Agent 数据量小),取前 `limit` 条。

2. **文档**
   - 先取当前用户**可见的知识库 id 集合**:复用 `knowledgeBaseService.list()`(已做 KB 级 RBAC 过滤),
     取其 `id` 列表。
   - 若集合为空 → 文档结果为空。
   - 否则查询 `kb_document WHERE kb_id IN (visibleKbIds) AND title LIKE %q%`,
     按更新时间倒序,取前 `limit` 条。租户隔离由 MyBatis-Plus 租户拦截器在 `kb_document` 上自动完成。
   - 回填 `kbName`:从第 1 步已取到的 KB 列表里按 `kbId` 映射,**不额外打库**。
   - **只搜标题 `title`**,不搜切片正文(正文语义检索是 `/rag/search` 的职责,不在此入口)。

3. **Trace**
   - 复用 `TraceSupport.buildWrapper(null, null, null, q, null)` + `ownerScopeOrNull()` 的「按人私有」逻辑
     (与 `TraceQueryService.page` 同一套),`aiTraceMapper` 分页取前 `limit` 条。
   - `agentName`:Trace 上若已有 `agentId`,按既有方式回填 Agent 名(若取名成本高,可先用现成字段;
     实现阶段确认 `ai_trace` 是否已冗余 agent 名,优先用冗余字段避免 N+1)。

> 三类查询彼此独立,可在 service 内顺序执行(数据量小、各取 5 条,无需并发)。

## 前端设计(jm-agent-front)

### 新增 feature:`src/features/search/`

- `api.ts` —— `searchApi.global(q, limit?)` 调 `GET /admin/search`(经 axios 封套自动解包)。
- `types.ts` —— `GlobalSearchResult` / `AgentHit` / `DocumentHit` / `TraceHit`。
- `hooks/useGlobalSearch.ts` —— 输入词 **300ms 防抖** + react-query;`q` < 1 字不发请求;
  切换查询时取消上一个请求(react-query 默认行为即可)。
- `components/CommandPalette.tsx` —— 浮层组件。

### 命令面板交互

- 顶部一个输入框(打开时自动 focus)。
- 下方三个分组:**Agent / 文档 / Trace**,每组列出命中项;某组为空则不渲染该组标题。
- 键盘:`↑`/`↓` 在所有可见项间移动高亮,`Enter` 跳转到当前高亮项,`Esc` 关闭;鼠标可直接点击。
- 状态:空查询 → 提示文案;请求中 → spinner;有词但无结果 → 「未找到相关结果」。
- 每项展示:
  - Agent:名称 + 状态标签(就绪/已发布等)。
  - 文档:文件名(`title`) + 所属知识库名(`kbName`) + 类型角标(`sourceType`)。
  - Trace:`Agent名 · 时间 · 状态`(无 Agent 名时退化为 `时间 · 状态`)。

### 接入顶栏(`ConsoleLayout.tsx`)

- 把第 54-58 行的静态 `<div className="atlas-search">` 改成一个 `<button>`(保留原样式与 `⌘K` 角标),
  `onClick` 打开面板。
- 注册全局快捷键:`⌘K`(mac)/ `Ctrl+K`(win)打开面板。在输入框等可编辑元素聚焦时可正常拦截
  (命令面板本身的输入框除外)。
- 面板状态(`open`)放在 `ConsoleLayout` 内即可,无需全局 store。

### 跳转目标(复用现有路由)

- Agent → `/console/agents/:id`
- 文档 → `/console/knowledge/:kbId`(定位到所属知识库详情页;当前没有独立文档详情路由)
- Trace → `/console/traces?traceId=<traceId>`
  - 需要在 `TraceListPage` 增加:挂载时读取 `?traceId=` 这个 search param,
    若存在则 `setSelectedId(traceId)` 打开右侧详情面板(当前详情仅靠本地 `selectedId` state,
    无 URL 入口,需补一个 `useSearchParams` 同步)。

跳转后关闭面板。

## 边界与非目标(YAGNI)

- 不做分页 / 全量检索 —— 每类封顶 5 条,命令面板只负责快速直达。
- 文档不搜正文,只搜标题。
- 不改 placeholder 文案(三类都已实现)。
- 不动 axios 拦截器、auth、封套逻辑。
- Trace 不在面板内做内联预览,统一靠跳转到列表页详情。

## 测试与验收(端到端实跑,不只 typecheck)

后端:

- 起本地 data-service,造数据后用 token 直接 `curl /data/admin/search?q=...` 验证三类返回与隔离
  (成员账号搜不到别人的 Trace、搜不到无权 KB 下的文档)。

前端:

- `npm run dev` 起前端,实际按 ⌘K 打开面板,输入关键词,验证三类结果展示、键盘上下选择、
  回车跳转到正确页面;Trace 跳转后详情面板自动打开。
- `npm run build`(含 tsc)+ `npm run lint`(`--max-warnings 0`)通过。
