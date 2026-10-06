// 写操作分级的 UI 实跑：写策略选择器（默认只读）、授权命令面板、列表新列、审批页。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

/**
 * 展开某个 Form.Item 里的 Select 并选中一项。
 *
 * antd 把 `id` 挂在**被 .ant-select-selector 遮住的内层 input** 上，直接 click 那个 id 会超时；
 * 用 label[for=...] 定位到 Form.Item、再点 selector，才是用户实际点的那个东西。
 */
const pickOption = async (page, fieldId, optionText) => {
  const item = `[data-testid="connector-form-drawer"] .ant-form-item:has(label[for="${fieldId}"])`;
  await page.click(`${item} .ant-select-selector`);
  await sleep(400);
  await page.click(`.ant-select-dropdown:visible .ant-select-item:has-text("${optionText}")`);
  await sleep(600);
};

const selectedText = (page, fieldId) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="connector-form-drawer"] #${id}`);
    const item = el?.closest('.ant-form-item')?.querySelector('.ant-select-selection-item');
    return item ? item.textContent.trim() : null;
  }, fieldId);

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const okEnvelope = (data) => ({ success: true, respCode: '200', respMsg: 'ok', data });

const pendingHistoryRows = [
  {
    id: 'fixture-approved',
    time: '2099-01-02T10:00:00',
    connectorName: '订单库',
    agentName: '经营分析助手',
    operation: 'UPDATE',
    targetTable: 'orders',
    statementText: "UPDATE orders SET status = 'PAID' WHERE id = 42",
    status: 'APPROVED',
    affectedRows: '1',
    decidedBy: 'fixture-admin',
    decidedAt: '2099-01-02T10:02:00',
    expiresAt: '2099-01-02T10:10:00',
  },
  {
    id: 'fixture-rejected',
    time: '2099-01-02T09:00:00',
    connectorName: '订单库',
    agentName: '经营分析助手',
    operation: 'DELETE',
    targetTable: 'orders',
    statementText: 'DELETE FROM orders WHERE id = 43',
    status: 'REJECTED',
    errorDetail: '没有业务依据',
    decidedBy: 'fixture-admin',
    decidedAt: '2099-01-02T09:02:00',
    expiresAt: '2099-01-02T09:10:00',
  },
];

let pendingHistoryRequests = 0;
const pendingHistoryFixture = async (route) => {
  const url = new URL(route.request().url());
  const records = url.searchParams.get('status') === 'PENDING' ? [] : pendingHistoryRows;
  pendingHistoryRequests += 1;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      okEnvelope({
        records,
        total: String(records.length),
        size: '20',
        current: '1',
        pages: records.length ? '1' : '0',
      }),
    ),
  });
};

let delayedGrant = null;
const grantRequests = [];
const grantFixture = async (route) => {
  const body = route.request().postDataJSON();
  grantRequests.push(body);
  if (delayedGrant) {
    delayedGrant.started();
    await delayedGrant.gate;
    delayedGrant = null;
  }
  const privileges =
    body.writePolicy === 'FORBIDDEN' ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      okEnvelope({
        sql: `CREATE USER '${body.username}'@'${body.host}' IDENTIFIED BY '请替换成一个强密码';\nGRANT ${privileges} ON \`${body.database}\`.* TO '${body.username}'@'${body.host}';`,
        notes: ['请替换成一个强密码'],
      }),
    ),
  });
};

const armDelayedGrant = () => {
  let release;
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  delayedGrant = { gate, started };
  return { release, startedPromise };
};

