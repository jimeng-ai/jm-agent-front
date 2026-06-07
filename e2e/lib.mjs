import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 配置（全部可用环境变量覆盖）。默认指向本机 dev 栈与 test 租户的「知识库助手」。
 * 换环境只需设 E2E_* 变量，无需改脚本。
 */
export const CONFIG = {
  baseUrl: process.env.E2E_BASE_URL || 'http://localhost:8082',
  username: process.env.E2E_USERNAME || 'test',
  password: process.env.E2E_PASSWORD || 'test123',
  // 已发布的「知识库助手」(RAG/对话路径) agentId；换租户/环境务必改这里或设 E2E_AGENT_ID。
  agentId: process.env.E2E_AGENT_ID || '2063267418759462913',
  headed: !!process.env.E2E_HEADED,
  shots: process.env.E2E_SHOTS || join(HERE, 'shots'),
};

mkdirSync(CONFIG.shots, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 选择器集中处：UI 改了只动这里。 */
export const sel = {
  input: 'textarea[placeholder*="输入消息"]',
  send: 'button:has-text("发送")',
  stop: 'button:has-text("停止")',
  convItem: '.chat-conv-item',
  convSpin: '.chat-conv-spin',
  convDot: '.chat-conv-dot',
  convList: '.chat-conv-list',
  transcript: '.chat-conversation-body',
};

export async function launchBrowser() {
  const browser = await chromium.launch({ headless: !CONFIG.headed });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

export async function login(page) {
  await page.goto(`${CONFIG.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', CONFIG.username);
  await page.fill('#password', CONFIG.password);
  await page.click('button:has-text("登")');
  await page.waitForTimeout(2500);
  if (page.url().includes('/login')) {
    throw new Error('登录失败，请检查 E2E_USERNAME / E2E_PASSWORD');
  }
}

export async function openAgent(page) {
  await page.goto(`${CONFIG.baseUrl}/chat/agent/${CONFIG.agentId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(1000);
}

export async function send(page, text) {
  const ta = page.locator(sel.input);
  await ta.click();
  await ta.fill(text);
  await page.locator(sel.send).click();
}

export const stopVisible = (page) =>
  page
    .locator(sel.stop)
    .isVisible()
    .catch(() => false);

export async function waitStreamStart(page, t = 25000) {
  try {
    await page.locator(sel.stop).waitFor({ state: 'visible', timeout: t });
    return true;
  } catch {
    return false;
  }
}

export async function waitStreamEnd(page, t = 120000) {
  try {
    await page.locator(sel.stop).waitFor({ state: 'hidden', timeout: t });
    return true;
  } catch {
    return false;
  }
}

export async function transcript(page) {
  const el = await page.$(sel.transcript);
  return el ? (await el.innerText()).trim() : '';
}

export const dots = (page) => page.locator(sel.convDot).count();
export const spins = (page) => page.locator(sel.convSpin).count();

/** 通过侧栏菜单做 SPA 导航（不重载页面）。 */
export async function clickMenu(page, label) {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(900);
}

export function shot(name) {
  return join(CONFIG.shots, name);
}

/** 简单断言收集器，打印 PASS/FAIL 并汇总。 */
export function reporter(title) {
  const results = [];
  return {
    ok(name, cond, extra = '') {
      results.push({ name, pass: !!cond });
      console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
    },
    summary() {
      const pass = results.filter((r) => r.pass).length;
      console.log(`=== ${title}: ${pass}/${results.length} passed ===`);
      return pass === results.length;
    },
  };
}

/** 让脚本既可被 run-all 导入，也可单独 `node x.mjs` 运行。 */
export function main(importMetaUrl, run) {
  if (importMetaUrl === `file://${process.argv[1]}`) {
    run()
      .then((ok) => process.exit(ok ? 0 : 1))
      .catch((e) => {
        console.error('SUITE ERROR', e);
        process.exit(1);
      });
  }
}
