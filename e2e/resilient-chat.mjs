// 主流程：发送→实时流式→切走「正在生成」列表指示→切回不丢（服务端自持久化+续播）→停止→断网续传。
import {
  launchBrowser,
  login,
  openAgent,
  send,
  transcript,
  waitStreamStart,
  waitStreamEnd,
  spins,
  clickMenu,
  reporter,
  shot,
  sel,
  sleep,
  main,
} from './lib.mjs';

export default async function run() {
  const r = reporter('resilient-chat');
  const { browser, ctx, page } = await launchBrowser();
  try {
    await login(page);

    // 1. 发送 + 实时逐字（验证续播泵真的把 token 推过来）
    await openAgent(page);
    await send(page, '请用中文分三段、总共约400字，详细介绍一下你能帮我做什么，举几个具体例子。');
    r.ok('发送后进入流式（出现「停止」）', await waitStreamStart(page));
    await page.waitForTimeout(1200);
    const lenA = (await transcript(page)).length;
    await page.waitForTimeout(2500);
    const lenB = (await transcript(page)).length;
    r.ok('实时流式有 token 增量（续播泵生效）', lenB > lenA + 5, `len ${lenA}→${lenB}`);
    await page.screenshot({ path: shot('01-streaming.png'), fullPage: true });

    // 2. 切走 → 列表「正在生成」指示（右侧转圈）
    await clickMenu(page, '对话');
    await page.waitForTimeout(1500);
    r.ok('切走后列表出现「正在生成」转圈', (await spins(page)) >= 1);
    await page.screenshot({ path: shot('02-list-generating.png'), fullPage: true });

    // 3. 回到会话 → 回复未丢且完整
    await page.locator(sel.convItem).first().click();
    await page.waitForLoadState('domcontentloaded');
    await waitStreamEnd(page);
    const convId = (page.url().match(/\/chat\/c\/(\d+)/) || [])[1] || '';
    const t3 = await transcript(page);
    r.ok('切走再回来：回复未丢且完整', t3.length > 120, `len ${t3.length}, convId=${convId}`);
    await page.screenshot({ path: shot('03-reconnect-persisted.png'), fullPage: true });

    // 4. 停止（真取消，UI 结束流式）
    await send(page, '再用中文写一段大约300字、关于知识管理重要性的文字。');
    r.ok('停止用例：再次进入流式', await waitStreamStart(page));
    await page.waitForTimeout(1800);
    await page.locator(sel.stop).click();
    let stopped = false;
    for (let i = 0; i < 12; i++) {
      if (
        !(await page
          .locator(sel.stop)
          .isVisible()
          .catch(() => false))
      ) {
        stopped = true;
        break;
      }
      await sleep(700);
    }
    r.ok('点「停止」后流式结束', stopped);
    await page.screenshot({ path: shot('04-stopped.png'), fullPage: true });
    await waitStreamEnd(page);

    // 5. 断网 → 恢复后自动续传
    await send(page, '请用中文分四点、总共约500字，讲讲怎么搭建一个企业知识库。');
    r.ok('断网用例：再次进入流式', await waitStreamStart(page));
    await page.waitForTimeout(1500);
    const beforeOffline = (await transcript(page)).length;
    await ctx.setOffline(true);
    await page.waitForTimeout(2500);
    await ctx.setOffline(false);
    const ended = await waitStreamEnd(page, 120000);
    const t5 = (await transcript(page)).length;
    r.ok(
      '断网→恢复后自动续传并完成',
      ended && t5 > beforeOffline + 20,
      `len ${beforeOffline}→${t5}`,
    );
    await page.screenshot({ path: shot('05-offline-reconnect.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  return r.summary();
}

main(import.meta.url, run);
