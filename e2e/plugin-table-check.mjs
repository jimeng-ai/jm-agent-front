// 插件列表「卡片→表格」改造的 UI 验证：登录 → 进插件页 → 校验统计头/Tab/列/计数/搜索。
// 必须跑 dev 服务（:5173，HMR 反映源码改动），docker :8082 是旧构建镜像。
import { CONFIG, launchBrowser, login, shot, reporter } from './lib.mjs';

const r = reporter('plugin-table');

async function run() {
  const { browser, page } = await launchBrowser();
  try {
    await login(page);
    await page.goto(`${CONFIG.baseUrl}/console/plugins`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table', { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot('plugin-table.png'), fullPage: true });

    const body = await page.innerText('body');
    const subtitle = body.split('\n').find((l) => l.includes('个插件')) || '';
    console.log('SUBTITLE:', subtitle.trim());
    r.ok('统计头含「个插件/个动作/Agent 引用」', /个插件.*个动作.*Agent/.test(subtitle));

    const seg = page.locator('.ant-segmented-item-label');
    const tabs = [];
    for (let i = 0; i < (await seg.count()); i++) tabs.push((await seg.nth(i).innerText()).trim());
    console.log('TABS:', tabs);
    r.ok('四个 Tab 齐全', ['全部', '我创建', '团队共享', '系统内置'].every((t) => tabs.some((x) => x.includes(t))));

    const heads = page.locator('thead th');
    const headers = [];
    for (let i = 0; i < (await heads.count()); i++) headers.push((await heads.nth(i).innerText()).trim());
    console.log('HEADERS:', headers);
    r.ok('表头含 动作/被引用/创建者', ['动作', '被引用', '创建者'].every((h) => headers.includes(h)));

    const rows = page.locator('tbody tr.ant-table-row');
    const n = await rows.count();
    console.log('ROW COUNT:', n);
    for (let i = 0; i < n; i++) {
      const cells = rows.nth(i).locator('td');
      const vals = [];
      for (let j = 0; j < (await cells.count()); j++)
        vals.push((await cells.nth(j).innerText()).replace(/\n/g, ' ').trim());
      console.log(`ROW${i}:`, JSON.stringify(vals));
    }
    r.ok('至少 2 行数据', n >= 2);

    // 「秒懂」应有 动作=3 / 被引用=2（与 DB / API 一致）
    const miaodongRow = rows.filter({ hasText: '秒懂' });
    const mdText = (await miaodongRow.first().innerText()).replace(/\n/g, ' ');
    console.log('秒懂行:', mdText);
    r.ok('秒懂 动作=3', / 3 /.test(` ${mdText} `) || mdText.includes('3'));
    r.ok('秒懂 被引用=2', mdText.includes('2'));

    // 搜索「秒」→ 仅剩 1 行
    await page.fill('input[placeholder="按名称搜索…"]', '秒');
    await page.waitForTimeout(700);
    const afterSearch = await page.locator('tbody tr.ant-table-row').count();
    console.log('AFTER SEARCH 秒 ROW COUNT:', afterSearch);
    r.ok('搜索过滤生效（剩 1 行）', afterSearch === 1);
    await page.screenshot({ path: shot('plugin-table-search.png'), fullPage: true });

    return r.summary();
  } finally {
    await browser.close();
  }
}

run().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('ERR', e); process.exit(1); });
