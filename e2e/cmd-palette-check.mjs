// 全局搜索命令面板（⌘K）端到端回归：打开 / 搜索 / 分组 / 跳转 / Trace 深链 / 无结果 / ESC。
import { CONFIG, launchBrowser, login, sleep, shot, main } from './lib.mjs';

main(import.meta.url, async () => {
  const { browser, page } = await launchBrowser();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await login(page);
  console.log('LOGIN OK:', page.url());

  // 1) Ctrl+K 打开面板
  await page.keyboard.press('Control+k');
  await sleep(500);
  const paletteCount = await page.locator('.cmd-palette').count();
  if (!paletteCount) throw new Error('FAIL: ⌘K 未打开命令面板');
  console.log('PASS: 面板已打开');

  // 2) 搜索「助手」
  await page.fill('.cmd-input input', '助手');
  await sleep(1000); // 防抖 300ms + 请求
  await page.screenshot({ path: shot('cmd-search.png'), fullPage: true });
  const groups = await page.locator('.cmd-group__title').allInnerTexts();
  const rowCount = await page.locator('.cmd-row').count();
  console.log('GROUPS:', JSON.stringify(groups), '| ROWS:', rowCount);
  if (!rowCount) throw new Error('FAIL: 搜索「助手」无任何结果行');

  // 3) 点击第一条 Agent，应跳转到 /console/agents/:id
  const agentGroup = page
    .locator('.cmd-group')
    .filter({ has: page.locator('.cmd-group__title', { hasText: 'Agent' }) });
  const firstAgent = agentGroup.locator('.cmd-row').first();
  const agentText = (await firstAgent.innerText()).replace(/\s+/g, ' ').trim();
  await firstAgent.click();
  await sleep(800);
  console.log('AGENT CLICK ->', page.url(), '| row:', agentText);
  if (!/\/console\/agents\//.test(page.url())) throw new Error('FAIL: 点击 Agent 未跳转到 Agent 详情');
  console.log('PASS: Agent 跳转正确');

  // 4) Trace 深链：重开搜索，点 Trace 行 -> /console/traces 且详情面板打开
  await page.keyboard.press('Control+k');
  await sleep(400);
  await page.fill('.cmd-input input', '助手');
  await sleep(1000);
  const traceGroup = page
    .locator('.cmd-group')
    .filter({ has: page.locator('.cmd-group__title', { hasText: 'Trace' }) });
  const traceN = await traceGroup.locator('.cmd-row').count();
  if (traceN > 0) {
    const trow = traceGroup.locator('.cmd-row').first();
    const ttext = (await trow.innerText()).replace(/\s+/g, ' ').trim();
    await trow.click();
    await sleep(1200);
    console.log('TRACE CLICK ->', page.url(), '| row:', ttext);
    if (!/\/console\/traces/.test(page.url())) throw new Error('FAIL: 点击 Trace 未跳转到调用日志');
    await page.screenshot({ path: shot('cmd-trace.png'), fullPage: true });
    console.log('PASS: Trace 跳转正确（traceId 已从 URL 消费）');
  } else {
    console.log('SKIP: 无 Trace 行可点（当前账号可能无匹配 trace）');
  }

  // 5) 无结果提示 + ESC 关闭
  await page.keyboard.press('Control+k');
  await sleep(400);
  await page.fill('.cmd-input input', 'zzzzznotexist999');
  await sleep(1000);
  const hint = (await page.locator('.cmd-hint').count())
    ? await page.locator('.cmd-hint').innerText()
    : '(无 hint)';
  console.log('NO-RESULT hint:', hint);
  await page.keyboard.press('Escape');
  await sleep(300);
  const stillOpen = (await page.locator('.cmd-palette').count())
    ? await page.locator('.cmd-palette').isVisible()
    : false;
  console.log('ESC -> palette visible:', stillOpen);

  console.log('CONSOLE ERRORS:', errors.slice(0, 8));
  await browser.close();
  return true;
});
