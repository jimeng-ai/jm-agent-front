// 账号切换缓存隔离 + Agent 编辑器退出保护集成回归。
// 全部请求由浏览器 fixture 拦截，不会触发真实写入。
import { CONFIG, launchBrowser, reporter, sleep } from './lib.mjs';

const BASE = CONFIG.baseUrl;
const AGENT_ID = 'auth-guard-agent';
const ok = (data) => ({ success: true, respCode: '200', respMsg: 'ok', data });

function tokenFor(id, tenantId, { expiresIn = 3600, nonce = '' } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    id,
    tenant_id: tenantId,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    nonce,
  })}.fixture`;
}

const tokenA = tokenFor('user-a', 'tenant-a', { nonce: 'a-near-expiry' });
const tokenARefreshed = tokenFor('user-a', 'tenant-a', {
  expiresIn: 12 * 60 * 60,
  nonce: 'a-refreshed',
});
const tokenALong = tokenFor('user-a', 'tenant-a', {
  expiresIn: 12 * 60 * 60,
  nonce: 'a-long',
});
const tokenB = tokenFor('user-b', 'tenant-b', { nonce: 'b-near-expiry' });
const userA = {
  id: 'user-a',
  tenantId: 'tenant-a',
  username: 'admin-a',
  displayName: 'A 超管',
  userType: 'SUPER_ADMIN',
};
const userB = {
  id: 'user-b',
  tenantId: 'tenant-b',
  username: 'member-b',
  displayName: 'B 成员',
  userType: 'MEMBER',
};
const users = {
  [tokenA]: userA,
  [tokenARefreshed]: userA,
  [tokenALong]: userA,
  [tokenB]: userB,
};

const permissionA = {
  superAdmin: true,
  userType: 'SUPER_ADMIN',
  modules: ['AGENT_MODULE'],
  agentIds: [],
  knowledgeBaseIds: [],
};
const permissionB = {
  superAdmin: false,
  userType: 'MEMBER',
  modules: ['AGENT_MODULE'],
  agentIds: [AGENT_ID],
  knowledgeBaseIds: [],
};
const permissions = {
  [tokenA]: permissionA,
  [tokenARefreshed]: permissionA,
  [tokenALong]: permissionA,
  [tokenB]: permissionB,
};

const connectorA = {
  id: 'connector-a',
  name: 'tenant_a_secret',
  displayName: 'A 租户私有连接',
  kind: 'MYSQL',
  kindLabel: 'MySQL',
  status: 'ACTIVE',
  capabilities: ['QUERY', 'DESCRIBE'],
  healthState: 'HEALTHY',
  readonlyVerified: true,
  writePolicy: 'FORBIDDEN',
  writePolicyLabel: '只读',
  semanticStatus: 'READY',
  semanticCoverage: 'COMPLETE',
};

const fixtureAgent = {
  id: AGENT_ID,
  code: 'auth-guard-agent',
  name: '退出保护 Agent',
  description: '仅用于浏览器 fixture',
  systemPrompt: '你是退出保护测试 Agent。',
  model: 'fixture-model',
  modelParams: JSON.stringify({ temperature: 0.7, topP: 1, maxTokens: 2048 }),
  kbConfig: JSON.stringify({ kbIds: [], topK: 5, scoreThreshold: 0.5, rerank: true }),
  presetQuestions: JSON.stringify([]),
  status: 'PUBLISHED',
  hasUnpublishedChanges: false,
};

function persistedAuth(token) {
  const user = users[token];
  return JSON.stringify({
    state: { token, tenantId: user.tenantId, user },
    version: 0,
  });
}

async function installAuth(page, token) {
  await page.addInitScript(
    ({ auth }) => {
      if (sessionStorage.getItem('__authFixtureBootstrapped') !== '1') {
        localStorage.setItem('jm-agent-auth', auth);
        sessionStorage.setItem('__authFixtureBootstrapped', '1');
      }
    },
    { auth: persistedAuth(token) },
  );
}

async function replacePersistedAuth(page, token) {
  await page.evaluate(
    ({ auth }) => {
      localStorage.setItem('jm-agent-auth', auth);
    },
    { auth: persistedAuth(token) },
  );
}

function authorization(request) {
  return request.headers().authorization ?? '';
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function withTimeout(promise, label, timeout = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
    }),
  ]);
}

async function waitForState(predicate, label, timeout = 5000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeout) {
      throw new Error(`${label} timed out after ${timeout}ms`);
    }
    await sleep(25);
  }
}

function createHandler(state) {
  const fulfill = (route, data, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? ok(data) : data),
    });

  return async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const auth = authorization(request);

    if (method === 'POST' && path === '/data/admin/auth/login') {
      return fulfill(route, { token: state.loginToken, user: users[state.loginToken] });
    }
    if (method === 'POST' && path === '/data/admin/auth/refresh') {
      state.refreshReads.push(auth);
      const delayed = state.delayedRefresh;
      if (delayed?.sourceToken === auth) {
        delayed.started.resolve();
        await delayed.release.promise;
      }
      const nextToken = state.refreshTokenBySource[auth] ?? auth;
      await fulfill(route, { token: nextToken, user: users[auth] ?? userA });
      delayed?.finished.resolve();
      return;
    }
    if (method === 'GET' && path === '/data/admin/auth/me') {
      return fulfill(route, users[auth] ?? users[tokenA]);
    }
    if (method === 'GET' && path === '/data/admin/me/permissions') {
      state.permissionReads.push(auth);
      return fulfill(route, permissions[auth] ?? permissions[tokenA]);
    }
    if (method === 'GET' && path === '/data/admin/connectors/kinds') {
      return fulfill(route, []);
    }
    if (method === 'GET' && path === '/data/admin/connectors') {
      state.connectorReads.push(auth);
      const delayed401 = state.delayedConnector401;
      if (delayed401?.sourceToken === auth) {
        delayed401.started.resolve();
        await delayed401.release.promise;
        await fulfill(
          route,
          { success: false, respCode: '4001', respMsg: 'fixture stale session', data: null },
          401,
        );
        delayed401.finished.resolve();
        return;
      }
      if (auth === tokenB) await sleep(900);
      return fulfill(route, auth === tokenA ? [connectorA] : []);
    }
    if (method === 'GET' && path === `/data/admin/agent/agents/${AGENT_ID}`) {
      return fulfill(route, state.agent);
    }
    if (method === 'PUT' && path === `/data/admin/agent/agents/${AGENT_ID}`) {
      if (state.forceSave401) {
        return fulfill(
          route,
          { success: false, respCode: '4001', respMsg: 'fixture session expired', data: null },
          401,
        );
      }
      if (state.saveDelay) await sleep(state.saveDelay);
      const body = request.postDataJSON();
      state.agentWrites.push(body);
      state.agent = { ...state.agent, ...body, hasUnpublishedChanges: true };
      return fulfill(route, state.agent);
    }
    if (method === 'POST' && path === `/data/admin/agent/agents/${AGENT_ID}/publish`) {
      state.publishRequests += 1;
      return fulfill(route, { ...state.agent, status: 'PUBLISHED', hasUnpublishedChanges: false });
    }
    if (
      method === 'GET' &&
      (path === `/data/admin/agent/agents/${AGENT_ID}/skills` ||
        path === `/data/admin/agent/agents/${AGENT_ID}/connections`)
    ) {
      return fulfill(route, []);
    }
    if (method === 'GET' && path === '/data/admin/models') {
      return fulfill(route, [
        { value: 'fixture-model', label: 'Fixture Model', provider: 'fixture', maxTemp: 2 },
      ]);
    }
    if (
      method === 'GET' &&
      (path === '/data/tenant/skills' || path === '/data/rag/kb')
    ) {
      return fulfill(route, []);
    }
    return fulfill(route, []);
  };
}

async function openUserMenu(page) {
  await page.locator('.atlas-sidebar-foot').click();
  await page.getByText('退出登录', { exact: true }).click();
}

async function loginAsFixture(page, username = 'member-b') {
  await page.getByLabel('账号').fill(username);
  await page.getByLabel('密码').fill('fixture-password');
  await page.locator('button.login-submit').click();
  await page.waitForURL(/\/console(?:\/|$)/, { timeout: 5000 });
}

async function mutateQueryClient(page, operation, marker) {
  return page.evaluate(
    ({ action, value }) => {
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
          const cache = client.getMutationCache();
          if (action === 'seed') {
            cache.build(client, {
              mutationKey: ['fixture-account-mutation', value],
              mutationFn: async () => undefined,
            });
            return true;
          }
          if (action === 'pending-count') {
            return cache.getAll().filter((mutation) => mutation.state.status === 'pending').length;
          }
          return cache
            .getAll()
            .some((mutation) => JSON.stringify(mutation.options.mutationKey).includes(value));
        }
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.alternate) stack.push(fiber.alternate);
      }
      return null;
    },
    { action: operation, value: marker },
  );
}

export default async function run() {
  const r = reporter('auth-agent-integration');
  const { browser, ctx, page } = await launchBrowser();
  const state = {
    loginToken: tokenB,
    permissionReads: [],
    connectorReads: [],
    refreshReads: [],
    refreshTokenBySource: {},
    delayedRefresh: null,
    delayedConnector401: null,
    saveDelay: 0,
    forceSave401: false,
    agentWrites: [],
    publishRequests: 0,
    agent: { ...fixtureAgent },
  };
  await installAuth(page, tokenA);
  await page.route('**/data/**', createHandler(state));

  try {
    // A 超管先读入权限与连接缓存，再退出并登录 B 成员。
    await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
    await page.getByText('A 租户私有连接', { exact: true }).waitFor({ timeout: 5000 });
    const mutationMarker = 'tenant-a-sensitive-mutation';
    const markerSeeded = await mutateQueryClient(page, 'seed', mutationMarker);
    await openUserMenu(page);
    await page.waitForURL(/\/login/);
    // 保持同一 SPA/QueryClient，仅把登录成功落点改为连接治理页。
    await page.evaluate(() => {
      window.history.pushState({}, '', '/login?redirect=%2Fconsole%2Fconnectors');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await loginAsFixture(page);
    await page.waitForURL(/\/console\/connectors$/, { timeout: 5000 });

    const staleConnectionFlashed = await page
      .getByText('A 租户私有连接', { exact: true })
      .isVisible()
      .catch(() => false);
    await page.getByText('仅企业超管可访问', { exact: true }).waitFor({ timeout: 5000 });
    r.ok('A → B 切换不闪现 A 的连接缓存', !staleConnectionFlashed);
    r.ok(
      'A → B 切换重新读取 B 权限并阻断超管面',
      state.permissionReads.includes(tokenB) &&
        (await page.getByText('仅企业超管可访问', { exact: true }).isVisible()),
    );
    r.ok(
      'B 会话不会复用或请求 A 的连接数据',
      state.connectorReads.filter((value) => value === tokenB).length === 0,
      `connector reads=${JSON.stringify(state.connectorReads)}`,
    );
    r.ok(
      'A → B 切换移除 A 的 mutation cache',
      markerSeeded === true && (await mutateQueryClient(page, 'inspect', mutationMarker)) === false,
    );
  } catch (error) {
    const body = ((await page.textContent('body').catch(() => '')) ?? '').slice(0, 240);
    r.ok(
      '账号切换缓存隔离夹具执行',
      false,
      `${error instanceof Error ? error.message : String(error)} · ${body}`,
    );
  }

  const editorPage = await ctx.newPage();
  await installAuth(editorPage, tokenA);
  await editorPage.route('**/data/**', createHandler(state));
  try {
    await editorPage.goto(`${BASE}/console/agents/${AGENT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await editorPage.locator('.agent-editor-header').waitFor({ timeout: 5000 });

    // 切换 section 后，卸载字段仍必须保留在 header 与发布摘要里。
    await editorPage.getByLabel('名称', { exact: true }).fill('跨分区待发布名称');
    await editorPage
      .locator('.agent-editor-nav')
      .getByRole('button', { name: '人设 Prompt', exact: true })
      .click();
    r.ok(
      '编辑名称后切换 section，header 仍显示当前草稿',
      (await editorPage.locator('.agent-editor-header h3').textContent()) ===
        '跨分区待发布名称',
    );
    r.ok(
      '编辑名称后切换 section，发布摘要与提交草稿一致',
      await editorPage
        .locator('.agent-publish-summary')
        .getByText('跨分区待发布名称', { exact: true })
        .isVisible()
        .catch(() => false),
    );

    const writesBeforeSave = state.agentWrites.length;
    await editorPage.getByLabel('保存 Agent 草稿').click();
    await editorPage
      .getByText('已保存草稿（调试台生效）', { exact: true })
      .waitFor({ timeout: 5000 });
    const savedBody = state.agentWrites.at(-1);
    r.ok(
      '切换 section 后保存 PUT 仍提交已卸载的名称字段',
      state.agentWrites.length === writesBeforeSave + 1 &&
        savedBody?.name === '跨分区待发布名称' &&
        savedBody?.code === fixtureAgent.code,
      JSON.stringify(savedBody),
    );

    await editorPage.getByLabel('保存并发布 Agent').click();
    await editorPage
      .getByText('已发布（对话端已更新为当前内容）', { exact: true })
      .waitFor({ timeout: 5000 });
    const publishedBody = state.agentWrites.at(-1);
    r.ok(
      '切换 section 后发布前 PUT 同样提交完整草稿',
      publishedBody?.name === '跨分区待发布名称' && state.publishRequests === 1,
      JSON.stringify(publishedBody),
    );

    await editorPage
      .locator('.agent-editor-nav')
      .getByRole('button', { name: '基础信息', exact: true })
      .click();
    await editorPage.getByLabel('描述', { exact: true }).fill('dirty logout fixture');

    // dirty 时主动退出必须先确认；取消不能清 auth。
    await openUserMenu(editorPage);
    const dirtyDialog = editorPage
      .locator('.ant-modal-confirm:visible')
      .filter({ hasText: '退出登录并放弃未保存的变更？' });
    await dirtyDialog.waitFor();
    await dirtyDialog.getByRole('button', { name: '继续编辑' }).click();
    const tokenAfterCancel = await editorPage.evaluate(() =>
      JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token,
    );
    r.ok(
      'dirty 退出取消后仍保留编辑内容与登录态',
      tokenAfterCancel === tokenA &&
        editorPage.url().endsWith(`/console/agents/${AGENT_ID}`) &&
        (await editorPage.getByText('有未保存变更').count()) > 0,
    );

    await openUserMenu(editorPage);
    await editorPage
      .locator('.ant-modal-confirm:visible')
      .filter({ hasText: '退出登录并放弃未保存的变更？' })
      .getByRole('button', { name: '放弃并退出' })
      .click();
    await editorPage.waitForURL(/\/login/);
    r.ok('dirty 退出仅在确认后清理登录态并进入登录页', true);

    // 重新登录，再验证 clean + saving 的主动退出语义。
    state.loginToken = tokenA;
    await loginAsFixture(editorPage, 'admin-a');
    await editorPage.goto(`${BASE}/console/agents/${AGENT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await editorPage.locator('.agent-editor-header').waitFor({ timeout: 5000 });
    state.saveDelay = 1800;
    await editorPage.getByLabel('保存 Agent 草稿').click();
    await editorPage.waitForFunction(() =>
      document
        .querySelector('[aria-label="保存 Agent 草稿"]')
        ?.classList.contains('ant-btn-loading'),
    );
    const pendingBeforeLogout = await mutateQueryClient(editorPage, 'pending-count', '');
    await openUserMenu(editorPage);
    const busyDialog = editorPage
      .locator('.ant-modal-confirm:visible')
      .filter({ hasText: 'Agent 正在保存，确定退出登录？' });
    await busyDialog.waitFor();
    r.ok(
      'saving 时主动退出显示准确的等待风险语义',
      await busyDialog.getByText(/操作完成前退出/).isVisible().catch(() => false),
    );
    await busyDialog.getByRole('button', { name: '继续等待' }).click();
    const busyCancelToken = await editorPage.evaluate(() =>
      JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token,
    );
    r.ok('saving 退出取消不清登录态', busyCancelToken === tokenA);

    await openUserMenu(editorPage);
    await editorPage
      .locator('.ant-modal-confirm:visible')
      .filter({ hasText: 'Agent 正在保存，确定退出登录？' })
      .getByRole('button', { name: '仍要退出' })
      .click();
    await editorPage.waitForURL(/\/login/);
    const pendingAfterLogout = await mutateQueryClient(editorPage, 'pending-count', '');
    r.ok(
      'saving 退出确认后才清登录态并移除真实 pending mutation',
      pendingBeforeLogout > 0 && pendingAfterLogout === 0,
      `before=${pendingBeforeLogout}, after=${pendingAfterLogout}`,
    );

    // 服务端强制失效不是用户主动退出，不能再被本地 dirty/busy guard 阻挡。
    state.saveDelay = 0;
    state.forceSave401 = false;
    await loginAsFixture(editorPage, 'admin-a');
    await editorPage.goto(`${BASE}/console/agents/${AGENT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await editorPage.locator('.agent-editor-header').waitFor({ timeout: 5000 });
    await editorPage.getByLabel('描述', { exact: true }).fill('401 前的未保存修改');
    state.forceSave401 = true;
    const browserDialogs = [];
    editorPage.on('dialog', async (dialog) => {
      browserDialogs.push(dialog.type());
      await dialog.dismiss();
    });
    await editorPage.getByLabel('保存 Agent 草稿').click();
    await editorPage.waitForURL(/\/login/, { timeout: 5000 });
    r.ok(
      'HTTP 401 强制登出绕过 dirty guard 并直接完成',
      browserDialogs.length === 0 &&
        (await editorPage.locator('.ant-modal-confirm:visible').count()) === 0,
      `browser dialogs=${JSON.stringify(browserDialogs)}`,
    );
  } catch (error) {
    const body = ((await editorPage.textContent('body').catch(() => '')) ?? '').slice(0, 240);
    r.ok(
      'Agent 退出保护夹具执行',
      false,
      `${error instanceof Error ? error.message : String(error)} · ${body}`,
    );
  } finally {
    await editorPage.close();
  }

  const refreshRacePage = page;
  refreshRacePage.setDefaultTimeout(5000);
  try {
    // 先完成一次普通加载，避免把未 resolve 的 route 作为顶层 navigation 依赖；
    // 再通过 SPA 导航触发需要被延迟的业务请求与静默续期。
    delete state.refreshTokenBySource[tokenA];
    state.delayedRefresh = null;
    const initialRefreshCount = state.refreshReads.length;
    await replacePersistedAuth(refreshRacePage, tokenA);
    await refreshRacePage.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });
    await waitForState(
      () => state.refreshReads.length > initialRefreshCount,
      'initial A refresh',
    );
    await sleep(50);

    const delayedRefresh = {
      sourceToken: tokenA,
      started: deferred(),
      release: deferred(),
      finished: deferred(),
    };
    state.loginToken = tokenB;
    state.refreshTokenBySource[tokenA] = tokenARefreshed;
    state.delayedRefresh = delayedRefresh;

    await refreshRacePage.getByText('数据连接', { exact: true }).click();
    await withTimeout(delayedRefresh.started.promise, 'A refresh start');
    await openUserMenu(refreshRacePage);
    await refreshRacePage.waitForURL(/\/login/);
    await loginAsFixture(refreshRacePage);
    const bCacheMarker = 'tenant-b-cache-survives-stale-refresh';
    await mutateQueryClient(refreshRacePage, 'seed', bCacheMarker);

    delayedRefresh.release.resolve();
    await withTimeout(delayedRefresh.finished.promise, 'A refresh finish');
    await sleep(150);
    const tokenAfterStaleRefresh = await refreshRacePage.evaluate(() =>
      JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token,
    );
    r.ok(
      'A 延迟 refresh 在 B 登录后返回不会恢复 A 或清 B 缓存',
      tokenAfterStaleRefresh === tokenB &&
        (await mutateQueryClient(refreshRacePage, 'inspect', bCacheMarker)) === true,
    );
  } catch (error) {
    r.ok(
      '延迟 refresh 会话竞态夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    state.delayedRefresh = null;
  }

  const stale401Page = page;
  stale401Page.setDefaultTimeout(5000);
  try {
    state.delayedConnector401 = null;
    await replacePersistedAuth(stale401Page, tokenALong);
    await stale401Page.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });

    const delayed401 = {
      sourceToken: tokenALong,
      started: deferred(),
      release: deferred(),
      finished: deferred(),
    };
    state.loginToken = tokenB;
    state.delayedConnector401 = delayed401;

    await stale401Page.getByText('数据连接', { exact: true }).click();
    await withTimeout(delayed401.started.promise, 'A connector request start');
    await openUserMenu(stale401Page);
    await stale401Page.waitForURL(/\/login/);
    await loginAsFixture(stale401Page);
    const b401Marker = 'tenant-b-cache-survives-stale-401';
    await mutateQueryClient(stale401Page, 'seed', b401Marker);

    delayed401.release.resolve();
    await withTimeout(delayed401.finished.promise, 'A connector 401 finish');
    await sleep(250);
    const tokenAfterStale401 = await stale401Page.evaluate(() =>
      JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token,
    );
    r.ok(
      'A 延迟请求在 B 登录后返回 401 不会登出 B 或清 B 缓存',
      tokenAfterStale401 === tokenB &&
        !stale401Page.url().includes('/login') &&
        (await mutateQueryClient(stale401Page, 'inspect', b401Marker)) === true,
      stale401Page.url(),
    );
  } catch (error) {
    r.ok(
      '延迟 401 会话竞态夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    state.delayedConnector401 = null;
  }

  await browser.close();

  return r.summary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const passed = await run();
  process.exit(passed ? 0 : 1);
}
