// 多窗口：同一会话在两个独立窗口里都能实时看到同一份生成流。
import {
  launchBrowser,
  login,
  openAgent,
  send,
  transcript,
  waitStreamStart,
  waitStreamEnd,
  stopVisible,
  clickMenu,
  reporter,
  shot,
  sel,
  CONFIG,
  main,
} from './lib.mjs';

export default async function run() {
  const r = reporter('multi-window');
  const { browser, ctx, page } = await launchBrowser();
  try {
    await login(page);

    // window1：发起一轮长生成，并定位到 /chat/c/{convId}
    await openAgent(page);
    await send(
      page,
      '请用中文写一篇约800字的文章，详细讲解企业如何从0搭建一个 RAG 知识库，覆盖数据准备、文档切片、向量化、混合检索、重排序、答案生成与引用，每个环节都给出要点。',
    );
    await waitStreamStart(page);
    await clickMenu(page, '对话');
    await page.locator(sel.convItem).first().click();
    await page.waitForTimeout(800);
    const convId = (page.url().match(/\/chat\/c\/(\d+)/) || [])[1] || '';
    r.ok('已定位到会话', !!convId, `convId=${convId}`);

    // window2：独立 context 复用登录态，打开同一会话
    const ctx2 = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      storageState: await ctx.storageState(),
    });
    const page2 = await ctx2.newPage();
    await page2.goto(`${CONFIG.baseUrl}/chat/c/${convId}`, { waitUntil: 'domcontentloaded' });

    const w2Streaming = await waitStreamStart(page2, 18000);
    const w1Streaming = await stopVisible(page);
    await page2.waitForTimeout(1500);
    const len2a = (await transcript(page2)).length;
    await page2.waitForTimeout(3000);
    const len2b = (await transcript(page2)).length;

    r.ok(
      '两窗口同时处于「生成中」',
      w1Streaming && w2Streaming,
      `w1=${w1Streaming} w2=${w2Streaming}`,
    );
    r.ok('第二窗口实时看到同一会话的 token 增量', len2b > len2a + 5, `len ${len2a}→${len2b}`);
    await page.screenshot({ path: shot('06a-window1.png'), fullPage: true });
    await page2.screenshot({ path: shot('06b-window2-live.png'), fullPage: true });

    await waitStreamEnd(page, 120000);
    await ctx2.close();
  } finally {
    await browser.close();
  }
  return r.summary();
}

main(import.meta.url, run);
