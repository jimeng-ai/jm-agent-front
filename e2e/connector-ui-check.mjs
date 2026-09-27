// 连接器卡片工作台 + URL 驱动 Inspector 的 UI 实跑校验。
// 只验「渲染得出来、数据接得上、交互点得动」，不替代后端的功能测试。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const failJson = (message) => ({
  success: false,
  respCode: '5900',
  respMsg: message,
  data: null,
});

const fulfillFailure = (route, message) =>
  route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify(failJson(message)),
  });

/** 只回传 marker 命中结果，避免 E2E 自己把凭据写进日志。 */
const inspectMutationCache = (page, marker) =>
  page.evaluate((secretMarker) => {
    const root = document.getElementById('root');
    const rootKey = Object.getOwnPropertyNames(root ?? {}).find((key) =>
      key.startsWith('__reactContainer$'),
    );
    const stack = rootKey ? [root[rootKey]] : [];
    const seen = new Set();
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || typeof fiber !== 'object' || seen.has(fiber)) continue;
      seen.add(fiber);
      const client = fiber.memoizedProps?.client;
      if (client && typeof client.getMutationCache === 'function') {
        const serialized = client
          .getMutationCache()
          .getAll()
          .map((mutation) => {
            try {
              return JSON.stringify(mutation.state.variables);
            } catch {
              return '';
            }
          });
        return {
          foundClient: true,
          mutationCount: serialized.length,
          containsMarker: serialized.some((value) => value.includes(secretMarker)),
        };
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.alternate) stack.push(fiber.alternate);
    }
    return { foundClient: false, mutationCount: 0, containsMarker: false };
  }, marker);

const successEnvelope = (data) => ({ success: true, respCode: '200', respMsg: 'ok', data });

