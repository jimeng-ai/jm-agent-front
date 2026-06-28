# 下载对话中上传的文件 — 设计

日期：2026-06-28 ｜ 仓库：jm-agent-front ｜ 分支：feat/chat-attachment-download

## 背景 / 问题

对话端（:8082）用户在会话里上传的文件，会以小卡片（图片缩略图 / 文件图标+文件名）出现在用户消息气泡上方。目前这些卡片只能**预览**（点文档卡片打开 `FilePreviewModal`，点图片放大），**没有下载入口**。需求：让用户能下载这些已上传的文件。

## 关键现状（已查证）

- 后端取流端点**已存在**：`GET /data/agent/files/{fileId}`（`AgentFileController.previewInputFile`），按 `agent_input_file` 表的 `create_user` 做归属校验（成员只能取自己上传的，超管放行），用的是正确的 `void`+`HttpServletResponse`+`OutputStream`（`writeStream`）写法，**不会被 `GlobalResponseHandler` 包成 JSON**。它设的是 `Content-Disposition: inline`（供预览）。
- 前端已有取流工具：`fetchAgentFileBlob(fileId)`（带 `Authorization`/`X-Tenant-Id` 头），以及一个**强制下载**的成熟套路 `downloadArtifact`（fetch blob → `objectURL` → `<a download>` → 释放）。
- 因此本需求是**纯前端**改动：复用已有端点，用 blob+`<a download>` 在前端强制触发下载（即使端点是 `inline` 也照样下）。**不动后端、不动 DB、不新增 `attachment` disposition 端点**（改成 attachment 会破坏预览的 inline 行为）。

## 方案

### 1. API：`src/api/agentFiles.ts`

- 抽出公共 `triggerBlobDownload(blob, filename)`（blob → objectURL → `<a download>` → 释放），并让现有 `downloadArtifact` 复用它（消重，同文件内安全清理）。
- 新增 `downloadAgentFile(fileId, filename?)`：`fetchAgentFileBlob(fileId)` → `triggerBlobDownload`。文件名用 `attachment.filename` 保证存盘是原名。

### 2. 卡片悬停下载图标：`AttachmentThumb.tsx`

- 新增可选属性 `downloadable?: boolean`。
- 仅当 `downloadable` 且文件已上传完成（`!uploading` 且 `fileId` 为真实 id，非 `uploading-` 临时 id）时，在卡片右上角显示一个**悬停才出现**的下载小图标（`DownloadOutlined`，深色半透明圆底白图标，图片/文档两种卡片都加）。
- 点击 `stopPropagation`（不触发放大/预览），调用 `downloadAgentFile`，失败 `message.error('下载失败')`。
- 用 `hover` 状态控制图标显隐（`onMouseEnter/Leave`，opacity 过渡）。
- 与 `removeBtn` 互斥：composer 卡片有 `onRemove`（删除按钮、`downloadable` 默认 false），消息气泡卡片无 `onRemove`、`downloadable` true，两者都在右上角但不会同时出现。

### 3. 接线

- `MessageBubble.tsx`（已发送/历史消息）：`<AttachmentThumb downloadable item={a} />`。
- `MessageComposer.tsx`（发送前）：保持 `downloadable` 默认 false（已有删除按钮，发送前再加下载是噪音）。

### 4. 预览弹窗下载按钮：`FilePreviewModal.tsx`

- Modal 底部加 `footer`：`[下载, 关闭]` 两个按钮，**所有文件类型**可用。
- 下载逻辑：`item.url`（会话内本地 blob URL）存在时直接 `fetch(item.url)→blob→triggerBlobDownload`（免网络）；否则 `downloadAgentFile(item.fileId, item.filename)`。失败 `message.error('下载失败')`。

## 不做（YAGNI）

知识库文档、代码执行产物（本就有下载）、生成图片（本就有下载按钮）、composer 发送前文件的下载。

## 验收

- `npm run lint`（--max-warnings 0 严格）+ `npm run build`（含 tsc）通过。
- 端到端在 **:8082**（docker nginx，需带 `--build-arg NGINX_CONF=nginx.dev.conf` 重建 `jm-agent-front:local` 容器）：上传一个 .xlsx，发送；分别从①卡片悬停下载图标、②预览弹窗下载按钮下载；确认存盘文件名为原名、字节正确能正常打开（不是被包成 JSON 的坏 blob）。
- 通过后合并 `main`。
