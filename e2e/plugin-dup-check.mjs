import { launchBrowser, login, CONFIG, shot, reporter } from './lib.mjs';
const PID = '2064030696989233153'; // 「Insight 流程引擎」——已含 list_workflow_history
const DOC = `GET /api/test/ping  健康检查接口\n  query: x (string) 任意参数`;
const r = reporter('重名提示 + 工具名/接口地址可编辑');
const { browser, page } = await launchBrowser();
try {
  await login(page);
  await page.goto(`${CONFIG.baseUrl}/console/plugins/${PID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByRole('tab', { name: /工具/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /AI 生成/ }).click();
  await page.waitForTimeout(600);
  await page.locator('.ant-modal textarea').first().fill(DOC);
  await page.getByRole('button', { name: /解析生成/ }).click();
  console.log('parsing…');
  await page.getByRole('button', { name: /批量创建所选/ }).waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForTimeout(600);

  const row = page.locator('.ant-modal tbody tr').first();
  const inputs = row.locator('input');
  const n = await inputs.count();
  console.log('inputs in first row:', n);
  r.ok('工具名/接口地址可编辑（行内有输入框）', n >= 3, `${n} inputs`);

  // 改工具名为已存在的 list_workflow_history → 触发重名提示
  const nameInput = page.locator('.ant-modal input[placeholder="英文函数名"]').first();
  await nameInput.fill('list_workflow_history');
  await page.waitForTimeout(400);
  // 编辑接口地址（第 3 个 input）
  const pathInput = inputs.nth(3);
  await pathInput.fill('/openapi/workflow/history/list');
  await page.waitForTimeout(300);
  const pathVal = await pathInput.inputValue();
  r.ok('接口地址可编辑并生效', pathVal === '/openapi/workflow/history/list', pathVal);

  await page.screenshot({ path: shot('pdup-review.png'), fullPage: true });
  const modalText = await page.locator('.ant-modal').innerText();
  r.ok('提示「本插件已有同名工具」', /本插件已有同名工具|本插件已存在同名工具/.test(modalText), '');

  // 创建按钮：重名是警告(允许)，非禁用；但若名字非法应禁用——这里名字合法
  const createBtn = page.getByRole('button', { name: /批量创建所选/ });
  const disabled = await createBtn.isDisabled();
  r.ok('重名仅警告、不禁用创建', !disabled, `disabled=${disabled}`);

  // 改成非法名（中文）→ 应禁用
  await nameInput.fill('中文名字');
  await page.waitForTimeout(300);
  r.ok('非法工具名时禁用创建', await createBtn.isDisabled(), '');
  await page.screenshot({ path: shot('pdup-invalid.png'), fullPage: true });

} catch (e) {
  console.error('SUITE ERROR', e.message);
  await page.screenshot({ path: shot('pdup-fail.png'), fullPage: true }).catch(()=>{});
} finally { await browser.close(); }
process.exit(r.summary() ? 0 : 1);