const { browser, ctx, page } = await launchBrowser();
try {
  await login(page);

  // ---- 连接器列表页 ----
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connector-card-grid"]', { timeout: 10000 });
  await page.screenshot({ path: shot('connector-list.png') });

  const bodyText = await page.textContent('body');
  check('页面标题渲染', bodyText.includes('数据连接'));
  const cards = await page.$$('[data-testid="connector-card"]');
  check(
    '连接卡片渲染',
    cards.length > 0 && bodyText.includes('demo-shop'),
    `${cards.length} 张，来自真实接口`,
  );
  check(
    '四项摘要渲染',
    !!(await page.$('[data-testid="connector-summary-total"]')) &&
      !!(await page.$('[data-testid="connector-summary-healthy"]')) &&
      !!(await page.$('[data-testid="connector-summary-attention"]')) &&
      !!(await page.$('[data-testid="connector-summary-running"]')),
  );

  const mysqlCard = '[data-testid="connector-card"][data-connector-name="demo-shop"]';
  const mysqlCardText = await page.textContent(mysqlCard);
  check(
    '卡片固定四段安全轮廓',
    mysqlCardText.includes('账号权限') &&
      mysqlCardText.includes('平台写策略') &&
      mysqlCardText.includes('语义状态') &&
      mysqlCardText.includes('出库档位'),
  );
  check('类型展示 displayName 而非 kind', mysqlCardText.includes('MySQL'));
  check('能力已回填', mysqlCardText.includes('能查') && mysqlCardText.includes('能自描述'));

  // 搜索与异常筛选走真实列表；断言卡片集合，而不是只看输入框本身有值。
  const allCardCount = await page.locator('[data-testid="connector-card"]').count();
  await page.getByLabel('搜索数据连接').fill('demo-shop');
  await page.waitForTimeout(150);
  const searchedNames = await page.$$eval('[data-testid="connector-card"]', (items) =>
    items.map((item) => item.getAttribute('data-connector-name')),
  );
  check(
    '搜索按 name / displayName / kind / capability 收窄卡片',
    searchedNames.length > 0 && searchedNames.every((name) => name?.includes('demo-shop')),
    searchedNames.join(', '),
  );
  await page.getByLabel('搜索数据连接').fill('');
  await page.click('[aria-label="按待处理状态筛选"] .ant-select-selector');
  await page.click('.ant-select-dropdown:visible .ant-select-item-option:has-text("仅看需处理")');
  await page.waitForTimeout(150);
  const attentionCards = await page.locator('[data-testid="connector-card"]').count();
  const allAttention = await page.$$eval('[data-testid="connector-card"]', (items) =>
    items.every((item) => !!item.querySelector('.connector-card__issue')),
  );
  check(
    '异常筛选只保留需处理卡片',
    attentionCards > 0 && attentionCards < allCardCount && allAttention,
    `${attentionCards}/${allCardCount}`,
  );
  await page.click('button:has-text("清除筛选")');

  await page.setViewportSize({ width: 1280, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check('1280 宽度无横向滚动', !overflow);

  // ---- 新建 Drawer：schema 驱动表单 ----
  await page.click('button:has-text("新建连接")');
  await page.waitForSelector('[data-testid="connector-form-drawer"]');
  // 默认选中的是类型清单的第一项（注册表顺序是 [HTTP, MYSQL]，所以默认是 HTTP）。
  let formDrawer = await page.textContent('[data-testid="connector-form-drawer"]');
  await page.screenshot({ path: shot('connector-create-http.png') });
  check(
    'Drawer 目录完整',
    ['基本信息', '连接参数', '治理策略', '验证与保存'].every((t) => formDrawer.includes(t)),
  );
  check(
    '默认类型按 schema 渲染 HTTP 字段',
    formDrawer.includes('接口基地址') && !formDrawer.includes('库名'),
  );

  // 切类型 → 字段应【整组】换掉。前端没有任何 if (kind === ...) 分支，
  // 换掉这件事完全由后端下发的 schema 驱动——这是「新增类型前端零改动」的实证。
  await page.click(
    '[data-testid="connector-form-drawer"] .ant-form-item:has(label[for="kind"]) .ant-select-selector',
  );
  await sleep(600);
  await page.click('.ant-select-item-option:has-text("MySQL")');
  await sleep(900);
  formDrawer = await page.textContent('[data-testid="connector-form-drawer"]');
  await page.screenshot({ path: shot('connector-create-mysql.png') });
  check(
    '切到 MySQL 后字段整组替换',
    formDrawer.includes('主机地址') &&
      formDrawer.includes('库名') &&
      !formDrawer.includes('接口基地址'),
    'schema 驱动生效',
  );
  check('只读账号提示文案由后端 ParamSpec 下发', formDrawer.includes('只读账号'));

  // create payload 只能在短生命请求仓中停留，不得进 React Query MutationCache。
  const createSecretMarker = `create-cache-secret-${Date.now()}`;
  await page.fill('[data-testid="connector-form-drawer"] #name', `fixture-create-${Date.now()}`);
  await page.fill('[data-testid="connector-form-drawer"] #params_host', '127.0.0.1');
  await page.fill('[data-testid="connector-form-drawer"] #params_port', '3307');
  await page.fill('[data-testid="connector-form-drawer"] #params_database', 'fixture_db');
  await page.fill('[data-testid="connector-form-drawer"] #params_username', 'fixture_user');
  await page.fill('[data-testid="connector-form-drawer"] #params_password', createSecretMarker);
  let heldCreateRoute;
  let markCreateSeen;
  const createSeen = new Promise((resolve) => {
    markCreateSeen = resolve;
  });
  const holdCreate = (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    heldCreateRoute = route;
    markCreateSeen();
  };
  await page.route('**/admin/connectors', holdCreate);
  await page.click('[data-testid="connector-form-drawer"] button:has-text("创建并验证")');
  await createSeen;
  const createPendingCache = await inspectMutationCache(page, createSecretMarker);
  check(
    '创建在途时 MutationCache 不含凭据',
    createPendingCache.foundClient && !createPendingCache.containsMarker,
    `mutations=${createPendingCache.mutationCount}`,
  );
  await heldCreateRoute.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      successEnvelope({ id: 'fixture-created', sameTargetHint: null, writePolicy: 'FORBIDDEN' }),
    ),
  });
  await page.waitForSelector('[data-testid="connector-form-drawer"]', { state: 'hidden' });
  const createSettledCache = await inspectMutationCache(page, createSecretMarker);
  check(
    '创建完成后 MutationCache 仍不含凭据',
    createSettledCache.foundClient && !createSettledCache.containsMarker,
    `mutations=${createSettledCache.mutationCount}`,
  );
  await page.unroute('**/admin/connectors', holdCreate);
  await sleep(600);

  await page.click(`${mysqlCard} [data-testid="connector-card-more"]`);
  const moreMenu = await page.textContent('.ant-dropdown:visible');
  check(
    '卡片更多菜单动作完整',
    ['测试连接', '编辑', '停用', '删除'].every((text) => moreMenu.includes(text)),
  );
  await page.click('.ant-dropdown:visible .ant-dropdown-menu-item:has-text("编辑")');
  await page.waitForSelector('[data-testid="connector-form-drawer"]');
  const mysqlConnectorId = await page.getAttribute(mysqlCard, 'data-connector-id');
  const revealButton = page
    .locator(
      '[data-testid="connector-form-drawer"] button:has(.anticon-eye), ' +
        '[data-testid="connector-form-drawer"] button:has(.anticon-eye-invisible)',
    )
    .first();
  check(
    '凭据纯图标按钮有准确可访问名称',
    (await revealButton.count()) === 1 &&
      /查看.*明文|隐藏.*明文/.test((await revealButton.getAttribute('aria-label')) || ''),
  );

  // reveal 响应属于发起它的 SecretField 会话；Drawer 已关闭时，迟到错误
  // 不得穿透到全局 toast。
  const revealPattern = `**/admin/connectors/${mysqlConnectorId}/credential`;
  let heldRevealFailure;
  let markRevealFailureSeen;
  const revealFailureSeen = new Promise((resolve) => {
    markRevealFailureSeen = resolve;
  });
  const holdRevealFailure = (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    heldRevealFailure = route;
    markRevealFailureSeen();
  };
  await page.route(revealPattern, holdRevealFailure);
  await revealButton.click();
  await revealFailureSeen;
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="connector-form-drawer"]', { state: 'hidden' });
  await fulfillFailure(heldRevealFailure, 'fixture：已关闭凭据请求失败');
  await sleep(350);
  check(
    '延迟 reveal 失败在 Drawer 关闭后不弹 stale toast',
    (await page
      .locator('.ant-message-notice:has-text("fixture：已关闭凭据请求失败")')
      .count()) === 0,
  );
  await page.unroute(revealPattern, holdRevealFailure);

  await page.click(`${mysqlCard} [data-testid="connector-card-more"]`);
  await page.click('.ant-dropdown:visible .ant-dropdown-menu-item:has-text("编辑")');
  await page.waitForSelector('[data-testid="connector-form-drawer"]');

  // 进入「更换」即表示用户已否定旧 reveal 会话。迟到明文不得再写回；
  // 退出更换后仍应回到「已保存」占位，而不是显示迟到密码。
  const latePlaintext = `late-reveal-${Date.now()}`;
  let heldRevealSuccess;
  let markRevealSuccessSeen;
  const revealSuccessSeen = new Promise((resolve) => {
    markRevealSuccessSeen = resolve;
  });
  const holdRevealSuccess = (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    heldRevealSuccess = route;
    markRevealSuccessSeen();
  };
  await page.route(revealPattern, holdRevealSuccess);
  await page
    .locator('[data-testid="connector-form-drawer"] button[aria-label*="查看"]')
    .first()
    .click();
  await revealSuccessSeen;
  await page.click('[data-testid="connector-form-drawer"] button:has-text("更 换")');
  await page.fill('[data-testid="connector-form-drawer"] #params_password', 'replacement-draft');
  await heldRevealSuccess.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(successEnvelope({ password: latePlaintext })),
  });
  await sleep(350);
  check(
    '迟到 reveal success 不会覆盖更换中草稿',
    (await page.inputValue('[data-testid="connector-form-drawer"] #params_password')) ===
      'replacement-draft',
  );
  await page.click('[data-testid="connector-form-drawer"] button:has-text("取消更换")');
  await sleep(100);
  check(
    '退出更换后不会重新显示迟到明文',
    (await page.inputValue('[data-testid="connector-form-drawer"] #params_password')) !==
      latePlaintext,
  );
  await page.unroute(revealPattern, holdRevealSuccess);

  // 延迟 PUT 复现「旧 A 响应关掉新 B」。修复后提交期间 Esc / mask /
  // close 都不能丢掉 A 草稿；会话 token 则是额外的异步响应隔离。
  const updateSecretMarker = `update-cache-secret-${Date.now()}`;
  const draftA = `延迟保存 A ${Date.now()}`;
  const draftB = `新会话 B ${Date.now()}`;
  await page.fill('[data-testid="connector-form-drawer"] #displayName', draftA);
  await page.click('[data-testid="connector-form-drawer"] button:has-text("更 换")');
  await page.fill('[data-testid="connector-form-drawer"] #params_password', updateSecretMarker);
  let heldUpdateRoute;
  let markUpdateSeen;
  const updateSeen = new Promise((resolve) => {
    markUpdateSeen = resolve;
  });
  const holdUpdate = (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    heldUpdateRoute = route;
    markUpdateSeen();
  };
  const updatePattern = `**/admin/connectors/${mysqlConnectorId}`;
  await page.route(updatePattern, holdUpdate);
  await page
    .locator('[data-testid="connector-form-drawer"] button:has-text("保存")')
    .last()
    .click();
  await updateSeen;
  const updatePendingCache = await inspectMutationCache(page, updateSecretMarker);
  check(
    '更新在途时 MutationCache 不含凭据',
    updatePendingCache.foundClient && !updatePendingCache.containsMarker,
    `mutations=${updatePendingCache.mutationCount}`,
  );

  const pendingClose = page.locator('[data-testid="connector-form-drawer"] .ant-drawer-close');
  if ((await pendingClose.count()) > 0 && (await pendingClose.isEnabled())) {
    // 原生 click 故意跳过 Playwright 对关闭动画的 stable 等待：这里验的就是
    // 「提交中调用 close 不应生效」，而不是按钮的布局稳定性。
    await pendingClose.evaluate((button) => button.click());
  }
  await page.keyboard.press('Escape');
  await page.mouse.click(12, 450);
  await sleep(250);
  const drawerRetained = await page
    .locator('[data-testid="connector-form-drawer"]')
    .isVisible()
    .catch(() => false);
  const draftAInput = page.locator('[data-testid="connector-form-drawer"] #displayName');
  const draftARetained =
    drawerRetained &&
    (await draftAInput.count()) > 0 &&
    (await draftAInput.inputValue({ timeout: 500 }).catch(() => '')) === draftA;
  const pendingDraftRetained = drawerRetained && draftARetained;
  check('提交期间 Esc / mask / close 不丢草稿', pendingDraftRetained);

  // 绕过 overlay 调用底层真实「新建连接」handler，在 A 仍 hold 时切换到会话 B。
  // 这样断言真正依赖 session token：删掉 token guard 时，A 的 onSuccess 会关掉 B。
  await page.evaluate(() => {
    const createButton = [...document.querySelectorAll('.connector-workbench__header button')].find(
      (button) => button.textContent?.includes('新建连接'),
    );
    if (!(createButton instanceof HTMLButtonElement)) throw new Error('未找到新建连接按钮');
    createButton.click();
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="connector-form-drawer"]')?.textContent?.includes('新建连接'),
  );
  await page.fill('[data-testid="connector-form-drawer"] #displayName', draftB);
  await heldUpdateRoute.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(successEnvelope({ id: mysqlConnectorId, sameTargetHint: null })),
  });
  await sleep(400);
  const sessionBVisible = await page
    .locator('[data-testid="connector-form-drawer"]')
    .isVisible()
    .catch(() => false);
  const draftBRetained = sessionBVisible
    ? (await page.inputValue('[data-testid="connector-form-drawer"] #displayName')) === draftB
    : false;
  check('旧 A 响应不会关闭或污染新 B 会话', sessionBVisible && draftBRetained);
  const updateSettledCache = await inspectMutationCache(page, updateSecretMarker);
  check(
    '更新完成后 MutationCache 仍不含凭据',
    updateSettledCache.foundClient && !updateSettledCache.containsMarker,
    `mutations=${updateSettledCache.mutationCount}`,
  );
  await page.unroute(updatePattern, holdUpdate);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="connector-form-drawer"]', { state: 'hidden' });
  await sleep(500);

  // ---- 打开连接 → URL 驱动 Inspector → 使用记录 Tab ----
  await page.click(`${mysqlCard} button:has-text("打开连接")`);
  await page.waitForSelector('[data-testid="connector-inspector"]');
  check(
    'Inspector 深链写入 URL',
    /[?&]connector=\d+/.test(page.url()) && /[?&]tab=overview/.test(page.url()),
    page.url(),
  );
  const deepLink = page.url();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connector-overview-panel"]');
  check('刷新深链可直接恢复 Inspector', page.url() === deepLink);

  const semanticRequests = [];
  const observeSemantic = (request) => {
    if (/\/admin\/connectors\/\d+\/semantic(?:\?|$)/.test(request.url()))
      semanticRequests.push(request.url());
  };
  page.on('request', observeSemantic);
  await page.click('[data-testid="connector-inspector-tab-semantic"]');
  await page.waitForSelector('[data-testid="connector-semantic-summary"]');
  await sleep(500);
  const semanticHref = await page.getAttribute(
    '[data-testid="connector-semantic-summary"] a',
    'href',
  );
  check(
    '语义 Tab 只显示摘要且链接完整工作台',
    semanticRequests.length === 0 &&
      /\/console\/connectors\/\d+\/semantic$/.test(semanticHref || ''),
  );
  check(
    '语义入口没有嵌套交互元素',
    (await page
      .locator(
        '[data-testid="connector-semantic-summary"] a button, [data-testid="connector-semantic-summary"] button a',
      )
      .count()) === 0,
  );
  page.off('request', observeSemantic);

  // 语义工作台返回控制面的契约：直达编辑 Drawer，并把焦点交给数据出库档位。
  const connectorId = new URL(page.url()).searchParams.get('connector');
  await page.goto(
    `${BASE}/console/connectors?connector=${connectorId}&action=edit&section=semantic`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForSelector('[data-testid="connector-form-drawer"]');
  await page.waitForFunction(() => {
    const field = document.querySelector('[data-testid="connector-form-semantic-tier"]');
    return !!field && field.contains(document.activeElement);
  });
  check(
    'action=edit&section=semantic 直达编辑 Drawer 并聚焦档位',
    (await page.locator('[data-testid="connector-form-semantic-tier"]').count()) === 1 &&
      !(await page.locator('[data-testid="connector-inspector"]:visible').count()),
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="connector-form-drawer"]', { state: 'hidden' });
  await page.waitForSelector('[data-testid="connector-overview-panel"]');
  const afterEditClose = new URL(page.url());
  check(
    '关闭深链编辑后清理 action/section 并保留连接概览',
    !afterEditClose.searchParams.has('action') &&
      !afterEditClose.searchParams.has('section') &&
      afterEditClose.searchParams.get('connector') === connectorId &&
      afterEditClose.searchParams.get('tab') === 'overview',
  );

  // ---- 使用记录首次失败：真实原因 + 重试 ----
  const auditPattern = '**/admin/connectors/audit**';
  const auditInitialFailure = (route) => fulfillFailure(route, 'fixture：审计首次加载失败');
  await page.route(auditPattern, auditInitialFailure);
  await page.click('[data-testid="connector-inspector-tab-audit"]');
  await page.waitForSelector('[data-testid="connector-audit-panel"]');
  await page.waitForSelector('[data-testid="connector-audit-initial-error"]', { timeout: 10000 });
  let auditPanelText = await page.textContent('[data-testid="connector-audit-panel"]');
  check(
    'Audit 首次失败显示真实原因与重试',
    auditPanelText.includes('fixture：审计首次加载失败') && auditPanelText.includes('重试'),
  );
  await page.unroute(auditPattern, auditInitialFailure);
  await page.click('[data-testid="connector-audit-initial-error"] button:has-text("重试")');
  await page.waitForSelector('[data-testid="connector-audit-panel"] tr.ant-table-row');

  // 有缓存后的失败不能把旧记录替换成错误空态。
  await page.click('[data-testid="connector-inspector-tab-overview"]');
  const auditBackgroundFailure = (route) => fulfillFailure(route, 'fixture：审计后台刷新失败');
  await page.route(auditPattern, auditBackgroundFailure);
  await page.click('[data-testid="connector-inspector-tab-audit"]');
  await page.waitForSelector('[data-testid="connector-audit-background-error"]', {
    timeout: 10000,
  });
  auditPanelText = await page.textContent('[data-testid="connector-audit-panel"]');
  check(
    'Audit 后台刷新失败保留旧记录并可重试',
    auditPanelText.includes('fixture：审计后台刷新失败') &&
      (await page.locator('[data-testid="connector-audit-panel"] tr.ant-table-row').count()) > 0,
  );
  await page.unroute(auditPattern, auditBackgroundFailure);
  await page.click('[data-testid="connector-audit-background-error"] button:has-text("重试")');
  await page.waitForSelector('[data-testid="connector-audit-background-error"]', {
    state: 'detached',
  });
  // 审计只增不减；结构刷新跑多了会把早期 conn_query 挤出默认 20 条，扩大到 100 再验历史语句。
  const pageSize = await page.$(
    '[data-testid="connector-audit-panel"] .ant-pagination-options .ant-select-selector',
  );
  if (pageSize) {
    await pageSize.click();
    await page.click('.ant-select-dropdown:visible .ant-select-item-option:has-text("100")');
    await sleep(1000);
  }
  await page.screenshot({ path: shot('connector-audit-inspector.png') });
  const inspector = await page.textContent('[data-testid="connector-inspector"]');
  check('Inspector 打开使用记录', inspector.includes('使用记录'));
  check('审计行来自真实接口', /conn_query|conn_catalog|platform\.schema_refresh/.test(inspector));
  const agentCells = await page.$$eval(
    '[data-testid="connector-audit-panel"] tr.ant-table-row td:nth-child(3)',
    (cells) => cells.map((cell) => cell.textContent.trim()).filter(Boolean),
  );
  check(
    'Agent 名已解析（不是雪花 id）',
    agentCells.length > 0 && agentCells.every((name) => !/^\d{12,}$/.test(name)),
    agentCells.slice(0, 3).join(' / '),
  );
  // 断言「失败行带着九类错误码之一」，不写死某一个码：
  // 这张表只增不减，钉死具体码等于把断言绑在某一次历史调用上。
  const CODES =
    /UNREACHABLE|AUTH_FAILED|FORBIDDEN|NOT_FOUND|TIMEOUT|RATE_LIMITED|RESULT_TOO_LARGE|UPSTREAM_ERROR|CONFIG_ERROR/;

  // 真实审计只增不减：频繁跑结构刷新后，早期 conn_query 即使把分页拉到 100 也会被挤出去。
  // 上面的真实接口、真实行和 Agent 解析已经验过；下面用受控的成功/失败记录专门验证展开详情与筛选，
  // 避免把 UI 行为断言绑在会随时间衰减的历史 seed 上。
  let auditFixtureRequests = 0;
  const auditRows = [
    {
      id: 'fixture-audit-query',
      time: '2099-01-02T10:00:00',
      connectorId,
      connectorName: 'demo-shop',
      agentName: '经营分析助手',
      capability: 'QUERY',
      operation: 'conn_query',
      traceId: 'fixture-trace-query',
      rowCount: '4',
      elapsedMs: '12',
      success: true,
      statementText: 'SELECT id, amount FROM orders ORDER BY id DESC LIMIT 100',
    },
    {
      id: 'fixture-audit-failure',
      time: '2099-01-02T09:00:00',
      connectorId,
      connectorName: 'demo-shop',
      agentName: null,
      capability: 'QUERY',
      operation: 'conn_query',
      traceId: 'fixture-trace-failure',
      rowCount: null,
      elapsedMs: '30000',
      success: false,
      errorCode: 'TIMEOUT',
      errorDetail: '查询超时，请收窄范围后重试',
      statementText: null,
    },
  ];
  const auditFixture = async (route) => {
    const success = new URL(route.request().url()).searchParams.get('success');
    const records =
      success === 'true'
        ? auditRows.filter((row) => row.success)
        : success === 'false'
          ? auditRows.filter((row) => !row.success)
          : auditRows;
    auditFixtureRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        successEnvelope({
          records,
          total: String(records.length),
          size: '100',
          current: '1',
          pages: '1',
        }),
      ),
    });
  };
  await page.route(auditPattern, auditFixture);
  await page.click('[data-testid="connector-inspector-tab-overview"]');
  await page.click('[data-testid="connector-inspector-tab-audit"]');
  await page.waitForSelector(
    '[data-testid="connector-audit-panel"] tr[data-row-key="fixture-audit-query"]',
    { timeout: 10000 },
  );
  check('受控审计详情实际命中接口', auditFixtureRequests > 0, `${auditFixtureRequests} 次`);

  // 展开【有语句的那一行】。不能随便展开第一行——失败记录可以没有语句，
  // 那样的断言会因为「没东西可看」而空转通过。
  const queryRow = await page.$(
    '[data-testid="connector-audit-panel"] tr[data-row-key="fixture-audit-query"] .ant-table-row-expand-icon',
  );
  if (queryRow) {
    await queryRow.click();
    await sleep(900);
    await page.screenshot({ path: shot('connector-audit-expanded.png') });
    const expanded = await page.textContent('[data-testid="connector-audit-panel"]');
    check('展开后看到平台实际执行的语句', expanded.includes('平台实际执行的语句'));
    check(
      '正确展示后端返回的实际执行语句及 LIMIT',
      /LIMIT\s+\d+/i.test(expanded),
      '这条正是「查数必须亮出过程」在界面渲染时的落点',
    );
  } else {
    check('展开行可用', false, '找不到 conn_query 行的展开图标');
  }

  // 筛选：切到「仅失败」后，表体里只该剩失败那条。
  await page.click('[data-testid="connector-audit-panel"] .ant-segmented-item:has-text("仅失败")');
  await page.waitForSelector(
    '[data-testid="connector-audit-panel"] tr[data-row-key="fixture-audit-failure"]',
    { timeout: 10000 },
  );
  await page.waitForSelector(
    '[data-testid="connector-audit-panel"] tr[data-row-key="fixture-audit-query"]',
    { state: 'detached', timeout: 10000 },
  );
  await page.screenshot({ path: shot('connector-audit-failed-only.png') });
  // 只读表体，不读整个抽屉——顶部那段说明里就写着「查目录、看结构」之类的字样，
  // 拿整个抽屉的文本做「不包含」断言会被说明文案带偏。
  const tbody = await page.textContent('[data-testid="connector-audit-panel"] .ant-table-tbody');
  // 断言不变量而不是固定条数：审计只增不减，「恰好 1 行」这种写法迟早会因为多跑了一次调用而假红。
  // 真正要守的是：筛完之后剩下的每一行都是失败行，且每行都带错误码。
  const statuses = await page.$$eval(
    '[data-testid="connector-audit-panel"] .ant-table-tbody tr.ant-table-row',
    (rs) => rs.map((r) => r.innerText),
  );
  const allFailed = statuses.length > 0 && statuses.every((t) => t.includes('失败'));
  check('失败行带错误码', CODES.test(tbody));
  check('「仅失败」筛选生效', allFailed && !/成功/.test(tbody), `表体行数=${statuses.length}`);
  await page.unroute(auditPattern, auditFixture);

  // ---- Inspector 有缓存后的详情失败：保留旧详情 + 非阻断重试 ----
  await page.click('[data-testid="connector-inspector-close"]');
  await page.waitForSelector('[data-testid="connector-inspector"]', { state: 'hidden' });
  const detailPattern = '**/*';
  const detailBackgroundFailure = (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === 'POST' &&
      url.pathname.endsWith(`/admin/connectors/${connectorId}/test`)
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          respCode: '200',
          respMsg: 'ok',
          data: { id: connectorId, healthState: 'HEALTHY', healthReason: null },
        }),
      });
    }
    if (
      route.request().method() === 'GET' &&
      url.pathname.endsWith(`/admin/connectors/${connectorId}`)
    ) {
      return fulfillFailure(route, 'fixture：详情后台刷新失败');
    }
    return route.continue();
  };
  await page.route(detailPattern, detailBackgroundFailure);
  // mock 安全测试动作，只利用其既有 cache invalidation 触发详情后台拉取，不触碰真实连接状态。
  await page.click(`${mysqlCard} [data-testid="connector-card-more"]`);
  await page.click('.ant-dropdown:visible .ant-dropdown-menu-item:has-text("测试连接")');
  await page.waitForTimeout(250);
  await page.click(`${mysqlCard} button:has-text("打开连接")`);
  await page.waitForSelector('[data-testid="connector-inspector-background-error"]', {
    timeout: 10000,
  });
  const detailWithError = await page.textContent('[data-testid="connector-inspector"]');
  check(
    'Inspector 后台刷新失败保留旧详情并可重试',
    detailWithError.includes('fixture：详情后台刷新失败') &&
      detailWithError.includes('账号权限') &&
      (await page
        .locator('[data-testid="connector-inspector-background-error"] button')
        .count()) === 1,
    detailWithError.slice(0, 160),
  );
  await page.unroute(detailPattern, detailBackgroundFailure);
  // 重载只用于把 fixture 路由彻底移出这次浏览器状态；重试动作本身已由 Audit/Schema 覆盖。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connector-overview-panel"]');

  // 1440/1280 保持宽 Inspector；到 1024（含）真正占满视口，并且三个断点都不造页面横向滚动。
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(250);
    const box = await page.locator('.ant-drawer-content-wrapper:visible').last().boundingBox();
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    const widthOk =
      width <= 1024
        ? !!box &&
          box.width >= width - 2.5 &&
          box.x <= 2.5 &&
          Math.abs(box.x + box.width - width) <= 2.5
        : !!box && box.width >= 840 && box.width < width;
    check(`${width} Inspector 宽度符合断点`, widthOk, JSON.stringify(box));
    check(`${width} 无横向溢出`, !pageOverflow);
  }

  // ---- 列表有缓存后的失败：保留卡片 + 非阻断重试 ----
  await page.click('[data-testid="connector-inspector-close"]');
  const listPattern = '**/*';
  const listBackgroundFailure = (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === 'POST' &&
      url.pathname.endsWith(`/admin/connectors/${connectorId}/test`)
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          respCode: '200',
          respMsg: 'ok',
          data: { id: connectorId, healthState: 'HEALTHY', healthReason: null },
        }),
      });
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/admin/connectors')) {
      return fulfillFailure(route, 'fixture：连接列表后台刷新失败');
    }
    return route.continue();
  };
  await page.route(listPattern, listBackgroundFailure);
  await page.click(`${mysqlCard} [data-testid="connector-card-more"]`);
  await page.click('.ant-dropdown:visible .ant-dropdown-menu-item:has-text("测试连接")');
  await page.waitForSelector('[data-testid="connector-list-background-error"]', { timeout: 10000 });
  const cachedCards = await page.locator('[data-testid="connector-card"]').count();
  const listErrorText = await page.textContent('[data-testid="connector-list-background-error"]');
  check(
    '列表后台刷新失败保留卡片并可重试',
    cachedCards > 0 && listErrorText.includes('fixture：连接列表后台刷新失败'),
  );
  await page.unroute(listPattern, listBackgroundFailure);
  await page.click('[data-testid="connector-list-background-error"] button:has-text("重试")');
  await page.waitForSelector('[data-testid="connector-list-background-error"]', {
    state: 'detached',
  });

  // ---- 纯前端安全 fixture：风险优先级、CTA、搜索/异常筛选、键盘与 reduced-motion ----
  const fixturePage = await ctx.newPage();
  const baseFixture = {
    kind: 'MYSQL',
    kindLabel: 'MySQL',
    params: {},
    status: 'ACTIVE',
    capabilities: ['QUERY', 'DESCRIBE'],
    healthState: 'HEALTHY',
    healthReason: null,
    readonlyVerified: true,
    writePolicy: 'FORBIDDEN',
    writePolicyLabel: '只读',
    semanticStatus: 'READY',
    semanticCoverage: 'COMPLETE',
    semanticGaps: [],
    semanticDataTier: 'DERIVED_STATS',
    semanticDataTierLabel: '第 2 档 · 派生统计',
    semanticDataTierEgress: '仅派生统计出库。',
  };
  const fixtureRows = [
    { ...baseFixture, id: 'fixture-safe', name: 'safe-fixture', displayName: '健康连接' },
    {
      ...baseFixture,
      id: 'fixture-retry',
      name: 'retry-fixture',
      displayName: '异常连接',
      healthState: 'UNHEALTHY',
      healthReason: 'fixture unreachable',
      readonlyVerified: false,
    },
    {
      ...baseFixture,
      id: 'fixture-gap',
      name: 'gap-fixture',
      displayName: '缺口连接',
      semanticCoverage: 'PARTIAL',
      semanticGaps: ['TRUNCATED'],
    },
  ];
  const heldFixtureTests = new Map();
  const heldFixtureStatuses = new Map();
  let lifecycleTestActive = true;
  let lifecycleTestRoute;
  let lifecycleTestPostCount = 0;
  let markLifecycleTestSeen;
  const lifecycleTestSeen = new Promise((resolve) => {
    markLifecycleTestSeen = resolve;
  });
  let markTwoTestsSeen;
  let markTwoStatusesSeen;
  const twoTestsSeen = new Promise((resolve) => {
    markTwoTestsSeen = resolve;
  });
  const twoStatusesSeen = new Promise((resolve) => {
    markTwoStatusesSeen = resolve;
  });
  await fixturePage.route('**/admin/connectors**', (route) => {
    const url = new URL(route.request().url());
    const testMatch = url.pathname.match(/\/admin\/connectors\/([^/]+)\/test$/);
    if (route.request().method() === 'POST' && testMatch) {
      if (lifecycleTestActive && testMatch[1] === 'fixture-retry') {
        lifecycleTestPostCount += 1;
        if (lifecycleTestPostCount === 1) {
          lifecycleTestRoute = route;
          markLifecycleTestSeen();
          return;
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            successEnvelope({
              ...baseFixture,
              id: 'fixture-retry',
              name: 'retry-fixture',
              displayName: '异常连接',
            }),
          ),
        });
      }
      heldFixtureTests.set(testMatch[1], route);
      if (heldFixtureTests.size === 2) markTwoTestsSeen();
      return;
    }
    const statusMatch = url.pathname.match(/\/admin\/connectors\/([^/]+)\/status$/);
    if (route.request().method() === 'POST' && statusMatch) {
      heldFixtureStatuses.set(statusMatch[1], route);
      if (heldFixtureStatuses.size === 2) markTwoStatusesSeen();
      return;
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/admin/connectors')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, respCode: '200', respMsg: 'ok', data: fixtureRows }),
      });
    }
    return route.continue();
  });
  await fixturePage.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await fixturePage.waitForSelector('[data-testid="connector-card-grid"]');
  const retryCard = '[data-testid="connector-card"][data-connector-name="retry-fixture"]';
  const gapCard = '[data-testid="connector-card"][data-connector-name="gap-fixture"]';
  const safeCard = '[data-testid="connector-card"][data-connector-name="safe-fixture"]';
  check(
    '卡片只突出最高优先风险',
    (await fixturePage.locator(`${retryCard} .connector-card__issue`).count()) === 1,
  );
  check(
    '卡片主 CTA 按风险状态化',
    (await fixturePage.locator(`${retryCard} button:has-text("重新测试")`).count()) === 1 &&
      (await fixturePage.locator(`${gapCard} a:has-text("查看缺口")`).count()) === 1 &&
      (await fixturePage.locator(`${safeCard} button:has-text("打开连接")`).count()) === 1,
  );
  const gapHref = await fixturePage.getAttribute(`${gapCard} a:has-text("查看缺口")`, 'href');
  check('语义缺口 CTA 是完整工作台深链', gapHref === '/console/connectors/fixture-gap/semantic');
  await fixturePage.getByLabel('搜索数据连接').fill('gap-fixture');
  check(
    'fixture 搜索只保留命中卡片',
    (await fixturePage.locator('[data-testid="connector-card"]').count()) === 1,
  );
  await fixturePage.getByLabel('搜索数据连接').fill('');
  await fixturePage.click('[aria-label="按待处理状态筛选"] .ant-select-selector');
  await fixturePage.click(
    '.ant-select-dropdown:visible .ant-select-item-option:has-text("仅看需处理")',
  );
  check(
    'fixture 异常筛选保留两张风险卡',
    (await fixturePage.locator('[data-testid="connector-card"]').count()) === 2,
  );
  await fixturePage.click('button:has-text("清除筛选")');

  // pending mutation 活在 QueryClient 里，不属于某次 ConnectorListPage mount。
  // SPA 离开再返回后仍应恢复 busy，并阻止对同一连接/动作重复发 POST。
  await fixturePage.click(`${retryCard} button:has-text("重新测试")`);
  await lifecycleTestSeen;
  await fixturePage.getByRole('button', { name: 'Agents', exact: true }).click();
  await fixturePage.waitForURL('**/console/agents');
  await fixturePage.getByRole('button', { name: '数据连接', exact: true }).click();
  await fixturePage.waitForURL('**/console/connectors');
  await fixturePage.waitForSelector(retryCard);
  const busyAfterSpaReturn = (await fixturePage.getAttribute(retryCard, 'aria-busy')) === 'true';
  await fixturePage
    .locator(`${retryCard} button:has-text("重新测试")`)
    .evaluate((button) => {
      // 移除 DOM disabled 来直接验证 handler 的 MutationCache 防重，不只依赖视觉禁用。
      button.removeAttribute('disabled');
      button.click();
    });
  await sleep(200);
  check('SPA 离开再返回仍恢复卡片 busy', busyAfterSpaReturn);
  check('返回后重复点击不新增 test POST', lifecycleTestPostCount === 1);
  lifecycleTestActive = false;
  await lifecycleTestRoute.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      successEnvelope({
        ...baseFixture,
        id: 'fixture-retry',
        name: 'retry-fixture',
        displayName: '异常连接',
      }),
    ),
  });
  await fixturePage.waitForFunction(() => {
    const retry = document.querySelector('[data-connector-name="retry-fixture"]');
    return retry?.getAttribute('aria-busy') === 'false';
  });

  // 同一 mutation hook 可以并发操作多张卡。忙碌态必须跟踪 connectorId + action
  // 的全集，不能只看 useMutation.variables 中最后一次调用。
  await fixturePage.click(`${retryCard} button:has-text("重新测试")`);
  await fixturePage.click(`${safeCard} [data-testid="connector-card-more"]`);
  await fixturePage.click('.ant-dropdown:visible .ant-dropdown-menu-item:has-text("测试连接")');
  await twoTestsSeen;
  check(
    '两张卡并发测试时都保持 busy',
    (await fixturePage.getAttribute(retryCard, 'aria-busy')) === 'true' &&
      (await fixturePage.getAttribute(safeCard, 'aria-busy')) === 'true',
  );
  await heldFixtureTests.get('fixture-safe').fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      successEnvelope({
        ...baseFixture,
        id: 'fixture-safe',
        name: 'safe-fixture',
        displayName: '健康连接',
      }),
    ),
  });
  await fixturePage.waitForFunction(() => {
    const safe = document.querySelector('[data-connector-name="safe-fixture"]');
    return safe?.getAttribute('aria-busy') === 'false';
  });
  check(
    'B 测试先完成不会提前解除 A busy',
    (await fixturePage.getAttribute(retryCard, 'aria-busy')) === 'true',
  );
  await heldFixtureTests.get('fixture-retry').fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      successEnvelope({
        ...baseFixture,
        id: 'fixture-retry',
        name: 'retry-fixture',
        displayName: '异常连接',
      }),
    ),
  });
  await fixturePage.waitForFunction(() => {
    const retry = document.querySelector('[data-connector-name="retry-fixture"]');
    return retry?.getAttribute('aria-busy') === 'false';
  });

  await fixturePage.click(`${safeCard} [data-testid="connector-card-more"]`);
  await fixturePage
    .locator('.ant-dropdown-menu-item:has-text("停用"):visible')
    .last()
    .click();
  await fixturePage.click(`${gapCard} [data-testid="connector-card-more"]`);
  await fixturePage
    .locator('.ant-dropdown-menu-item:has-text("停用"):visible')
    .last()
    .click();
  await twoStatusesSeen;
  check(
    '两张卡并发改状态时都保持 busy',
    (await fixturePage.getAttribute(safeCard, 'aria-busy')) === 'true' &&
      (await fixturePage.getAttribute(gapCard, 'aria-busy')) === 'true',
  );
  await heldFixtureStatuses.get('fixture-gap').fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(successEnvelope({ status: 'DISABLED' })),
  });
  await fixturePage.waitForFunction(() => {
    const gap = document.querySelector('[data-connector-name="gap-fixture"]');
    return gap?.getAttribute('aria-busy') === 'false';
  });
  check(
    'B 状态先完成不会提前解除 A busy',
    (await fixturePage.getAttribute(safeCard, 'aria-busy')) === 'true',
  );
  await heldFixtureStatuses.get('fixture-safe').fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(successEnvelope({ status: 'DISABLED' })),
  });
  await fixturePage.waitForFunction(() => {
    const safe = document.querySelector('[data-connector-name="safe-fixture"]');
    return safe?.getAttribute('aria-busy') === 'false';
  });

  await fixturePage.emulateMedia({ reducedMotion: 'reduce' });
  const safeCta = fixturePage.locator(`${safeCard} button:has-text("打开连接")`);
  await safeCta.focus();
  const focusAndMotion = await fixturePage.evaluate(() => {
    const card = document.querySelector('[data-connector-name="safe-fixture"]');
    const active = document.activeElement;
    return {
      focused: active?.textContent?.includes('打开连接') === true,
      transitionDuration: card ? getComputedStyle(card).transitionDuration : 'missing',
      transform: card ? getComputedStyle(card).transform : 'missing',
    };
  });
  check('主 CTA 可由键盘聚焦', focusAndMotion.focused);
  check(
    'reduced-motion 下卡片不位移、不做过渡',
    focusAndMotion.transitionDuration === '0s' && focusAndMotion.transform === 'none',
    JSON.stringify(focusAndMotion),
  );
  await fixturePage.close();
} catch (e) {
  console.log('  ✗ 异常中断:', e.message);
  await page.screenshot({ path: shot('connector-ui-error.png') }).catch(() => {});
  results.push({ name: '脚本执行', ok: false, detail: e.message });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
