// 列表指示：生成中右侧转圈（无「正在回复」文案）→ 回答完毕右上角红点 → 点击查看后红点消失。
import {
  launchBrowser,
  login,
  openAgent,
  send,
  waitStreamStart,
  dots,
  spins,
  clickMenu,
  reporter,
  shot,
  sel,
  sleep,
  main,
} from './lib.mjs';

export default async function run() {
  const r = reporter('unread-dot');
  const { browser, page } = await launchBrowser();
  try {
    await login(page);
    await page.evaluate(() => localStorage.removeItem('jm-chat-unread')); // 干净计数

    await openAgent(page);
    await send(page, '请用中文写约600字，介绍企业知识库的价值与落地步骤。');
    await waitStreamStart(page);

    await clickMenu(page, '对话'); // 回到 /chat（侧栏常驻）
    await page.waitForTimeout(2000);
    const sidebar = await page.$eval(sel.convList, (e) => e.innerText).catch(() => '');
    r.ok('生成中：右侧出现转圈', (await spins(page)) >= 1, `spin=${await spins(page)}`);
    r.ok('生成中：不再显示「正在回复」文案', !/正在回复/.test(sidebar));
    r.ok('生成中：还没有红点', (await dots(page)) === 0, `dot=${await dots(page)}`);
    await page.screenshot({ path: shot('07-generating-spin-right.png'), fullPage: true });

    // 等生成完成（转圈消失）
    let done = false;
    for (let i = 0; i < 60; i++) {
      if ((await spins(page)) === 0) {
        done = true;
        break;
      }
      await sleep(2000);
    }
    await page.waitForTimeout(1500);
    const dotDone = await dots(page);
    r.ok('回答完毕：右上角出现红点', done && dotDone >= 1, `dot=${dotDone}`);
    await page.screenshot({ path: shot('08-done-reddot.png'), fullPage: true });

    // 点击该会话查看 → 红点消失
    await page.locator(sel.convItem).first().click();
    await page.waitForTimeout(1500);
    const dotAfter = await dots(page);
    r.ok('点击查看后：红点消失', dotAfter < dotDone, `dot ${dotDone}→${dotAfter}`);
    await page.screenshot({ path: shot('09-after-view-cleared.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  return r.summary();
}

main(import.meta.url, run);
