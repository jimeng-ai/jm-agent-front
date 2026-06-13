import { launchBrowser, login, CONFIG, shot, reporter } from './lib.mjs';
const PID = '2064030696989233153'; // 已含 list_workflow_history
const DOC = `GET /api/test/ping  健康检查\n  query: x (string)`;
const r = reporter('同插件重名：点创建应被后端拦下并提示');
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
  // 改成本插件已存在的名字
  await page.locator('.ant-modal input[placeholder="英文函数名"]').first().fill('list_workflow_history');
  await page.waitForTimeout(400);
  const modalText = await page.locator('.ant-modal').innerText();
  r.ok('复核表即时提示「本插件已有同名工具」', /本插件已有同名工具|本插件已存在同名工具/.test(modalText), '');
  // 点创建 → 后端拒绝 → toast
  await createBtn.click();
  await page.waitForTimeout(2500);
  const toast = await page.locator('.ant-message').innerText().catch(()=> '');
  console.log('TOAST:', JSON.stringify(toast));
  r.ok('点创建后被拦下，不再"添加成功"', /本插件已存在同名工具/.test(toast) && /失败/.test(toast), toast.replace(/\n/g,' '));
  await page.screenshot({ path: shot('pdupcreate.png'), fullPage: true });
} catch (e) {
  console.error('SUITE ERROR', e.message);
  await page.screenshot({ path: shot('pdupcreate-fail.png'), fullPage: true }).catch(()=>{});
} finally { await browser.close(); }
process.exit(r.summary() ? 0 : 1);
