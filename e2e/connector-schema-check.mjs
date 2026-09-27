// 结构快照与漂移检测的 UI 实跑。
// 核心验证：真的去改客户库的结构，页面上能不能看见。
import { execSync } from 'node:child_process';
import { CONFIG, launchBrowser, login, shot } from './lib.mjs';

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

/** 直接对客户库做 DDL，模拟「客户悄悄改了结构」。 */
const customerDdl = (sql) =>
  execSync(
    `docker exec -i dev-mysql mysql --default-character-set=utf8mb4 -uroot -p123456 demo_shop -Nse ${JSON.stringify(sql)} 2>/dev/null`,
    { encoding: 'utf8' },
  );

const artifactCounts = () => ({
  coupons: Number(
    customerDdl(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='demo_shop' AND table_name='coupons'",
    ).trim(),
  ),
  promoCode: Number(
    customerDdl(
      "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='demo_shop' AND table_name='orders' AND column_name='promo_code'",
    ).trim(),
  ),
});

/** 幂等清理：测试被 Ctrl-C / 断言异常打断过，也能从干净客户库重新开始。 */
const cleanupCustomerArtifacts = () => {
  customerDdl('DROP TABLE IF EXISTS coupons');
  if (artifactCounts().promoCode > 0) {
    customerDdl('ALTER TABLE orders DROP COLUMN promo_code');
  }
};

const isRefreshRequest = (request) => {
  const url = new URL(request.url());
  return request.method() === 'POST' && /\/admin\/connectors\/[^/]+\/schema\/refresh$/.test(url.pathname);
};

const openSchemaPanel = async (page) => {
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connector-card-grid"]');
  await page.click(
    '[data-testid="connector-card"][data-connector-name="demo-shop"] button:has-text("打开连接")',
  );
  await page.waitForSelector('[data-testid="connector-inspector"]');
  await page.click('[data-testid="connector-inspector-tab-schema"]');
  await page.waitForSelector('[data-testid="connector-schema-panel"]');
};

const waitForRefreshAction = async (page, action) => {
  // 先拿到【这次 action 新发出的 request】，再等它自己的 response。只等 response URL
  // 会误接住前一轮还在途的响应，让下一轮刷新在后台重叠执行。
  const requestPromise = page.waitForRequest(isRefreshRequest, { timeout: 30000 });
  await action();
  const request = await requestPromise;
  const response = await request.response();
  if (!response) throw new Error('结构刷新请求结束但没有可读取的响应');
  await response.finished();
  // response.finished 是网络完成，不等于 axios/react-query 已经提交完 UI；等两个渲染帧后，
  // 再以 pending 按钮真实复位作为 settled 条件。
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      ),
  );
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="connector-schema-panel"]');
      const el = [...(panel?.querySelectorAll('button') ?? [])].find((candidate) =>
        candidate.textContent?.includes('刷新结构'),
      );
      return !!el && !el.classList.contains('ant-btn-loading') && !el.hasAttribute('disabled');
    },
    undefined,
    { timeout: 30000 },
  );
  return response;
};

const refresh = (page) =>
  waitForRefreshAction(page, () =>
    page.click('[data-testid="connector-schema-panel"] button:has-text("刷新结构")'),
  );

