// 租户内「按人私有」会话隔离 — 浏览器端可视化验证（webapp-testing）。
// 通过注入网关同密钥铸的 JWT 到 localStorage 直接以 aaa/bbb/test 身份进入，免密码。
// 期望：成员 aaa(自建0)→0 条；bbb(自建14)→14 条；超管 test→全租户。
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { CONFIG, sel, shot } from './lib.mjs';

// 密钥从环境变量读，绝不写进仓库：它能签发任意租户/任意用户的令牌，
// 硬编码等于把后端鉴权的钥匙公开（后端已改为由配置提供，见 JwtSecretProvider）。
// 用法：JWT_SECRET="$(取自 Nacos data-server.yml 的 jwt.secret)" node e2e/isolation-check.mjs
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('缺少环境变量 JWT_SECRET：该脚本要自签 JWT 免密码登录，需与后端 jwt.secret 同值。');
  process.exit(1);
}
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function mint(id, username, userType) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({
    iat: now, exp: now + 12 * 3600, nbf: now,
    id, tenant_id: 'test', username, realm: 'ENTERPRISE', user_type: userType,
  }));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

const USERS = [
  { username: 'aaa', id: '2063158983392985090', userType: 'MEMBER', owns: 0 },
  { username: 'bbb', id: '2063170546921369601', userType: 'MEMBER', owns: 14 },
  { username: 'test', id: '2062202006181445634', userType: 'SUPER_ADMIN', owns: 38 },
];

async function probe(browser, u) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // 先到源站再写 localStorage（同源要求），再进 /chat。
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([token, user]) => {
    localStorage.setItem('jm-agent-auth', JSON.stringify({
      state: { token, tenantId: 'test', user }, version: 0,
    }));
  }, [mint(u.id, u.username, u.userType), { id: u.id, tenantId: 'test', username: u.username, userType: u.userType }]);
  await page.goto(`${CONFIG.baseUrl}/chat`, { waitUntil: 'networkidle' });
  // 等会话列表渲染（有 item 就等到，无 item 给空态留时间）。
  await page.locator(sel.convItem).first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const count = await page.locator(sel.convItem).count();
  const url = page.url();
  await page.screenshot({ path: shot(`iso-${u.username}.png`), fullPage: false });
  await ctx.close();
  return { count, url };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  console.log(`=== 会话「按人私有」隔离 — 浏览器验证 (${CONFIG.baseUrl}) ===`);
  let allPass = true;
  for (const u of USERS) {
    const { count, url } = await probe(browser, u);
    const expectMember = u.userType === 'MEMBER';
    // 成员：可见数应等于自建数；超管：应 > 任一成员自建数（看全租户）。
    const pass = expectMember ? count === u.owns : count > 14;
    allPass = allPass && pass;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${u.username.padEnd(4)} (${u.userType.padEnd(11)}) ` +
      `自建=${String(u.owns).padStart(2)}  侧栏可见=${count}  ${url.includes('/login') ? '[被重定向到/login]' : ''}` +
      `  -> shots/iso-${u.username}.png`,
    );
  }
  console.log(`=== ${allPass ? '全部通过 ✅' : '有失败 ❌'} ===`);
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
