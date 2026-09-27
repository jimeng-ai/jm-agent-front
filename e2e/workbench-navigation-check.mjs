// 工作台导航与路由基础烟测：只读，不创建或修改业务数据。
import { CONFIG, launchBrowser, login, reporter } from './lib.mjs';

if (!process.env.E2E_BASE_URL) {
  throw new Error(
    'workbench-navigation 必须显式设置 E2E_BASE_URL；请指向当前 Vite/preview，而不是旧 :8082 包。',
  );
}

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

    // 关闭已加载过各工作台的页面，再用隔离 context 打开新页面，保证 dynamic import 不在
    // document module map 中，也避免复用上一页的 sessionStorage 登录态导致登录页竞态跳转。
    await page.close();
    const errorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errorPage = await errorContext.newPage();
    const skillModule = /(?:\/src\/pages\/console\/skill\/SkillListPage\.tsx(?:\?.*)?|\/assets\/SkillListPage-[^/?]+\.js(?:\?.*)?)$/;
    const supportedLazyUrls = [
      'http://localhost:5173/src/pages/console/skill/SkillListPage.tsx?t=123',
      'https://example.test/assets/SkillListPage-AbC123.js',
    ];
    r.ok(
      'lazy chunk 拦截器同时覆盖 Vite 源模块与生产构建资源',
      supportedLazyUrls.every((url) => skillModule.test(url)),
    );
    const failLazyChunk = (route) => route.abort('failed');
    try {
      await errorPage.route(skillModule, failLazyChunk);
      await login(errorPage);
      await errorPage.goto(`${CONFIG.baseUrl}/console/skills`, { waitUntil: 'domcontentloaded' });
      const localizedError = await errorPage
        .getByText('页面加载失败', { exact: true })
        .waitFor({ state: 'visible', timeout: 7000 })
        .then(() => true)
        .catch(() => false);
      const errorBody = (await errorPage.textContent('body')) ?? '';
      r.ok(
        '真实 lazy chunk 失败进入中文路由恢复页',
        localizedError && !errorBody.includes('Unexpected Application Error'),
      );

      await errorPage.unroute(skillModule, failLazyChunk);
      await errorPage.getByRole('button', { name: '重新加载页面' }).click();
      const recovered = await errorPage
        .getByRole('heading', { name: '技能 Skills', exact: true })
        .waitFor({ state: 'visible', timeout: 7000 })
        .then(() => true)
        .catch(() => false);
      r.ok('路由恢复页可重新加载并回到原页面', recovered);
    } finally {
      await errorContext.close();
    }
  } finally {
    await browser.close();
  }
  return r.summary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = await run();
  process.exit(ok ? 0 : 1);
}
