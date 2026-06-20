# Skill 管理与详情 UI 重做 — 设计规范

- 日期：2026-06-20
- 分支：`feat/skill-detail-view`（jm-agent-front）
- 范围：纯前端视觉/交互重做，不改后端、不改 `api.ts` / `types.ts` 契约
- 目标：顺滑、美观、简洁、用起来舒服
- 关联：本次重做取代 `docs/superpowers/plans/2026-06-19-skill-management-ui.md` 产出的视觉层；功能行为（列表/详情/共享/启停/删除/AI 生成/上传）保持不变。

## 1. 现状与问题

- `src/pages/console/skill/SkillListPage.tsx`：AntD `Table` 列表，行内一排图标操作。信息密度高但观感平、缺层次。
- `src/pages/console/skill/SkillDetailDrawer.tsx`：`Drawer` 内用满屏 `bordered` 的 `Descriptions` + 纵向堆叠 `Collapse` 展示文件。重、挤、长滚动体验差。
- 两个文件**各抄了一份** `TYPE_LABEL / TYPE_COLOR / SCOPE_LABEL / SCOPE_COLOR / STATUS_LABEL / STATUS_COLOR / SOURCE_LABEL` 映射，重复且易漂移。

## 2. 设计方向

整体走「Linear / Vercel 式克制高级感」：浅灰底、深近黑主色、淡边框、大留白、状态用安静的「点+文字」徽标、操作 hover 才浮出。

### 2.1 作用域（关键约束）

slate/navy 令牌**只作用于 Skill 页面**，不动 `src/main.tsx` 的全局 `ConfigProvider`。
做法：新建作用域组件 `SkillTheme`（嵌套 `ConfigProvider`，带 `token` + 组件级 token 覆盖），包住列表页内容。

> ⚠️ 必须写进实现：`Drawer` 默认 portal 到 `body`，处于 `SkillTheme` 子树之外，**抽屉内容要单独再包一层 `SkillTheme`**（或给 `Drawer` 设 `getContainer={false}` 让其挂在 provider 子树内）。否则抽屉吃不到这套主题。全局 `cssVar: true` 已开，嵌套覆盖安全。

### 2.2 设计令牌

| 令牌           | 值                                                                    | 用途                                                  |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| `colorPrimary` | `#0F172A`（navy ink）                                                 | 主按钮、Segmented 选中、焦点环 → 高级黑灰，替代默认蓝 |
| 页面底色       | `#F8FAFC`（slate-50）                                                 | 卡片浮在浅灰底上                                      |
| 边框           | `#E2E8F0`（slate-200）                                                | 卡片/分隔线，极淡                                     |
| 主文字         | `#0F172A`；次文字 `#64748B`（slate-500）                              | 标题深、描述浅；次文字对白底对比 ≥4.5:1               |
| 圆角           | 卡片 `12`，控件 `8`                                                   | 更柔和                                                |
| 过渡           | `160ms ease`                                                          | hover/展开统一节奏                                    |
| 等宽栈         | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace` | 代码、ID（沿用现有）                                  |

- 动效遵守 `prefers-reduced-motion`：开启时关闭卡片位移/上浮，仅保留颜色过渡。
- 字体：默认沿用现有系统字体栈（不引入额外依赖）。`Plus Jakarta Sans` 列为**可选增强**，本期默认不引入。

### 2.3 语义色（点+文字配对，不靠颜色单独表意）

- 状态：启用 `#10B981`（翠绿点）· 停用 `#94A3B8`（灰点，不用红）· 草稿 `#F59E0B`（琥珀点）
- 类型芯片：Doer → 靛蓝描边淡填充；Prompt → 紫色描边淡填充
- 范围芯片：私有 → 中性；团队共享 → 蓝
- 来源：纯文字（AI 生成 / 上传 / 市场），不抢眼

## 3. 列表页（卡片网格）

### 3.1 布局