const { browser, page } = await launchBrowser();
try {
  await login(page);
  await page.route('**/admin/connectors/grant-script', grantFixture);

  // ---------------- 列表页 ----------------
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await page.waitForSelector('[data-testid="connector-card-grid"]');
  const policyTags = await page.$$eval('[data-testid="connector-card"]', (cards) =>
    cards.map((card) => ({ name: card.getAttribute('data-connector-name'), text: card.innerText })),
  );
  check(
    '可写连接卡片显示「写需审批」',
    policyTags.some((r) => r.text.includes('平台写策略') && r.text.includes('写需审批')),
    JSON.stringify(policyTags),
  );
  check(
    '只读连接卡片显示「只读」',
    policyTags.some((r) => r.text.includes('平台写策略') && r.text.includes('只读')),
  );

  // ---------------- 新建 Drawer ----------------
  await page.click('button:has-text("新建连接")');
  await page.waitForSelector('[data-testid="connector-form-drawer"]');
  // 默认选中的是 kinds[0]，不一定是 MySQL；显式切到 MySQL，否则后面没有「库名」这个参数。
  await pickOption(page, 'kind', 'MySQL');
  const defaultPolicy = await selectedText(page, 'writePolicy');
  check('新建时写策略默认「只读」', !!defaultPolicy && defaultPolicy.includes('只读'), defaultPolicy || '(没找到)');

  // 只读档不该出现放开写的告警
  const warnBefore = await page.$('[data-testid="connector-form-drawer"] .ant-alert-warning');
  check('只读档不显示「将允许修改客户数据」告警', !warnBefore);

  // 切到「写自动」
  await pickOption(page, 'writePolicy', '写自动');
  const warnText = await page.textContent('[data-testid="connector-form-drawer"] .ant-alert-warning').catch(() => null);
  check(
    '切到「写自动」后出现告警并说明剩下哪些护栏',
    !!warnText && warnText.includes('不带条件') && warnText.includes('拦截'),
    (warnText || '').slice(0, 60),
  );

  // ---------------- 授权命令面板 ----------------
  const panel = await page.$('[data-testid="connector-form-drawer"] .ant-collapse');
  check('弹窗内有可折叠的「生成授权命令」面板', !!panel);
  await page.click('[data-testid="connector-form-drawer"] .ant-collapse-header');
  await sleep(500);
  await page.fill('[data-testid="connector-form-drawer"] #params_database', 'demo_shop');
  await sleep(300);
  // 不按文字找：antd 会给两个汉字的按钮自动插空格，实际文本是「生 成」，has-text("生成") 永远匹配不上。
  await page.click('[data-testid="connector-form-drawer"] .ant-collapse-content .ant-btn-primary');
  // 生成结果是 Typography.Paragraph（不是 <pre>），所以按「出现可复制块」等。
  await page.waitForSelector('[data-testid="connector-form-drawer"] .ant-collapse-content .ant-typography-copy', { timeout: 20000 });
  const sql = await page.innerText('[data-testid="connector-form-drawer"] .ant-collapse-content');
  check(
    '写自动档生成的命令带 INSERT/UPDATE/DELETE',
    sql.includes('INSERT') && sql.includes('UPDATE') && sql.includes('DELETE'),
    sql.split('\n').find((l) => l.startsWith('GRANT')) || '',
  );
  check('生成的命令不含明文密码', sql.includes('请替换成一个强密码'));
  await page.screenshot({ path: shot('writepolicy-modal.png') });

  // 切回只读后，旧的可写命令不能继续复制；必须先明确标成过期，再由用户重新生成。
  await pickOption(page, 'writePolicy', '只读');
  await page.waitForSelector('[data-testid="grant-script-stale"]');
  const stalePanel = await page.innerText(
    '[data-testid="connector-form-drawer"] .ant-collapse-content',
  );
  check(
    '写自动命令切到只读后立即标记过期并要求重新生成',
    stalePanel.includes('已过期') && stalePanel.includes('重新生成'),
  );
  check(
    '过期的写自动命令不再提供复制按钮',
    (await page.locator('[data-testid="grant-script-result"] .ant-typography-copy').count()) === 0,
  );

  // 明确重新生成后，才得到与当前只读策略绑定的新结果。
  // 不按文字找：antd 会给两个汉字的按钮自动插空格，实际文本是「生 成」，has-text("生成") 永远匹配不上。
  const readonlyResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/admin/connectors/grant-script'),
    { timeout: 20000 },
  );
  await page.click('[data-testid="connector-form-drawer"] .ant-collapse-content .ant-btn-primary');
  await readonlyResponse;
  await page.waitForFunction(
    () => {
      const result = document.querySelector('[data-testid="grant-script-result"]');
      return (
        !!result &&
        !document.querySelector('[data-testid="grant-script-stale"]') &&
        result.textContent?.includes('GRANT SELECT ON') &&
        !result.textContent?.includes('UPDATE')
      );
    },
    undefined,
    { timeout: 20000 },
  );
  const sql2 = await page.innerText('[data-testid="connector-form-drawer"] .ant-collapse-content');
  check(
    '切回只读后重新生成 → 只剩 SELECT',
    sql2.includes('GRANT SELECT ON') && !sql2.includes('UPDATE'),
    sql2.split('\n').find((l) => l.startsWith('GRANT')) || '',
  );

  // 请求发出后再改输入也不能让迟到的响应“复活”为可复制结果。
  const username = page.locator(
    '[data-testid="connector-form-drawer"] .ant-collapse-content input',
  ).first();
  await username.fill('jm_snapshot_a');
  await page.waitForSelector('[data-testid="grant-script-stale"]');
  const delayed = armDelayedGrant();
  const delayedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/admin/connectors/grant-script'),
    { timeout: 20000 },
  );
  await page.click('[data-testid="connector-form-drawer"] .ant-collapse-content .ant-btn-primary');
  await delayed.startedPromise;
  await username.fill('jm_snapshot_b');
  delayed.release();
  await delayedResponse;
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="grant-script-result"]')
        ?.textContent?.includes('jm_snapshot_a'),
    undefined,
    { timeout: 10000 },
  );
  check(
    '授权请求途中修改输入，迟到结果仍明确过期且不可复制',
    (await page.locator('[data-testid="grant-script-stale"]').count()) === 1 &&
      (await page.locator('[data-testid="grant-script-result"] .ant-typography-copy').count()) === 0,
  );
  check(
    'Fixture 收到生成 SQL 所需的完整非敏感字段',
    grantRequests.every(
      (request) =>
        typeof request.kind === 'string' &&
        Object.hasOwn(request, 'database') &&
        typeof request.writePolicy === 'string' &&
        typeof request.username === 'string' &&
        typeof request.host === 'string' &&
        Array.isArray(request.tables),
    ),
    JSON.stringify(grantRequests),
  );

  const grantButton =
    '[data-testid="connector-form-drawer"] .ant-collapse-content .ant-btn-primary';
  const waitGrantSettled = () =>
    page.waitForFunction(
      (selector) => {
        const button = document.querySelector(selector);
        return (
          !!button &&
          !button.classList.contains('ant-btn-loading') &&
          !button.hasAttribute('disabled')
        );
      },
      grantButton,
      { timeout: 20000 },
    );

  // React 状态更新前，同一事件循环里的连续触发不能穿过 pending 防重。
  // fixture 把第一个请求挂住，直接数浏览器实际发出了几次 POST。
  const beforeDoubleClick = grantRequests.length;
  const doubleClickDelay = armDelayedGrant();
  await page.evaluate((selector) => {
    const button = document.querySelector(selector);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, grantButton);
  await doubleClickDelay.startedPromise;
  await sleep(250);
  check(
    '生成按钮同一渲染周期双击只发一次 POST',
    grantRequests.length === beforeDoubleClick + 1,
    `新增 ${grantRequests.length - beforeDoubleClick} 次`,
  );
  doubleClickDelay.release();
  await waitGrantSettled();

  const beforeDoubleEnter = grantRequests.length;
  const enterDelay = armDelayedGrant();
  await page.evaluate(() => {
    const input = document.querySelector(
      '[data-testid="connector-form-drawer"] .ant-collapse-content input',
    );
    const event = () =>
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      });
    input.dispatchEvent(event());
    input.dispatchEvent(event());
  });
  await enterDelay.startedPromise;
  await sleep(250);
  check(
    '账号输入框连续 Enter 只发一次 POST',
    grantRequests.length === beforeDoubleEnter + 1,
    `新增 ${grantRequests.length - beforeDoubleEnter} 次`,
  );
  enterDelay.release();
  await waitGrantSettled();

  await page.click('[data-testid="connector-form-drawer"] button:has-text("取消")').catch(() => page.keyboard.press('Escape'));
  await sleep(600);

  // ---------------- 审批页 ----------------
  await page.goto(`${BASE}/console/pending-writes`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const bodyText = await page.textContent('body');
  check('审批页可访问（不是 403 / 白屏）', !bodyText.includes('仅企业超管可访问') && bodyText.length > 200);

  // 默认只看「待审批」，已批/已拒的要切到「全部」才看得见。
  await page.click('.ant-radio-button-wrapper:has-text("全部"), .ant-segmented-item:has-text("全部")');
  await sleep(1800);

  // ★ 数 .ant-table-row 而不是 tbody tr：空状态本身也是一个 tr（.ant-table-placeholder），
  //   用后者会让「一条都没有」也判成通过——空转通过的断言比没有断言更糟。
  const rows = await page.$$('.ant-table-tbody .ant-table-row');
  check('「全部」下列出了写请求', rows.length > 0, `${rows.length} 行`);

  const allText = await page.textContent('body');
  const liveDecisionLabels = ['已批准', '已拒绝'].filter((label) => allText.includes(label));
  console.log(
    `  · 真实历史状态：${liveDecisionLabels.length ? liveDecisionLabels.join('、') : '记录均已按有效期显示为已过期'}`,
  );

  // 语句默认折在展开行里：展开第一条，确认看到的是护栏改写后的那一条。
  await page.click('.ant-table-tbody .ant-table-row:first-child .ant-table-row-expand-icon').catch(() => {});
  await sleep(1000);
  const expanded = await page.textContent('body');
  check('展开后能看到实际要执行的语句', /UPDATE\s+orders|DELETE\s+FROM\s+orders/.test(expanded));

  // 真实库里的 APPROVED / REJECTED 记录会随时间自然过期，届时页面应诚实显示「已过期」。
  // 用未来时间的受控历史记录验证两种决策态和拒绝原因，避免把测试绑在会衰减的 seed 上。
  await page.route(/\/admin\/connectors\/pending-writes(?:\?|$)/, pendingHistoryFixture);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1200);
  await page.click('.ant-radio-button-wrapper:has-text("全部"), .ant-segmented-item:has-text("全部")');
  await page.waitForSelector('.ant-table-row[data-row-key="fixture-approved"]', {
    timeout: 10000,
  });
  await page.waitForSelector('.ant-table-row[data-row-key="fixture-rejected"]', {
    timeout: 10000,
  });

  const fixtureText = await page.textContent('body');
  check('受控历史请求实际命中审批接口', pendingHistoryRequests >= 2, `${pendingHistoryRequests} 次`);
  check(
    '未过期历史记录能看到已批准与已拒绝两种状态',
    fixtureText.includes('已批准') && fixtureText.includes('已拒绝'),
  );
  check('拒绝记录能看到理由', fixtureText.includes('没有业务依据'));
  check(
    '历史记录默认展示实际执行语句',
    fixtureText.includes("UPDATE orders SET status = 'PAID' WHERE id = 42") &&
      fixtureText.includes('DELETE FROM orders WHERE id = 43'),
  );
  await page.screenshot({ path: shot('writepolicy-pending.png'), fullPage: true });
} catch (e) {
  console.log('\n!! 脚本抛错：', e.message.slice(0, 500));
  check('脚本跑完', false, e.message.split('\n')[0]);
} finally {
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 通过`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
}
