import { launchBrowser, login, CONFIG, shot, reporter } from './lib.mjs';
const PID = '2064030696989233153';
const DOC = `GET /api/test/ping  健康检查\n  query: x (string)`;
const r = reporter('③ 名字校验：前端即时提示 + 后端把关');
const { browser, page } = await launchBrowser();
try {
  await login(page);
  await page.goto(`${CONFIG.baseUrl}/console/plugins/${PID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.getByRole('tab', { name: /工具/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /AI 生成/ }).click();
  await page.waitForTimeout(500);
  await page.locator('.ant-modal textarea').first().fill(DOC);
  await page.getByRole('button', { name: /解析生成/ }).click();
  const createBtn = page.getByRole('button', { name: /批量创建所选/ });
  await createBtn.waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForTimeout(500);

  // 把工具名改成中文（非法）
  const nameInput = page.locator('.ant-modal input[placeholder="英文函数名"]').first();
  await nameInput.fill('创建订单');
  await page.waitForTimeout(400);
  const modalText = await page.locator('.ant-modal').innerText();
  r.ok('即时提示：工具名只能用英文/数字/_/-', /只能用英文/.test(modalText), '');
  r.ok('③ 非法名不再硬禁用创建按钮', !(await createBtn.isDisabled()), `disabled=${await createBtn.isDisabled()}`);
  await page.screenshot({ path: shot('pnv-hint.png'), fullPage: true });

  // 点创建 → 后端拒绝 → toast 透传原因
  await createBtn.click();
  await page.waitForTimeout(2500);
  const toast = await page.locator('.ant-message').innerText().catch(()=> '');
  console.log('TOAST:', JSON.stringify(toast));
  r.ok('后端把关：创建失败并透传后端原因', /只能用英文字母、数字/.test(toast), toast.replace(/\n/g,' '));
  await page.screenshot({ path: shot('pnv-toast.png'), fullPage: true });
} catch (e) {
  console.error('SUITE ERROR', e.message);
  await page.screenshot({ path: shot('pnv-fail.png'), fullPage: true }).catch(()=>{});
} finally { await browser.close(); }
process.exit(r.summary() ? 0 : 1);
