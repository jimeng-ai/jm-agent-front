// 工作台导航与路由基础烟测：只读，不创建或修改业务数据。
import { CONFIG, launchBrowser, login, reporter } from './lib.mjs';

export default async function run() {
  const r = reporter('workbench-navigation');
  const { browser, page } = await launchBrowser();
  try {
    await login(page);

    const sidebar = page.locator('.atlas-sidebar');
    r.ok(
      '兼容入口使用明确名称',
      await sidebar.getByText('HTTP 出站（兼容）', { exact: true }).isVisible().catch(() => false),
    );

    for (const path of ['/console/dashboard', '/console/agents', '/console/connectors', '/chat']) {
      await page.goto(`${CONFIG.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      r.ok(`${path} 可直达`, !page.url().includes('/login') && !(await page.locator('.error-boundary').count()));
    }

    await page.goto(`${CONFIG.baseUrl}/definitely-not-a-route`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    r.ok('未知路由仍显示 404', (await page.textContent('body')).includes('404'));
  } finally {
    await browser.close();
  }
  return r.summary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = await run();
  process.exit(ok ? 0 : 1);
}
