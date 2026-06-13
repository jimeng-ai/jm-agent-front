# 插件认证配置：从裸 JSON 文本框改为结构化表单

日期：2026-06-12
分支：`feat/plugin-token-fetch-auth`（`jm-agent-front` + `data-service` 双仓库）

## 背景与问题

插件「基础信息」Tab 选择认证方式后，`API_KEY` / `HMAC` / `OAUTH2` / `TOKEN_FETCH`
四种方式都向用户暴露一个 `auth_config` 原始 JSON 文本框，只给一行示例。用户（尤其是
客户、非开发人员）需要自己手写带转义的 JSON、理解 JSONPath（`$.data.token`）和
`{{secrets.x}}` 模板语法，门槛极高，基本不可用。

目标：把「写 JSON / 懂 JSONPath / 懂转义」这些纯技术门槛全部消掉，让认证配置退化为
「照着接口文档填空 + 点一下测试」，非开发人员也能完成。

## 范围

四种认证方式的裸 JSON 文本框全部替换为结构化表单：

- `API_KEY` / `HMAC`：纯表单，无 token 往返，不需要测试按钮。
- `OAUTH2` / `TOKEN_FETCH`：表单 + 「▶ 测试获取」，真实调用一次换取 token 的接口，
  把返回 JSON 渲染成可点选的树，用户点字段即自动填入 token 路径，彻底不接触 JSONPath。
- 每种方式都保留「⚙ 高级 / 切换 JSON」折叠入口：兼容历史脏数据、给 power user 兜底，
  不丢失任何现有能力。

`NONE` / `BEARER` / `BASIC` 不涉及 `auth_config`，不在本次改动范围。

> HMAC 的 `sign_template` 含 `{method}` / `{env.xxx}` 占位符，即便做成表单仍偏专家向，
> 这类用户基本是开发。表单给足字段提示，但不强求「零知识」；其余三种做到照文档填空。

## auth_config 与凭证字段对照（后端契约，表单必须严格对齐）

| 类型        | auth_config 字段（snake_case）                                                                                                                                                                       | 凭证字段（凭证 Tab）                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| API_KEY     | `location`(header\|query, 默认 header)、`key_name`(默认 X-API-Key)                                                                                                                                   | `value`                                                       |
| HMAC        | `algorithm`(HMAC_SHA256\|HMAC_SHA1\|MD5)、`sign_template`、`encoding`(hex\|base64)、`timestamp_field?`、`nonce_field?`、`placement{type:header\|query, name}`                                        | `secret_key`                                                  |
| OAUTH2      | `token_url`、`scope?`、`client_auth`(body\|basic, 默认 body)、`default_ttl_sec?`、`safety_margin_sec?`                                                                                               | `client_id`、`client_secret`                                  |
| TOKEN_FETCH | `token_request{method,url,content_type,headers,body}`、`token_path`、`expire_path?`、`expire_unit`(sec\|ms)、`default_ttl_sec`、`safety_margin_sec?`、`inject{location:header\|query, name, prefix}` | 自定义键（在 `token_request.body` 里以 `{{secrets.x}}` 引用） |

后端解析入口：`GenericTokenAuthApplier.buildSpec`（TOKEN_FETCH，嵌套 `token_request`）、
`OAuth2ClientCredentialsAuthApplier.buildSpec`、`ApiKeyAuthApplier.apply`、`HmacAuthApplier.apply`。
DTO 见 `TokenFetchSpec`。

## 前端设计（jm-agent-front）

### 组件结构

- 新增 `src/features/plugin/components/authconfig/` 组件族：
  - `AuthConfigEditor.tsx`：按 `authType` 分发到对应子表单；顶部一个「⚙ 切换到 JSON」开关。
  - `ApiKeyForm.tsx` / `HmacForm.tsx` / `OAuth2Form.tsx` / `TokenFetchForm.tsx`：各类型表单。
  - `RawJsonFallback.tsx`：现有的 `Input.TextArea` + JSON 校验，作为高级模式与解析失败兜底。
  - `TokenFetchTester.tsx`：「测试获取」按钮 + 可点选 JSON 结果树。
- `PluginEditorPage.tsx` 中那段 `noStyle shouldUpdate` 渲染的裸 `Input.TextArea`
  替换为 `<AuthConfigEditor authType=... name="authConfig" />`。`AUTH_CONFIG_HINTS`
  常量随之移除（提示下沉到各表单字段）。

