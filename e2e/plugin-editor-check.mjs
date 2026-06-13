// 插件编辑页改造验证：登录 → 进编辑页 → 校验头部(面包屑/徽章/副标题计数) + 5 个 Tab + 各 Tab 内容。
import { CONFIG, launchBrowser, login, shot, reporter } from './lib.mjs';

const PLUGIN_ID = process.env.E2E_PLUGIN_ID || '2063984404548276226'; // 秒懂（bbb 创建，3 动作 / 2 引用）
const r = reporter('plugin-editor');

async function run() {
  const { browser, page } = await launchBrowser();
  try {
    await login(page);
    await page.goto(`${CONFIG.baseUrl}/console/plugins/${PLUGIN_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ant-tabs', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: shot('plugin-editor.png'), fullPage: true });

    const body = await page.innerText('body');

    // 面包屑
    r.ok('面包屑含 插件/编辑', body.includes('插件') && body.includes('编辑'));

    // 副标题计数
    const sub = body.split('\n').find((l) => l.includes('动作') && l.includes('引用')) || '';
    console.log('SUBTITLE:', sub.trim());
    r.ok('副标题 3 动作', /3\s*动作/.test(sub));
    r.ok('副标题 被 2 个 Agent 引用', /被\s*2\s*个\s*Agent/.test(sub));

    // 徽章：已发布 + 团队共享（秒懂是 bbb 建的，登录 test 是超管→非我创建）
    r.ok('状态徽章 已发布', body.includes('已发布'));
    r.ok('共享徽章 团队共享', body.includes('团队共享'));

    // Tab 列表 + 顺序（凭证 在 动作 之前）
    const tabNodes = page.locator('.ant-tabs-tab');
    const tabs = [];
    for (let i = 0; i < (await tabNodes.count()); i++) tabs.push((await tabNodes.nth(i).innerText()).trim());
    console.log('TABS:', tabs);
    const norm = (s) => s.replace(/\s/g, '');
    const want = ['基础', '凭证', '动作 · Schema · 3', '调试', '权限与共享'];
    r.ok('五个 Tab 齐全', want.every((t) => tabs.some((x) => norm(x) === norm(t))));
    const idxCred = tabs.findIndex((x) => norm(x) === '凭证');
    const idxTools = tabs.findIndex((x) => norm(x).startsWith('动作'));
    r.ok('凭证 Tab 在 动作 之前', idxCred >= 0 && idxTools >= 0 && idxCred < idxTools);

    // 切到「动作 · Schema」→ 卡片列表 + READ/WRITE 徽章 + JSON 详情
    await page.locator('.ant-tabs-tab', { hasText: '动作' }).click();
    await page.waitForTimeout(800);
    const paneBody = await page.locator('.ant-tabs-tabpane-active').innerText();
    r.ok('无 READ/WRITE 徽章', !paneBody.includes('READ') && !paneBody.includes('WRITE'));
    r.ok('卡片用中文名展示(追加子任务)', paneBody.includes('追加子任务'));
    // 卡片不再展示参数 chip（chip 文案带 []/? 后缀，JSON schema 里不会出现这两种写法）
    r.ok('卡片不再显示参数 chip', !paneBody.includes('tasks[]') && !paneBody.includes('keyword?'));
    r.ok('JSON 详情面板「当前选中」', paneBody.includes('当前选中'));
    r.ok('详情含 input_schema', paneBody.includes('input_schema'));
    r.ok('复制按钮在', await page.getByRole('button', { name: '复制' }).first().isVisible().catch(() => false));

    // 切到「调试」→ TestPanel 的「发起调用」按钮在
    await page.locator('.ant-tabs-tab', { hasText: '调试' }).click();
    await page.waitForTimeout(800);
    r.ok('调试 Tab 渲染 TestPanel', await page.getByText('发起调用').first().isVisible().catch(() => false));

    // 切到「权限与共享」→ ShareSettings 的「全公司可见」在
    await page.locator('.ant-tabs-tab', { hasText: '权限与共享' }).click();
    await page.waitForTimeout(800);
    r.ok('权限与共享 Tab 渲染 ShareSettings', await page.getByText('全公司可见').first().isVisible().catch(() => false));
    await page.screenshot({ path: shot('plugin-editor-share.png'), fullPage: true });

    return r.summary();
  } finally {
    await browser.close();
  }
}

run().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('ERR', e); process.exit(1); });
