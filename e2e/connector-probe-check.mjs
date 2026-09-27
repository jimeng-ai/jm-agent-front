// 弹窗内「测试连接」的 UI 实跑。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/**
 * React Query 不对外暴露 QueryClient。E2E 从 React root fiber 找到
 * QueryClientProvider 的 client prop，只返回「是否命中 marker」，不把凭据打到日志。
 */
const inspectMutationCache = (page, marker) =>
  page.evaluate((secretMarker) => {
    const root = document.getElementById('root');
    const rootKey = Object.getOwnPropertyNames(root ?? {}).find((key) =>
      key.startsWith('__reactContainer$'),
    );
    const stack = rootKey ? [root[rootKey]] : [];
    const seen = new Set();
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || typeof fiber !== 'object' || seen.has(fiber)) continue;
      seen.add(fiber);
      const client = fiber.memoizedProps?.client;
      if (client && typeof client.getMutationCache === 'function') {
        const serialized = client
          .getMutationCache()
          .getAll()
          .map((mutation) => {
            try {
              return JSON.stringify(mutation.state.variables);
            } catch {
              return '';
            }
          });
        return {
          foundClient: true,
          mutationCount: serialized.length,
          containsMarker: serialized.some((value) => value.includes(secretMarker)),
        };
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.alternate) stack.push(fiber.alternate);
    }
    return { foundClient: false, mutationCount: 0, containsMarker: false };
  }, marker);

const fill = async (page, { host, port, db, user, pass }) => {
  const m = '[data-testid="connector-form-drawer"] ';
  await page.fill(`${m}#params_host`, host);
  await page.fill(`${m}#params_port`, String(port));
  await page.fill(`${m}#params_database`, db);
  await page.fill(`${m}#params_username`, user);
  await page.fill(`${m}#params_password`, pass);
};

/**
 * 点「测试连接」并等结果。
 *
 * 不能用固定 sleep（连不通要等满 5s 连接超时，Hikari 在窗口内还会重试），
 * 也不能手动删 DOM 再等它出现——那会破坏 React 的协调，下一次结果就渲染不出来了。
 * 正确做法是等【文案变化】：组件在点击时会先 setProbeResult(null)，所以新旧一定不同。
 */
const probe = async (page) => {
  const before = await page.textContent('[data-testid="connector-probe-state"]').catch(() => null);
  await page.click('[data-testid="connector-form-drawer"] button:has-text("测试连接")');
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-testid="connector-probe-state"]');
      return (
        !!el &&
        el.dataset.probePending === 'false' &&
        el.dataset.probeResult === 'ready' &&
        el.textContent !== prev
      );
    },
    before,
    { timeout: 30000 },
  );
  await sleep(300);
  return page.textContent('[data-testid="connector-form-drawer"]');
};

