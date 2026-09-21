# JM Agent Platform Front-End

B2B SaaS Agent 平台前端，配套 `data-service` 后端。

## 技术栈

- React 18 + TypeScript + Vite 5
- Ant Design 5
- TanStack Query v5 + Zustand
- React Router v6
- 自封装 SSE 流式客户端（fetch + ReadableStream）

## 功能模块

- 登录 / 多租户（JWT + X-Tenant-Id）
- 仪表盘
- 知识库（CRUD + 文档上传 + 入库状态轮询 + 检索测试）
- 技能（上传 / 启停 / 私有与共享 / 技能构建器 / 评测）
- 连接（客户自有系统的连接与凭据）与连接器（目录 / 结构 / 语义层 / 审计 / 待审写操作）
- Agent（CRUD + 人设 + 模型参数 + 技能绑定 + 知识库绑定 + 发布）
- 对话调试台（管理员侧 Playground，SSE 流式 + 引用 citations）
- 终端用户对话页（`/chat/:agentId`）

## 开发

```bash
# 1. 安装依赖（网络环境差时已默认走 npmmirror，可在 .npmrc 中切回）
npm install

# 2. 启动开发服务器（默认代理 /data 到 http://localhost:10011，可用 VITE_API_TARGET 覆盖）
npm run dev

# 3. 类型检查
npm run typecheck

# 4. 生产构建
npm run build
npm run preview
```

## 环境变量

- `VITE_API_TARGET`：开发期 vite 代理目标（默认 `http://localhost:8080`，即 data-service 网关）
- `VITE_API_BASE`：前端 API base，默认 `/data`

## 路由

- `/login` 登录
- `/console/dashboard` 仪表盘
- `/console/agents` Agent 列表与编辑（`agents/new`、`agents/:id`）
- `/console/knowledge` 知识库（`knowledge/:kbId`）
- `/console/skills` 技能、`/console/skill/builder` 技能构建器
- `/console/connections` 连接、`/console/connectors` 连接器、`/console/pending-writes` 待审写操作
- `/console/traces` 调用链、`/console/feedback` 产品反馈
- `/console/playground/:agentId?` 调试台
- `/chat/:agentId`、`/chat/c/:conversationId` 终端用户对话

## Nginx 部署要点（SSE 必须）

```nginx
location /data/ {
  proxy_pass http://data-service-gateway:8080/data/;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;                # SSE 必须关闭缓冲
  proxy_read_timeout 600s;
  client_max_body_size 100m;          # 文档上传
  add_header X-Accel-Buffering no;
}

location / {
  try_files $uri /index.html;         # SPA fallback
}
```

## 与后端 API 对应

| 模块 | 后端路径 |
|---|---|
| 登录 | `POST /data/admin/auth/login` |
| Agent | `/data/admin/agent/agents` |
| 技能 | `/data/tenant/skills` |
| 连接 | `/data/admin/connections` |
| 连接器 | `/data/admin/connectors` |
| 知识库 | `/data/rag/kb` |
| 文档 | `/data/rag/kb/{kbId}/documents`、`/data/rag/documents/{id}` |
| 检索 | `POST /data/rag/search/search` |
| RAG 问答（SSE） | `POST /data/rag/answer/answer` |

响应统一格式 `{ success, respCode, respMsg, data }`。`respCode` 是**字符串**，成功为 `'200'`（见 `RESP_CODE.SUCCESS`），所以必须用 `isCode()` / `String()` 比较，不要和数字比。

**`respCode === '4001'` 不等于「登录失效」**：它被复用于「无权限」「需要超管」「旧密码错误」等一律返回 HTTP 200 的业务失败。只有 **HTTP 401 / 403** 才表示会话过期。照着裸 `4001` 跳登录页，会让成员一碰到自己没权限的东西就被踢出去。

## 目录结构

```
src/
├── api/                # axios 客户端、SSE 封装、类型
├── components/         # 通用组件（Markdown、ErrorBoundary、StubPage）
├── features/           # 业务领域（auth / agent / agent-builder / knowledge / skill /
│                    #   connection / connector / chat-admin / trace / dashboard /
│                    #   feedback / rbac / search）
├── layouts/            # ConsoleLayout / ChatLayout
├── pages/              # 路由薄壳
├── router/             # 路由表 + ProtectedRoute
├── stores/             # zustand authStore
├── styles/             # 全局样式
└── utils/              # jwt 解析等
```
