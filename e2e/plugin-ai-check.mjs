import { launchBrowser, login, CONFIG, shot, reporter } from './lib.mjs';
const PID = process.env.PID || '2064374973376229378';
const DOC = `微信营销 API 文档。
鉴权：所有接口都需要在 Header 携带 Authorization: Bearer <访问令牌>。

POST /api/v2/moment/create  创建朋友圈
  请求体: content (string, 必填) 朋友圈文案; scope (integer) 可见范围 1=全部可见 2=部分可见

GET /api/v2/moment/list  查询朋友圈列表
  query: page (integer) 页码; size (integer) 每页条数`;

const r = reporter('AI 生成插件 4 项');
const { browser, page } = await launchBrowser();
try {
  await login(page);
  await page.goto(`${CONFIG.baseUrl}/console/plugins/${PID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // 工具 tab
  await page.getByRole('tab', { name: /工具/ }).click();
  await page.waitForTimeout(600);
  // open AI 生成
  await page.getByRole('button', { name: /AI 生成/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('pai-10-modal.png') });
  // paste text (粘贴文本 tab is default)
  await page.locator('.ant-modal textarea').first().fill(DOC);
  await page.getByRole('button', { name: /解析生成/ }).click();
  console.log('parsing (LLM)…');
  // wait for review table (批量创建所选 button appears)
  await page.getByRole('button', { name: /批量创建所选/ }).waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('pai-11-review.png'), fullPage: true });

  const headers = await page.locator('.ant-modal .ant-table-thead th').allInnerTexts();
  console.log('REVIEW HEADERS:', JSON.stringify(headers));
  r.ok('#2 无「置信度」列', !headers.some(h => h.includes('置信度')), headers.join('|'));
  r.ok('复核表有 工具名/接口/入参 列', ['工具名','接口','入参'].every(c => headers.some(h=>h.includes(c))));

  // first row tool name cell should contain Chinese (title)
  const firstName = (await page.locator('.ant-modal tbody tr').first().locator('td').nth(1).innerText()).trim();
  console.log('FIRST TOOL NAME CELL:', JSON.stringify(firstName));
  r.ok('#3 工具名显示中文 title', /[一-龥]/.test(firstName), firstName.replace(/\n/g,' '));

  const bodyText = await page.locator('.ant-modal').innerText();
  r.ok('#4 解析出鉴权(横幅含「鉴权」)', bodyText.includes('鉴权'), '');

  const toolCount = await page.locator('.ant-modal tbody tr').count();
  console.log('parsed tools:', toolCount);

  // batch create
  await page.getByRole('button', { name: /批量创建所选/ }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot('pai-12-created.png'), fullPage: true });
  const toast = await page.locator('.ant-message').innerText().catch(()=> '');
  console.log('TOAST:', JSON.stringify(toast));
  r.ok('批量创建成功', /已创建/.test(toast), toast.replace(/\n/g,' '));
  r.ok('#4 创建后提示鉴权已设置', /鉴权方式已设/.test(toast), toast.replace(/\n/g,' '));

  // tools list shows Chinese title
  await page.waitForTimeout(800);
  const listText = await page.locator('.ant-table').last().innerText();
  console.log('TOOLS LIST:', JSON.stringify(listText.slice(0,300)));
  r.ok('#3 工具列表显示中文名', /[一-龥]/.test(listText.replace('工具名','').replace('名称','')), '');

  // open 新增工具 -> ToolDrawer, check 中文名 field
  await page.getByRole('button', { name: /新增工具/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('pai-13-drawer.png') });
  const drawerText = await page.locator('.ant-drawer').innerText().catch(()=> '');
  r.ok('#3 ToolDrawer 有「中文名」字段', drawerText.includes('中文名'), '');
  r.ok('#3 工具名标注英文函数名', /英文函数名|英文/.test(drawerText), '');

} catch (e) {
  console.error('SUITE ERROR', e.message);
  await page.screenshot({ path: shot('pai-fail.png'), fullPage: true }).catch(()=>{});
} finally {
  await browser.close();
}
const ok = r.summary();
process.exit(ok ? 0 : 1);