const { browser, page } = await launchBrowser();
try {
  // 整个脚本强制走内网 HTTP 的无 Web Crypto 分支；UI 脚本仍覆盖正常 subtle 路径。
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: undefined,
    });
  });
  await login(page);
  check(
    'fixture 已强制进入同步非明文指纹回退',
    await page.evaluate(() => !globalThis.crypto.subtle),
  );
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connector-card-grid"]');
  await page.click('button:has-text("新建连接")');
  await page.waitForSelector('[data-testid="connector-form-drawer"]');

  // 选 MySQL 类型
  await page.click(
    '[data-testid="connector-form-drawer"] .ant-form-item:has(label[for="kind"]) .ant-select-selector',
  );
  await sleep(500);
  await page.click('.ant-select-item-option:has-text("MySQL")');
  await sleep(800);
  await page.fill('[data-testid="connector-form-drawer"] #name', 'probe-ui-test');

  check(
    'Drawer 里有「测试连接」按钮',
    (await page.textContent('[data-testid="connector-form-drawer"]')).includes('测试连接'),
  );

  // 凭据可以进本次 HTTP body，但不能成为 React Query mutation variables：
  // MutationCache 会在 Drawer 关闭后继续存活，把 payload 放进 variables 等于延长明文寿命。
  const cacheMarker = `probe-cache-secret-${Date.now()}`;
  await fill(page, {
    host: '127.0.0.1',
    port: 3307,
    db: 'demo_shop',
    user: 'jm_ro',
    pass: cacheMarker,
  });
  await sleep(150);
  await page.evaluate(() => {
    const releases = [];
    window.__doubleProbeDigestCount = 0;
    window.__releaseDoubleProbeDigests = () => {
      for (const release of releases.splice(0)) release(new Uint8Array(32).buffer);
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: {
        digest: () =>
          new Promise((resolve) => {
            releases.push(resolve);
            window.__doubleProbeDigestCount += 1;
          }),
      },
    });
  });
  const heldProbeRoutes = [];
  let markProbeSeen;
  const probeSeen = new Promise((resolve) => {
    markProbeSeen = resolve;
  });
  const holdProbe = (route) => {
    heldProbeRoutes.push(route);
    markProbeSeen();
  };
  await page.route('**/admin/connectors/probe**', holdProbe);
  const testButton = page.locator(
    '[data-testid="connector-form-drawer"] button:has-text("测试连接")',
  );
  await testButton.evaluate((button) => button.click());
  await page.waitForFunction(() => window.__doubleProbeDigestCount >= 1);
  // 第一次已经越过 validateFields、卡在 digest，按钮此时仍未进 mutation loading。
  // 再点一次能稳定命中「任何 await 前必须同步锁」这个竞态窗口。
  await testButton.evaluate((button) => button.click());
  await sleep(150);
  await page.evaluate(() => window.__releaseDoubleProbeDigests());
  await probeSeen;
  await sleep(250);
  check('连续双击测试只发一次 POST', heldProbeRoutes.length === 1, `posts=${heldProbeRoutes.length}`);
  const pendingCache = await inspectMutationCache(page, cacheMarker);
  check(
    '试连在途时 MutationCache 不含凭据',
    pendingCache.foundClient && !pendingCache.containsMarker,
    `mutations=${pendingCache.mutationCount}`,
  );
  for (const heldProbeRoute of heldProbeRoutes) {
    await heldProbeRoute.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        respCode: '200',
        respMsg: 'ok',
        data: {
          ok: true,
          failureReason: null,
          capabilities: ['QUERY', 'DESCRIBE'],
          readonlyVerified: true,
          readonlyUndetermined: false,
          readonlyDetail: 'fixture',
        },
      }),
    });
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="connector-probe-state"]')?.dataset.probePending ===
      'false',
  );
  const settledCache = await inspectMutationCache(page, cacheMarker);
  check(
    '试连完成后 MutationCache 仍不含凭据',
    settledCache.foundClient && !settledCache.containsMarker,
    `mutations=${settledCache.mutationCount}`,
  );
  await page.unroute('**/admin/connectors/probe**', holdProbe);
  await page.evaluate(() => {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: undefined,
    });
  });

  // ① 端口错
  await fill(page, {
    host: '127.0.0.1',
    port: 3306,
    db: 'demo_shop',
    user: 'jm_ro',
    pass: 'ro_pass_123',
  });
  let modal = await probe(page);
  await page.screenshot({ path: shot('probe-unreachable.png') });
  check(
    '端口不通 → 就地显示原因',
    modal.includes('连接测试未通过') && modal.includes('端口未开放'),
  );

  // ② 可写账号
  await fill(page, {
    host: '127.0.0.1',
    port: 3307,
    db: 'demo_shop',
    user: 'jm_rw',
    pass: 'rw_pass_123',
  });
  modal = await probe(page);
  await page.screenshot({ path: shot('probe-writable.png') });
  check(
    '可写账号 → 明确要求换只读账号',
    modal.includes('具备写权限') && modal.includes('GRANT SELECT'),
  );

  // 同一组可写凭据在平台策略明确放开写之后应通过，但绝不能误报成「只读已验证」。
  const policyItem =
    '[data-testid="connector-form-drawer"] .ant-form-item:has(label[for="writePolicy"])';
  await page.click(`${policyItem} .ant-select-selector`);
  await page.click('.ant-select-dropdown:visible .ant-select-item:has-text("写需审批")');
  modal = await probe(page);
  check(
    '可写策略通过时不误报只读',
    modal.includes('写策略验证通过') && !modal.includes('连接正常，只读已验证'),
  );
  await page.click(`${policyItem} .ant-select-selector`);
  await page.click('.ant-select-dropdown:visible .ant-select-item:has-text("只读")');

  // ③ 密码错
  await fill(page, {
    host: '127.0.0.1',
    port: 3307,
    db: 'demo_shop',
    user: 'jm_ro',
    pass: 'WRONG',
  });
  modal = await probe(page);
  check('密码错 → 归到凭据无效', modal.includes('用户名或密码不正确'));

  // ④ 正确
  await fill(page, {
    host: '127.0.0.1',
    port: 3307,
    db: 'demo_shop',
    user: 'jm_ro',
    pass: 'ro_pass_123',
  });
  modal = await probe(page);
  await page.screenshot({ path: shot('probe-ok.png') });
  check(
    '参数正确 → 成功并列出探到的能力',
    modal.includes('连接正常，只读已验证') && modal.includes('能查') && modal.includes('能自描述'),
  );
  check('给出只读判定依据', modal.includes('只读依据'));

  // 指纹必须逐字绑定用户真正准备提交的凭据。尾随空格对数据库密码不是“等价格式”，
  // 成功后把 secret 改成 `secret ` 应立即作废旧结果，而不是继续显示绿色成功。
  await page.fill('[data-testid="connector-form-drawer"] #params_password', 'ro_pass_123 ');
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="connector-probe-state"]');
    return state?.textContent?.includes('需要重新测试');
  });
  modal = await page.textContent('[data-testid="connector-form-drawer"]');
  check(
    '测试成功后凭据追加空格 → 旧结果立即失效',
    modal.includes('关键连接参数已变化，需要重新测试') && !modal.includes('连接正常，只读已验证'),
  );

  // 指纹 digest 是异步边界：等待期间 Drawer 还没进入 mutation pending，所以允许关闭。
  // 关闭后即使 digest 恢复，旧会话也不得发出 probe POST。
  await page.evaluate(() => {
    let releaseDigest;
    const delayedDigest = new Promise((resolve) => {
      releaseDigest = resolve;
    });
    window.__probeDigestPending = false;
    window.__releaseProbeDigest = () => releaseDigest(new Uint8Array(32).buffer);
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: {
        digest: () => {
          window.__probeDigestPending = true;
          return delayedDigest;
        },
      },
    });
  });
  let postAfterClose = 0;
  const countProbeAfterClose = (route) => {
    postAfterClose += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        respCode: '200',
        respMsg: 'ok',
        data: {
          ok: true,
          capabilities: ['QUERY'],
          readonlyVerified: true,
          readonlyUndetermined: false,
        },
      }),
    });
  };
  await page.route('**/admin/connectors/probe**', countProbeAfterClose);
  await page.click('[data-testid="connector-form-drawer"] button:has-text("测试连接")');
  await page.waitForFunction(() => window.__probeDigestPending === true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="connector-form-drawer"]', { state: 'hidden' });
  await page.evaluate(() => window.__releaseProbeDigest());
  await sleep(500);
  check('digest 等待期间关闭 Drawer 后不发 POST', postAfterClose === 0, `posts=${postAfterClose}`);
  await page.unroute('**/admin/connectors/probe**', countProbeAfterClose);

  // ⑤ 试连不落库
  await sleep(1200);
  const body = await page.textContent('body');
  check('试连不落库（列表里没有 probe-ui-test）', !body.includes('probe-ui-test'));
} catch (e) {
  console.log('  ✗ 异常中断:', e.message);
  await page.screenshot({ path: shot('probe-error.png') }).catch(() => {});
  results.push({ name: '脚本执行', ok: false, detail: e.message });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
