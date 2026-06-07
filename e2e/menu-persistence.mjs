// 红点跨「SPA 菜单切换」保留（曾经的 bug：切到别的菜单栏再回来红点消失），
// 以及「在别的菜单时完成的会话回来也出红点」。
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

const waitSpinAppear = async (page, t = 15000) => {
  const s = Date.now();
  while (Date.now() - s < t) {
    if ((await spins(page)) >= 1) return true;
    await sleep(500);
  }
  return false;
};
const waitSpinGone = async (page, t = 120000) => {
  const s = Date.now();
  while (Date.now() - s < t) {
    if ((await spins(page)) === 0) return true;
    await sleep(1500);
  }
  return false;
};

export default async function run() {
  const r = reporter('menu-persistence');
  const { browser, page } = await launchBrowser();
  try {
    await login(page);
    await page.evaluate(() => localStorage.removeItem('jm-chat-unread'));

    // A: 红点应跨 SPA 菜单切换保留
    await openAgent(page);
    await send(page, '请用中文写约500字，介绍企业知识库的价值。');
    await clickMenu(page, '对话');
    await waitSpinAppear(page);
    await waitSpinGone(page);
    await page.waitForTimeout(1200);
    r.ok('回答完毕出现红点', (await dots(page)) >= 1, `dot=${await dots(page)}`);
    await page.screenshot({ path: shot('10a-dot-appeared.png'), fullPage: true });

    await clickMenu(page, '仪表盘'); // 切到别的菜单（侧栏卸载）
    r.ok('已切到仪表盘', page.url().includes('/console/dashboard'));
    await clickMenu(page, '对话'); // 切回对话
    await page.waitForTimeout(1500);
    r.ok(
      '切到别的菜单再切回来：红点仍在（修复点）',
      (await dots(page)) >= 1,
      `dot=${await dots(page)}`,
    );
    await clickMenu(page, 'Agents');
    await clickMenu(page, '对话');
    await page.waitForTimeout(1200);
    r.ok('再切一轮菜单：红点仍在', (await dots(page)) >= 1, `dot=${await dots(page)}`);
    await page.screenshot({ path: shot('10b-dot-survives-menu.png'), fullPage: true });

    // B: 在别的菜单时完成的会话，回来也应出红点
    const dotBefore = await dots(page);
    await openAgent(page);
    await send(page, '请用中文写约500字，讲讲 RAG 检索增强生成的原理。');
    await clickMenu(page, '仪表盘'); // 生成中就离开
    await sleep(15000); // 服务端把这轮跑完
    await clickMenu(page, '对话'); // 回来
    let dotB = 0;
    for (let i = 0; i < 10; i++) {
      dotB = await dots(page);
      if (dotB > dotBefore) break;
      await sleep(1500);
    }
    r.ok('在别的菜单时完成的会话，回来出现红点', dotB > dotBefore, `dot ${dotBefore}→${dotB}`);
    await page.screenshot({ path: shot('11-away-completion-dot.png'), fullPage: true });

    // C: 点击查看 → 该会话红点减少
    const before = await dots(page);
    await page.locator(sel.convItem).first().click();
    await page.waitForTimeout(1500);
    const after = await dots(page);
    r.ok('点击查看后红点减少', after < before, `dot ${before}→${after}`);
    await page.screenshot({ path: shot('12-after-view.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  return r.summary();
}

main(import.meta.url, run);