```
┌─────────────────────────────────────────────────────────────┐
│ 技能 Skills                              [✦ AI 生成] [上传]   │  标题区 + 一个深色主 CTA
│ 管理租户 Skill · 12 个                                        │
│                                                               │
│ [全部可见│我创建的]      🔍 搜索名称/描述      类型▾  状态▾   │  工具条
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────┐ ┌───────────────────────┐         │
│ │ ▢  pdf-to-word   ● 启用│ │ ▢  excel-merge  ● 启用 │  自适应网格
│ │ [Doer] [私有]          │ │ [Doer] [团队共享]      │  auto-fill, min 300px
│ │ 将 PDF 转换为 Word,    │ │ 合并多个 Excel 表格,   │  描述 2 行截断
│ │ 支持扫描版 OCR 识别…   │ │ 自动对齐表头…          │
│ │ ───────────────────── │ │ ───────────────────── │
│ │ AI 生成 · v1   查看 ⋯ │ │ 上传 · v3      查看 ⋯ │  hover 浮出操作
│ └───────────────────────┘ └───────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

- 标题区：标题 + 副标题计数；右侧主 CTA `AI 生成`（深色实心，带 ✦ 图标）+ 次按钮 `上传 SKILL.md`（描边）。一个页面只一个主 CTA。
- 工具条：`Segmented`【全部可见 | 我创建的】+ 搜索框（按名称/描述，客户端过滤）+ 类型筛选 + 状态筛选（轻量 `Select`）。
- 网格：CSS grid `repeat(auto-fill, minmax(300px, 1fr))`，gap 16。

### 3.2 卡片解剖（`SkillCard`）

- 左上：类型方角圆图标（按类型着色）+ 名称（600，单行截断）。
- 右上：状态点徽标（点+「启用/停用/草稿」）。
- 中部：类型芯片 + 范围芯片 + 描述（2 行 `-webkit-line-clamp` 截断，次文字色）。
- 底部分隔线下：左 `来源 · v{version}`；右 `查看` 按钮 + `⋯` 溢出菜单（共享/取消共享、启用/停用、删除[危险红]），**hover 淡入**。
- 整卡可点 → 打开详情抽屉；底部操作 `stopPropagation`。
- hover：上浮 2px + 轻阴影 + 边框变深，160ms（`reduced-motion` 时仅边框/阴影变化，不位移）。

### 3.3 列表状态

- 空状态：插画 + 「还没有技能」+ 两个 CTA（AI 生成 / 上传）。
- 加载：6 张骨架卡（`Skeleton`/shimmer），不再是单个 `Spin`。
- 过滤后为空（搜索/筛选无命中）：单独的「无匹配结果」空态 + 清除筛选入口。

## 4. 详情抽屉（重做 `SkillDetailDrawer`）

宽度 760 → **840**（代码更好读）。结构自上而下：

```
┃ ✕  pdf-to-word                                   ┃  ← sticky 头部
┃ [Doer] [私有] [● 启用]  v1                       ┃     标题 + 芯片
┃ 将 PDF 文件转换为 Word(.docx),支持 OCR 识别。   ┃     描述
┃ [共享]  [停用]  [删除]                           ┃     操作迁到头部
┃──────────────────────────────────────────────────┃
┃ 来源  AI 生成        所有人  2062…(等宽·可复制)  ┃  ← 轻量元数据条
┃                                                  ┃
┃ ▤ SKILL.md                              [复制]   ┃
┃ ┌── frontmatter(淡灰·等宽·dimmed)──────────────┐ ┃
┃ │ name / description …                         │ ┃
┃ └──────────────────────────────────────────────┘ ┃
┃ ┌── 正文(Markdown·舒适排版·限行宽)────────────┐ ┃
┃ │ # PDF 转 Word(含 OCR) …                      │ ┃
┃ └──────────────────────────────────────────────┘ ┃
┃ ▤ 文件 (3)                                       ┃  ← DOER 才有
┃ [README.md] requirements.txt  scripts/run.py     ┃     横向 tab 切换
┃ ┌── scripts/run.py        1.2 KB     [复制]─────┐ ┃
┃ │ import fitz …                                 │ ┃
┃ └──────────────────────────────────────────────┘ ┃
```

### 4.1 头部（`SkillDetailHeader`，sticky）

- 关闭 ✕ + 名称（h4，600）。
- 芯片行：类型、范围、状态（点+文字）、`v{version}`。
- 描述（次文字色，完整展示）。
- 操作行：上下文主操作（启用 ↔ 停用，按当前状态切换）、共享 ↔ 取消共享（按 scope 切换）、删除（危险文字按钮）。删除/停用走 `Popconfirm` 确认。
- sticky：滚动长 SKILL.md 时标题与操作常驻。

### 4.2 元数据条

- 类型/范围/状态已在头部芯片，这里**不重复**，只放：来源、所有人 ID（等宽、tabular、点击可复制 + toast）。
- 轻样式：label slate-500 小字，value slate-800；行用细分隔或留白分隔，**不用 bordered `Descriptions`**。
- 数据现状：`types.ts` 无创建/更新时间字段，故元数据条不杜撰时间字段。

### 4.3 SKILL.md 区

- 区块标题「SKILL.md」+ 文件图标 + `复制` 按钮（复制完整 `---frontmatter--- + body`）。
- frontmatter：沿用现有「用 name/description 拼回 `---\nname:…\ndescription:…\n---`」逻辑，渲染成淡灰等宽 dimmed 代码块。
- 正文：复用现有 `@/components/Markdown`，外层套舒适 prose 容器（标题层级、行高 1.6、限行宽，避免长行贴边）。
- `body` 为空时显示「无正文」。

### 4.4 文件区（`FileTabsViewer`，仅 DOER）

- 从「纵向堆叠 `Collapse`」改为 **横向 tab 切换 + 单文件代码查看器**。
- 单文件查看器头部：文件路径 + 大小（`size` 后端按字符串下发，展示前 `Number()` 兜底）+ `复制`。
- `.md` 文件渲染 Markdown；其它走等宽代码块（沿用现有 `codeBlockStyle`，改 slate 配色/圆角，横向滚动防撑破）。
- `binary` → 「（二进制文件，不支持预览）」占位；`truncated` → 「文件较大，仅展示前 512KB」警示芯片。
- 文件数 > 6 时降级为「左侧文件列表 + 右侧内容」两栏（tab 横排会挤）。
- `files` 为空 → `Empty`「无脚本文件」。

## 5. 共享与小重构

- 抽离单一来源 `src/features/skill/meta.tsx`：集中 `TYPE / SCOPE / STATUS / SOURCE` 的 label + color 映射，并导出复用组件 `SkillTypeChip`、`SkillScopeChip`、`SkillStatusDot`。列表页与抽屉都从这里取，消除两份重复映射。
- `api.ts`、`types.ts` 不动。

## 6. 组件清单（均小、单一职责）

| 组件                      | 职责                                       | 依赖                       |
| ------------------------- | ------------------------------------------ | -------------------------- |
| `SkillTheme`              | 作用域 `ConfigProvider`（slate/navy 令牌） | antd ConfigProvider        |
| `features/skill/meta.tsx` | label/color 单一来源 + 芯片/状态点组件     | antd Tag                   |
| `SkillCard`               | 单张技能卡（含 hover 操作）                | meta、Dropdown、Popconfirm |
| `SkillCardGrid`           | 自适应网格 + 空态 + 骨架                   | SkillCard、Skeleton、Empty |
| `SkillDetailHeader`       | 抽屉 sticky 头部（标题/芯片/描述/操作）    | meta、Popconfirm           |
| `FileTabsViewer`          | 文件 tab + 代码/Markdown 查看器            | Markdown、Tabs             |

`SkillListPage` / `SkillDetailDrawer` 收敛为薄壳，组合上述组件；现有 mutation（upload/share/unshare/enable/disable/remove）与 react-query key 全部保留。

## 7. 可访问性与质量门槛

- 状态恒「点 + 文字」配对，不靠颜色单独表意。
- 所有图标操作保留 `Tooltip` + `aria-label`；溢出菜单项有文字标签。
- 焦点环可见（navy ring）；卡片/按钮 hover 有 150–300ms 过渡。
- 次文字 slate-500 / 白底对比 ≥4.5:1。
- `prefers-reduced-motion` 下禁用位移类动效。
- 复制操作有 toast 反馈。

## 8. 非目标（YAGNI）

- 不引入全局主题改动（仅 Skill 页面作用域）。
- 不引入新字体依赖（Plus Jakarta Sans 仅可选，本期不做）。
- 不加版本历史/回滚、不加跨租户视图、不改后端字段或权限模型。
- 不做暗色模式（现有控制台为亮色，超出本期范围）。

## 9. 验收（按 jerry 硬性要求，本地实跑 + 看效果）

- `npm run typecheck` 与 `npm run lint`（`--max-warnings 0`）通过。
- docker `:8082` 重建容器后实测（jerry 实际访问 :8082，非 vite :5173）：
  - 列表卡片网格、搜索/筛选、hover 操作、空态、骨架。
  - 详情抽屉：sticky 头部、元数据条、SKILL.md 渲染、文件 tab 切换、复制 toast。
  - 共享/启停/删除/AI 生成/上传等行为与改版前一致。
