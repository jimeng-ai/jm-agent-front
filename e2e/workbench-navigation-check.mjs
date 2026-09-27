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

    const routes = [
      ['/console/dashboard', 'h1.title', '仪表盘'],
      ['/console/agents', '[data-testid="agent-workbench"]', 'Agents'],
      ['/console/connectors', '[data-testid="connector-workbench"]', '数据连接'],
      ['/chat', '.chat-home', '选择一个 Agent，开始对话'],
    ];
    for (const [path, landmark, label] of routes) {
      await page.goto(`${CONFIG.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
      const landmarkVisible = await page
        .locator(landmark)
        .filter({ hasText: label })
        .first()
        .waitFor({ state: 'visible', timeout: 7000 })
        .then(() => true)
        .catch(() => false);
      const body = (await page.textContent('body')) ?? '';
      r.ok(
        `${path} 渲染对应工作区而非空壳/错误页`,
        landmarkVisible &&
          !page.url().includes('/login') &&
          !body.includes('Unexpected Application Error') &&
          !body.includes('仅企业超管可访问') &&
          !body.includes('无权访问') &&
          (await page.locator('.atlas-main').count()) === (path === '/chat' ? 0 : 1),
      );
    }

    await page.goto(`${CONFIG.baseUrl}/definitely-not-a-route`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    r.ok('未知路由仍显示 404', (await page.textContent('body')).includes('404'));

    // 不加生产 test-only 路由：直接拦截尚未加载的真实 lazy chunk，验证 Data Router errorElement。
    const skillModule = '**/src/pages/console/skill/SkillListPage.tsx*';
    const failLazyChunk = (route) => route.abort('failed');
    await page.route(skillModule, failLazyChunk);
    await page.goto(`${CONFIG.baseUrl}/console/skills`, { waitUntil: 'domcontentloaded' });
    const localizedError = await page
      .getByText('页面加载失败', { exact: true })
      .waitFor({ state: 'visible', timeout: 7000 })
      .then(() => true)
      .catch(() => false);
    const errorBody = (await page.textContent('body')) ?? '';
    r.ok(
      '真实 lazy chunk 失败进入中文路由恢复页',
      localizedError && !errorBody.includes('Unexpected Application Error'),
    );

    await page.unroute(skillModule, failLazyChunk);
    await page.getByRole('button', { name: '重新加载页面' }).click();
    const recovered = await page
      .getByRole('heading', { name: '技能 Skills', exact: true })
      .waitFor({ state: 'visible', timeout: 7000 })
      .then(() => true)
      .catch(() => false);
    r.ok('路由恢复页可重新加载并回到原页面', recovered);
  } finally {
    await browser.close();
  }
  return r.summary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = await run();
  process.exit(ok ? 0 : 1);
}