const { browser, page } = await launchBrowser();
let primaryError = null;
try {
  cleanupCustomerArtifacts();
  await login(page);

  // ---- 只有支持自描述的连接器才有「结构」Tab ----
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connector-card-grid"]');
  await page.click(
    '[data-testid="connector-card"][data-connector-name="demo-shop"] button:has-text("打开连接")',
  );
  await page.waitForSelector('[data-testid="connector-inspector"]');
  const schemaTab = await page
    .waitForSelector('[data-testid="connector-inspector-tab-schema"]', { timeout: 10000 })
    .catch(() => null);
  check('有 DESCRIBE 能力的连接器给「结构」入口', !!schemaTab);
  await page.click('[data-testid="connector-inspector-close"]');
  const noDescribeCard = page
    .locator('[data-testid="connector-card"]')
    .filter({ hasNotText: '能自描述' })
    .first();
  if (await noDescribeCard.count()) {
    await noDescribeCard.locator('button:has-text("打开连接")').click();
    await page.waitForSelector('[data-testid="connector-inspector"]');
    check(
      '没有 DESCRIBE 能力的不给（给了只会点了报错）',
      !(await page.$('[data-testid="connector-inspector-tab-schema"]')),
    );
  } else {
    check(
      '没有 DESCRIBE 能力的不给（给了只会点了报错）',
      false,
      '当前租户没有无 DESCRIBE 能力的连接',
    );
  }

  // ---- 首次错误：真实原因 + 重试 ----
  const schemaPattern = '**/admin/connectors/*/schema';
  const initialFailure = (route) => fulfillFailure(route, 'fixture：结构首次加载失败');
  await page.route(schemaPattern, initialFailure);
  await openSchemaPanel(page);
  await page.waitForSelector('[data-testid="connector-schema-initial-error"]', { timeout: 10000 });
  let panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check(
    'Schema 首次失败显示真实原因与重试',
    panel.includes('fixture：结构首次加载失败') && panel.includes('重试'),
  );
  await page.unroute(schemaPattern, initialFailure);
  await page.click('[data-testid="connector-schema-initial-error"] button:has-text("重试")');
  await page.waitForSelector('[data-testid="connector-schema-panel"] tr.ant-table-row');

  // 有快照缓存后重新打开 Inspector 再次拉取失败，旧快照必须继续可见。
  // Tab 内切换现在刻意保持 Schema Panel 挂载，不再拿切 Tab 当“重新请求”的手段。
  await page.click('[data-testid="connector-inspector-close"]');
  await page.waitForSelector('[data-testid="connector-inspector"]', { state: 'hidden' });
  const backgroundFailure = (route) => fulfillFailure(route, 'fixture：结构后台刷新失败');
  await page.route(schemaPattern, backgroundFailure);
  await page.click(
    '[data-testid="connector-card"][data-connector-name="demo-shop"] button:has-text("打开连接")',
  );
  await page.waitForSelector('[data-testid="connector-inspector"]');
  await page.click('[data-testid="connector-inspector-tab-schema"]');
  await page.waitForSelector('[data-testid="connector-schema-background-error"]', {
    timeout: 10000,
  });
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check(
    'Schema 后台拉取失败保留旧快照并可重试',
    panel.includes('fixture：结构后台刷新失败') && panel.includes('orders'),
  );
  await page.unroute(schemaPattern, backgroundFailure);
  await page.click('[data-testid="connector-schema-background-error"] button:has-text("重试")');
  await page.waitForSelector('[data-testid="connector-schema-background-error"]', {
    state: 'detached',
  });

  // ---- 打开并刷新，建立基线 ----
  await refresh(page);
  await page.screenshot({ path: shot('schema-baseline.png') });
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check('结构表渲染', panel.includes('orders'));
  check('展示上次同步时间', panel.includes('上次同步'));

  // 手动刷新本身失败也必须是非阻断告警：旧快照还在，且可以从告警处重试。
  const refreshPattern = '**/admin/connectors/*/schema/refresh';
  const refreshFailure = (route) => fulfillFailure(route, 'fixture：刷新结构请求失败');
  await page.route(refreshPattern, refreshFailure);
  await refresh(page);
  await page.waitForSelector('[data-testid="connector-schema-refresh-error"]', { timeout: 10000 });
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check(
    '刷新结构失败保留旧快照并提供就地重试',
    panel.includes('fixture：刷新结构请求失败') && panel.includes('orders'),
  );
  await page.unroute(refreshPattern, refreshFailure);
  await waitForRefreshAction(page, () =>
    page.click('[data-testid="connector-schema-refresh-error"] button:has-text("重试")'),
  );
  await page.waitForSelector('[data-testid="connector-schema-refresh-error"]', {
    state: 'detached',
  });

  // ---- 空刷：不该误报 ----
  await refresh(page);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="connector-schema-panel"]')
        ?.textContent?.includes('结构没有变化'),
    undefined,
    { timeout: 10000 },
  );
  await page.waitForSelector('.ant-message-error', { state: 'detached' });
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check('结构没变时明确说「没有变化」', panel.includes('结构没有变化'), '验证无误报');

  // ---- 真改客户库 ----
  customerDdl(
    "ALTER TABLE orders ADD COLUMN promo_code varchar(32) NULL COMMENT '促销码'; " +
      'CREATE TABLE coupons (id bigint NOT NULL AUTO_INCREMENT, code varchar(32) NOT NULL, PRIMARY KEY(id)) ' +
      "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='优惠券表';",
  );

  // 刷新在路上时切去概览，再回来仍必须看得到这一次性的 diff；不能因 Tab 卸载而吞掉。
  let releaseDelayedRefresh;
  let markDelayedRefreshStarted;
  const delayedRefreshStarted = new Promise((resolve) => {
    markDelayedRefreshStarted = resolve;
  });
  const delayedRefreshGate = new Promise((resolve) => {
    releaseDelayedRefresh = resolve;
  });
  const delayedRefresh = async (route) => {
    markDelayedRefreshStarted();
    await delayedRefreshGate;
    await route.continue();
  };
  await page.route(refreshPattern, delayedRefresh);
  const delayedRequest = page.waitForRequest(isRefreshRequest, { timeout: 30000 });
  await page.click('[data-testid="connector-schema-panel"] button:has-text("刷新结构")');
  const request = await delayedRequest;
  await delayedRefreshStarted;
  await page.click('[data-testid="connector-inspector-tab-overview"]');
  releaseDelayedRefresh();
  const response = await request.response();
  if (!response) throw new Error('延迟刷新请求结束但没有可读取的响应');
  await response.finished();
  await page.unroute(refreshPattern, delayedRefresh);
  await page.click('[data-testid="connector-inspector-tab-schema"]');
  await page.waitForSelector('[data-testid="connector-schema-panel"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="connector-schema-panel"]')
        ?.textContent?.includes('promo_code'),
    undefined,
    { timeout: 10000 },
  );
  await page.screenshot({ path: shot('schema-drift.png') });
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check('刷新途中切到概览再回来仍保留本次差异', panel.includes('promo_code'));
  check(
    '跨 Tab 刷新成功没有错误提示或「明细没有显示」误报',
    (await page.locator('.ant-message-error:visible').count()) === 0 &&
      !(await page.locator('.ant-message-notice:visible').allTextContents()).some((text) =>
        text.includes('这次的明细没有显示'),
      ),
  );
  check('检出结构变化', panel.includes('处结构变化'));
  // 差异少时列级明细默认展开——这条同时验证了「最有价值的信息不该藏在一次点击后面」。
  check('新增列被直接列出（无需展开）', panel.includes('promo_code'));
  check('新增表被列出', panel.includes('coupons'));

  // ---- 删表：REMOVED 默认展开，因为最该被看到 ----
  customerDdl('DROP TABLE coupons;');
  await refresh(page);
  await page.screenshot({ path: shot('schema-removed.png') });
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check('删表被检出', panel.includes('删除') && panel.includes('coupons'));

  // 收尾：把客户库改回去，别给后续验证留脏结构
  customerDdl('ALTER TABLE orders DROP COLUMN promo_code;');
  await refresh(page);
  await page.waitForFunction(
    () => {
      const text = document.querySelector('[data-testid="connector-schema-panel"]')?.textContent;
      return !!text && text.includes('删除列') && text.includes('promo_code');
    },
    undefined,
    { timeout: 10000 },
  );
  panel = await page.textContent('[data-testid="connector-schema-panel"]');
  check('还原后再刷仍能正确检出删除列', panel.includes('删除列') && panel.includes('promo_code'));
} catch (e) {
  primaryError = e;
  console.log('  ✗ 异常中断:', e.message);
  await page.screenshot({ path: shot('schema-error.png') }).catch(() => {});
  results.push({ name: '脚本执行', ok: false, detail: e.message });
} finally {
  // 清理错误单独记账，绝不替换上面真正导致测试中断的错误。
  try {
    cleanupCustomerArtifacts();
    const remaining = artifactCounts();
    check(
      '测试结束客户库无 coupons / promo_code 残留',
      remaining.coupons === 0 && remaining.promoCode === 0,
      JSON.stringify(remaining),
    );
  } catch (cleanupError) {
    check(
      '测试结束客户库无 coupons / promo_code 残留',
      false,
      `清理失败：${cleanupError.message}${primaryError ? '；原始错误已保留在上方' : ''}`,
    );
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
