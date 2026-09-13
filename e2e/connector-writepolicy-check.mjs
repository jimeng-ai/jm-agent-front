// 写操作分级的 UI 实跑：写策略选择器（默认只读）、授权命令面板、列表新列、审批页。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

/**
 * 展开某个 Form.Item 里的 Select 并选中一项。
 *
 * antd 把 `id` 挂在**被 .ant-select-selector 遮住的内层 input** 上，直接 click 那个 id 会超时；
 * 用 label[for=...] 定位到 Form.Item、再点 selector，才是用户实际点的那个东西。
 */
const pickOption = async (page, fieldId, optionText) => {
  const item = `.ant-modal .ant-form-item:has(label[for="${fieldId}"])`;
  await page.click(`${item} .ant-select-selector`);
  await sleep(400);
  await page.click(`.ant-select-dropdown:visible .ant-select-item:has-text("${optionText}")`);
  await sleep(600);
};

const selectedText = (page, fieldId) =>
  page.evaluate((id) => {
    const el = document.querySelector(`.ant-modal #${id}`);
    const item = el?.closest('.ant-form-item')?.querySelector('.ant-select-selection-item');
    return item ? item.textContent.trim() : null;
  }, fieldId);

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const { browser, page } = await launchBrowser();
try {
  await login(page);

  // ---------------- 列表页 ----------------
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const headers = await page.$$eval('.ant-table-thead th', (ts) => ts.map((t) => t.textContent.trim()));
  check('列表出现「写策略」列', headers.includes('写策略'), headers.join(' / '));

  const policyTags = await page.$$eval('.ant-table-tbody tr', (rows) =>
    rows.map((r) => {
      const tds = r.querySelectorAll('td');
      return { name: tds[0]?.innerText.split('\n')[0], policy: tds[5]?.innerText.trim() };
    }),
  );
  check(
    '可写连接显示「写需审批」',
    policyTags.some((r) => r.policy === '写需审批'),
    JSON.stringify(policyTags),
  );
  check(
    '只读连接显示「只读」',
    policyTags.some((r) => r.policy === '只读'),
  );

  // ---------------- 新建弹窗 ----------------
  await page.click('button:has-text("新建连接")');
  await sleep(1200);
  // 默认选中的是 kinds[0]，不一定是 MySQL；显式切到 MySQL，否则后面没有「库名」这个参数。
  await pickOption(page, 'kind', 'MySQL');
  const defaultPolicy = await selectedText(page, 'writePolicy');
  check('新建时写策略默认「只读」', !!defaultPolicy && defaultPolicy.includes('只读'), defaultPolicy || '(没找到)');

  // 只读档不该出现放开写的告警
  const warnBefore = await page.$('.ant-modal .ant-alert-warning');
  check('只读档不显示「将允许修改客户数据」告警', !warnBefore);

  // 切到「写自动」
  await pickOption(page, 'writePolicy', '写自动');
  const warnText = await page.textContent('.ant-modal .ant-alert-warning').catch(() => null);
  check(
    '切到「写自动」后出现告警并说明剩下哪些护栏',
    !!warnText && warnText.includes('WHERE') && warnText.includes('回滚'),
    (warnText || '').slice(0, 60),
  );

  // ---------------- 授权命令面板 ----------------
  const panel = await page.$('.ant-modal .ant-collapse');
  check('弹窗内有可折叠的「生成授权命令」面板', !!panel);
  await page.click('.ant-modal .ant-collapse-header');
  await sleep(500);
  await page.fill('.ant-modal #params_database', 'demo_shop');
  await sleep(300);
  // 不按文字找：antd 会给两个汉字的按钮自动插空格，实际文本是「生 成」，has-text("生成") 永远匹配不上。
  await page.click('.ant-modal .ant-collapse-content .ant-btn-primary');
  // 生成结果是 Typography.Paragraph（不是 <pre>），所以按「出现可复制块」等。
  await page.waitForSelector('.ant-modal .ant-collapse-content .ant-typography-copy', { timeout: 20000 });
  const sql = await page.innerText('.ant-modal .ant-collapse-content');
  check(
    '写自动档生成的命令带 INSERT/UPDATE/DELETE',
    sql.includes('INSERT') && sql.includes('UPDATE') && sql.includes('DELETE'),
    sql.split('\n').find((l) => l.startsWith('GRANT')) || '',
  );
  check('生成的命令不含明文密码', sql.includes('请替换成一个强密码'));
  await page.screenshot({ path: shot('writepolicy-modal.png') });

  // 切回只读，命令必须跟着变
  await pickOption(page, 'writePolicy', '只读');
  // 等文案变化而不是固定 sleep：两档生成的 GRANT 行必然不同。
  // 不按文字找：antd 会给两个汉字的按钮自动插空格，实际文本是「生 成」，has-text("生成") 永远匹配不上。
  await page.click('.ant-modal .ant-collapse-content .ant-btn-primary');
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('.ant-modal .ant-collapse-content');
      return !!el && el.innerText !== prev;
    },
    sql,
    { timeout: 20000 },
  );
  const sql2 = await page.innerText('.ant-modal .ant-collapse-content');
  check(
    '切回只读后重新生成 → 只剩 SELECT',
    sql2.includes('GRANT SELECT ON') && !sql2.includes('UPDATE'),
    sql2.split('\n').find((l) => l.startsWith('GRANT')) || '',
  );

  await page.click('.ant-modal .ant-modal-footer .ant-btn:not(.ant-btn-primary):nth-of-type(2)').catch(() => page.keyboard.press('Escape'));
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
  check('能看到已批准与已拒绝两种状态', allText.includes('已批准') && allText.includes('已拒绝'));
  check('能看到被拒绝的理由', allText.includes('没有业务依据'));

  // 语句默认折在展开行里：展开第一条，确认看到的是护栏改写后的那一条。
  await page.click('.ant-table-tbody .ant-table-row:first-child .ant-table-row-expand-icon').catch(() => {});
  await sleep(1000);
  const expanded = await page.textContent('body');
  check('展开后能看到实际要执行的语句', /UPDATE\s+orders|DELETE\s+FROM\s+orders/.test(expanded));
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