### 表单 ⇄ JSON 转换

- 放在 `src/features/plugin/utils/authConfig.ts`：
  - `parseAuthConfig(authType, jsonStr): { mode: 'form' | 'raw', formValues?, raw }`
  - `serializeAuthConfig(authType, formValues): string`（输出严格对齐上表 snake_case 嵌套结构）
- 解析规则：`authConfig` 为空 → 表单模式（空表单）；能解析且结构匹配 → 表单模式并回填；
  解析失败或出现表单不认识的额外键 → 自动落到 raw 模式，**不报错**，让用户在 JSON 里继续编辑。
- 保存时：raw 模式直接存文本；表单模式 `serialize` 成字符串。沿用 `PluginEditorPage`
  既有的 `saveMut`（`pluginApi.update`），`authConfig` 仍是字符串字段，后端契约不变。

### token 路径选择交互（TOKEN_FETCH / OAUTH2）

- 「▶ 测试获取」调用新后端接口，把返回 body 渲染为 JSON 树（`react-json-view` 或自绘）。
- 用户点击某个叶子值 → 自动写入 `token_path`（展示成 `data.token` 的友好点号路径，
  serialize 时转成 `$.data.token`）。同理点选 `expire_path`。
- 友好路径 ⇄ JSONPath 的互转放在 `authConfig.ts`（`dotPathToJsonPath` / `jsonPathToDotPath`，
  仅支持点号 + 数组下标这类常见场景；复杂 JSONPath 落 raw 模式）。
- 测试前置：secret（如 `appKey`、`client_secret`）需先在「凭证」Tab 保存。未配置时
  测试按钮禁用并提示「请先到凭证 Tab 填写 xxx」。

## 后端设计（data-service）

### 新增测试接口

`POST /admin/plugin/plugins/{pluginId}/auth/test-fetch`

- 入参：草稿 `authConfig`（字符串或对象）。用该插件**已存储的凭证**填充 `{{secrets.x}}`。
- 行为：仅对 `OAUTH2` / `TOKEN_FETCH` 有效；执行换取 token 的 HTTP 请求，
  **只回传响应、不缓存、不注入、不解析 token_path**。
- 返回：`{ httpStatus, rawBody, parsedJson?, durationMs, error? }`。
- 权限：仅租户管理员可调（沿用 `PluginAdminController` 现有鉴权）。
- 安全：返回体不回显 secret 明文（secret 仅在服务端注入到请求，不进响应）；
  对 `url` 做基本校验，规避明显的内网 SSRF 探测（与现有 token 请求同等约束即可）。

### 复用与重构

- 从 `PluginTokenProvider` 抽出执行 token 请求的原始逻辑为 `fetchRaw(spec, secrets)`，
  返回原始响应（status + body），供测试接口与正式 `resolveToken` 共用，避免两套 HTTP 逻辑。
- 测试接口用 `GenericTokenAuthApplier.buildSpec` / `OAuth2...buildSpec` 复用同一份
  auth_config → `TokenFetchSpec` 的解析，保证「测试通过」与「真实运行」一致。

## 错误处理

- 前端：表单字段必填校验（如 TOKEN_FETCH 的 `token_request.url`）；测试接口失败时
  展示 `httpStatus` + `error` + 原始 body，不吞错。
- 解析历史 auth_config 失败 → 静默落 raw 模式（见上）。
- 后端测试接口：凭证缺失、URL 非法、目标接口超时/非 2xx，均返回结构化 `error` 而非抛 500。

## 测试

- 前端无测试框架（见 CLAUDE.md），以 `npm run typecheck` + `npm run lint`（`--max-warnings 0`）
  为准入，并手工在 dev 上走通四种类型的表单 ⇄ JSON 往返与「测试获取」。
- 后端：为 `fetchRaw` 抽取后的 `PluginTokenProvider` 与新接口补单测，沿用现有
  `*AuthApplierTest` / `PluginTokenProviderTest` 模式。注意运行后端测试命令不要加 `-am`。

## 不做（YAGNI）

- 不为 `API_KEY` / `HMAC` 做测试按钮（无 token 往返，价值低）。
- 不内置「常见服务商模板库」（第三方接口差异大，命中率不确定，后续可加）。
- 不支持任意复杂 JSONPath 的可视化点选（超出点号 + 下标的落 raw 模式）。
