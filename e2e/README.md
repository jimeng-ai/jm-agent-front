# e2e — 对话「发送后不丢 / 可重连」+ 列表未读红点 回归

Playwright（Node）端到端回归，覆盖「服务端自持久化 + 可重连生成」与列表未读红点这套功能。
**独立依赖**：自带 `package.json`，不挂在前端主工程的 `node_modules` 上，不影响 `npm run build`。

## 跑之前

需要本地完整栈在跑（前端 + 网关 + data-server + Redis/MySQL，见仓库根 `start-local.sh`），
且对应租户里有一个**已发布的 RAG 对话 Agent**（默认用「知识库助手」）。

## 一次性安装

```bash
cd jm-agent-front/e2e
npm run setup          # npm install + playwright install chromium
```

## 运行

```bash
npm test               # 跑全部套件（失败退出码非 0，可接 CI）
npm run test:resilient # 主流程：流式/列表指示/切走重连/停止/断网续传
npm run test:multiwindow
npm run test:dot       # 生成中右侧转圈 → 完成红点 → 查看清除
npm run test:menu      # 红点跨 SPA 菜单切换保留（曾经的回归点）
```

截图落在 `e2e/shots/`（已 gitignore），失败时按 `PASS/FAIL` 行定位。

## 配置（环境变量，均有本机 dev 默认值）

| 变量 | 默认 | 说明 |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:8082` | 前端地址 |
| `E2E_USERNAME` | `test` | 企业端登录账号 |
| `E2E_PASSWORD` | `test123` | 登录密码（本机 dev 账号；换环境请用环境变量覆盖，勿提交真实密码） |
| `E2E_AGENT_ID` | `2063267418759462913` | 已发布的 RAG 对话 Agent id（**换租户/环境必须改**） |
| `E2E_HEADED` | 空 | 设任意值则有头浏览器，便于肉眼观察 |

例：`E2E_BASE_URL=http://localhost:5173 E2E_AGENT_ID=123 npm test`

## 说明 / 注意

- 会在测试租户里**真实创建若干会话并产生真实 LLM 调用**（消耗 token）；这是 dev 回归用，别指生产。
- 用例靠语义类名定位（`lib.mjs` 里的 `sel`）：`.chat-conv-spin`（生成中转圈）、`.chat-conv-dot`（未读红点）、
  `.chat-conversation-body`、输入框/「发送」/「停止」按钮。UI 改了同步改 `sel` 即可。
- 「菜单切换」用例必须走 **SPA 点击**（`getByText('对话'/'仪表盘')`）而非 `page.goto`——后者整页重载会重建
  前端 store，测不出「组件卸载后状态是否保留」这个真正的回归点。

## 套件与被测点

| 套件 | 验证 |
|---|---|
| `resilient-chat` | 实时逐字（续播泵）、切走时列表转圈、切回不丢（服务端落库+续播）、真停止、断网自动续传 |
| `multi-window` | 同一会话两个独立窗口同时实时看同一份流 |
| `unread-dot` | 生成中右侧转圈、完成右上角红点、点击查看后红点消失 |
| `menu-persistence` | 红点跨 SPA 菜单切换保留；在别的菜单时完成的会话回来也出红点 |
