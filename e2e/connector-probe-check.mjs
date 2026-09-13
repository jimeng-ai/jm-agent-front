// 弹窗内「测试连接」的 UI 实跑。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const fill = async (page, { host, port, db, user, pass }) => {
  const m = '.ant-modal ';
  await page.fill(`${m}#params_host`, host);
  await page.fill(`${m}#params_port`, String(port));
  await page.fill(`${m}#params_database`, db);
  await page.fill(`${m}#params_username`, user);
  await page.fill(`${m}#params_password`, pass);
};

/**
 * 点「测试连接」并等结果。
 *
 * 不能用固定 sleep（连不通要等满 5s 连接超时，Hikari 在窗口内还会重试），
 * 也不能手动删 DOM 再等它出现——那会破坏 React 的协调，下一次结果就渲染不出来了。
 * 正确做法是等【文案变化】：组件在点击时会先 setProbeResult(null)，所以新旧一定不同。
 */
const probe = async (page) => {
  const before = await page
    .textContent('.ant-modal .ant-alert')
    .catch(() => null);
  await page.click('.ant-modal button:has-text("测试连接")');
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('.ant-modal .ant-alert');
      return !!el && el.textContent !== prev;
    },
    before,
    { timeout: 30000 },
  );
  await sleep(300);
  return page.textContent('.ant-modal');
};

const { browser, page } = await launchBrowser();
try {
  await login(page);
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);
  await page.click('button:has-text("新建连接")');
  await sleep(1000);

  // 选 MySQL 类型
  await page.click('.ant-modal .ant-select-selector');
  await sleep(500);
  await page.click('.ant-select-item-option:has-text("MySQL")');
  await sleep(800);
  await page.fill('.ant-modal #name', 'probe-ui-test');

  check('弹窗里有「测试连接」按钮', (await page.textContent('.ant-modal')).includes('测试连接'));

  // ① 端口错
  await fill(page, { host: '127.0.0.1', port: 3306, db: 'demo_shop', user: 'jm_ro', pass: 'ro_pass_123' });
  let modal = await probe(page);
  await page.screenshot({ path: shot('probe-unreachable.png') });
  check('端口不通 → 就地显示原因', modal.includes('连接测试未通过') && modal.includes('端口未开放'));

  // ② 可写账号
  await fill(page, { host: '127.0.0.1', port: 3307, db: 'demo_shop', user: 'jm_rw', pass: 'rw_pass_123' });
  modal = await probe(page);
  await page.screenshot({ path: shot('probe-writable.png') });
  check('可写账号 → 明确要求换只读账号', modal.includes('具备写权限') && modal.includes('GRANT SELECT'));

  // ③ 密码错
  await fill(page, { host: '127.0.0.1', port: 3307, db: 'demo_shop', user: 'jm_ro', pass: 'WRONG' });
  modal = await probe(page);
  check('密码错 → 归到凭据无效', modal.includes('用户名或密码不正确'));

  // ④ 正确
  await fill(page, { host: '127.0.0.1', port: 3307, db: 'demo_shop', user: 'jm_ro', pass: 'ro_pass_123' });
  modal = await probe(page);
  await page.screenshot({ path: shot('probe-ok.png') });
  check('参数正确 → 成功并列出探到的能力',
        modal.includes('连接正常，只读已验证') && modal.includes('能查') && modal.includes('能自描述'));
  check('给出只读判定依据', modal.includes('只读依据'));

  // ⑤ 试连不落库
  await page.click('.ant-modal button:has-text("取 消"), .ant-modal button:has-text("取消")');
  await sleep(1200);
  const body = await page.textContent('body');
  check('试连不落库（列表里没有 probe-ui-test）', !body.includes('probe-ui-test'));
} catch (e) {
  console.log('  ✗ 异常中断:', e.message);
  await page.screenshot({ path: shot('probe-error.png') }).catch(() => {});
  results.push({ name: '脚本执行', ok: false, detail: e.message });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
