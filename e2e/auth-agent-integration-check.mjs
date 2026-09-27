// 账号切换缓存隔离 + Agent 编辑器退出保护集成回归。
// 全部请求由浏览器 fixture 拦截，不会触发真实写入。
import { CONFIG, launchBrowser, reporter, sleep } from './lib.mjs';

if (!process.env.E2E_BASE_URL) {
  throw new Error(
    'auth-agent-integration 必须显式设置 E2E_BASE_URL（例如 http://localhost:5173），拒绝回退到旧 :8082 包。',
  );
}

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
const tokenARotatedNear = tokenFor('user-a', 'tenant-a', {
  expiresIn: 2 * 60 * 60,
  nonce: 'a-rotated-near-expiry',
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
  [tokenARotatedNear]: userA,
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
  [tokenARotatedNear]: permissionA,
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
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
  });
  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => clearTimeout(timer));
}

async function persistedToken(page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token,
  );
}

async function nextBrowserFrame(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
}

async function setRenewProbeAuth(page, token) {
  await page.evaluate(
    async ({ currentToken, currentUser }) => {
      const { useAuthStore } = await import('/src/stores/authStore.ts');
      useAuthStore.getState().setAuth({ token: currentToken, user: currentUser });
    },
    { currentToken: token, currentUser: users[token] },
  );
}

async function runRenewProbe(page, nextToken) {
  return page.evaluate(async (candidate) => {
    const { useAuthStore } = await import('/src/stores/authStore.ts');
    const before = useAuthStore.getState();
    const accepted = before.renewToken(candidate);
    const after = useAuthStore.getState();
    return {
      accepted,
      token: after.token,
      tenantId: after.tenantId,
      userId: after.user?.id ?? null,
      generationUnchanged: after.sessionGeneration === before.sessionGeneration,
    };
  }, nextToken);
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
    if (method === 'POST' && path === '/data/fixture/auth-sse') {
      const delayedSse = state.delayedSseAuth;
      if (delayedSse?.sourceToken === auth) {
        delayedSse.started.resolve();
        await delayedSse.release.promise;
        await fulfill(
          route,
          { success: false, respCode: '4001', respMsg: 'fixture stale SSE session', data: null },
          delayedSse.status,
        );
        delayedSse.finished.resolve();
        return;
      }
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

async function replaceSessionThroughUi(page, state, token, username = 'admin-a') {
  if (!page.url().includes('/login')) {
    await openUserMenu(page);
    await page.waitForURL(/\/login/);
  }
  state.loginToken = token;
  await loginAsFixture(page, username);
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
    delayedSseAuth: null,
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

    const writesBeforePublish = state.agentWrites.length;
    await editorPage.getByLabel('保存并发布 Agent').click();
    await editorPage
      .getByText('已发布（对话端已更新为当前内容）', { exact: true })
      .waitFor({ timeout: 5000 });
    const publishedBody = state.agentWrites.at(-1);
    r.ok(
      '切换 section 后发布前 PUT 同样提交完整草稿',
      state.agentWrites.length === writesBeforePublish + 1 &&
        publishedBody?.name === '跨分区待发布名称' &&
        state.publishRequests === 1,
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
    await withTimeout(editorPage.close(), 'editor fixture page close').catch(() => undefined);
  }

  const refreshRacePage = page;
  refreshRacePage.setDefaultTimeout(5000);
  refreshRacePage.setDefaultNavigationTimeout(5000);
  const delayedRefresh = {
    sourceToken: tokenARotatedNear,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    // 首次 refresh 明确 rotation 到另一枚仍临期的 A token；等 token 落库后再启动第二次
    // delayed refresh，因此不靠固定 sleep 猜测全局 renewing 是否已释放。
    state.refreshTokenBySource[tokenA] = tokenARotatedNear;
    state.delayedRefresh = null;
    await replacePersistedAuth(refreshRacePage, tokenA);
    await refreshRacePage.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });
    await refreshRacePage.waitForFunction(
      (expected) =>
        JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token === expected,
      tokenARotatedNear,
      { timeout: 5000 },
    );

    state.refreshTokenBySource[tokenARotatedNear] = tokenARefreshed;
    state.delayedRefresh = delayedRefresh;
    await refreshRacePage.getByText('数据连接', { exact: true }).click();
    await withTimeout(delayedRefresh.started.promise, 'A refresh start');

    await openUserMenu(refreshRacePage);
    await refreshRacePage.waitForURL(/\/login/);
    state.loginToken = tokenB;
    await loginAsFixture(refreshRacePage);
    const bCacheMarker = 'tenant-b-cache-survives-stale-refresh';
    await mutateQueryClient(refreshRacePage, 'seed', bCacheMarker);

    delayedRefresh.release.resolve();
    await withTimeout(delayedRefresh.finished.promise, 'A refresh finish');
    await nextBrowserFrame(refreshRacePage);
    const tokenAfterStaleRefresh = await persistedToken(refreshRacePage);
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
    delayedRefresh.release.resolve();
    state.delayedRefresh = null;
  }

  const sameTokenRefresh = {
    sourceToken: tokenARotatedNear,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    // 旧 refresh 与新登录复用同一 token 字符串，只能靠 generation 区分。
    // 先安装 deferred 再登录，让 started 成为续期已在途的明确同步点。
    state.refreshTokenBySource[tokenARotatedNear] = tokenARefreshed;
    state.delayedRefresh = sameTokenRefresh;
    await replaceSessionThroughUi(page, state, tokenARotatedNear);
    await withTimeout(sameTokenRefresh.started.promise, 'same-token refresh start');

    await openUserMenu(page);
    await page.waitForURL(/\/login/);
    await loginAsFixture(page, 'admin-a');
    const marker = 'same-token-new-generation-survives-stale-refresh';
    await mutateQueryClient(page, 'seed', marker);

    sameTokenRefresh.release.resolve();
    await withTimeout(sameTokenRefresh.finished.promise, 'same-token stale refresh finish');
    // 避免后续正常请求再次换发干扰断言；旧响应已在 finished 之前读取到 ARefreshed。
    delete state.refreshTokenBySource[tokenARotatedNear];
    await nextBrowserFrame(page);
    r.ok(
      '同一 token 退出再登录后，旧 generation 的 refresh 不会改写新会话或清缓存',
      (await persistedToken(page)) === tokenARotatedNear &&
        (await mutateQueryClient(page, 'inspect', marker)) === true,
    );
  } catch (error) {
    r.ok(
      '同 token refresh generation 栅栏夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    sameTokenRefresh.release.resolve();
    delete state.refreshTokenBySource[tokenARotatedNear];
    state.delayedRefresh = null;
  }

  const stale401Page = page;
  stale401Page.setDefaultTimeout(5000);
  const delayed401 = {
    sourceToken: tokenALong,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    state.delayedConnector401 = null;
    await replacePersistedAuth(stale401Page, tokenALong);
    await stale401Page.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });

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
    await nextBrowserFrame(stale401Page);
    const tokenAfterStale401 = await persistedToken(stale401Page);
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
    delayed401.release.resolve();
    state.delayedConnector401 = null;
  }

  const sameToken401 = {
    sourceToken: tokenALong,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    // token 字符串相同，只让 logout/login 推进 generation；若实现只有 token fence，这条会失败。
    await openUserMenu(page);
    await page.waitForURL(/\/login/);
    state.loginToken = tokenALong;
    await loginAsFixture(page, 'admin-a');

    state.delayedConnector401 = sameToken401;
    await page.getByText('数据连接', { exact: true }).click();
    await withTimeout(sameToken401.started.promise, 'same-token A connector request start');
    await openUserMenu(page);
    await page.waitForURL(/\/login/);
    await loginAsFixture(page, 'admin-a');
    const generationMarker = 'same-token-new-generation-cache';
    await mutateQueryClient(page, 'seed', generationMarker);

    sameToken401.release.resolve();
    await withTimeout(sameToken401.finished.promise, 'same-token stale 401 finish');
    await nextBrowserFrame(page);
    r.ok(
      '同一 token 退出再登录后，旧 generation 的 401 不会清理新会话',
      (await persistedToken(page)) === tokenALong &&
        !page.url().includes('/login') &&
        (await mutateQueryClient(page, 'inspect', generationMarker)) === true,
      page.url(),
    );
  } catch (error) {
    r.ok(
      '同 token generation 栅栏夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    sameToken401.release.resolve();
    state.delayedConnector401 = null;
  }

  try {
    // 独立调用 production auth store，避免外层 source fence 掩盖 renewToken 自身的身份约束。
    const clientCalibrationMarker = 'renew-probe-shares-app-query-client';
    await mutateQueryClient(page, 'seed', clientCalibrationMarker);
    // 用长效 A token 隔离 renewToken 本体；否则页面活跃查询会同时启动自动 refresh，
    // 把探针的同步断言变成与后台续期抢时序的测试。
    await setRenewProbeAuth(page, tokenALong);
    const usesAppQueryClient =
      (await mutateQueryClient(page, 'inspect', clientCalibrationMarker)) === false;
    const rotationMarker = 'same-identity-refresh-keeps-cache';
    await mutateQueryClient(page, 'seed', rotationMarker);
    const rotation = await runRenewProbe(page, tokenARefreshed);
    r.ok(
      'renewToken 接受同身份 A→ARefreshed rotation 且保留账号缓存与身份',
      usesAppQueryClient &&
        rotation.accepted === true &&
        rotation.token === tokenARefreshed &&
        rotation.tenantId === userA.tenantId &&
        rotation.userId === userA.id &&
        rotation.generationUnchanged &&
        (await mutateQueryClient(page, 'inspect', rotationMarker)) === true,
    );
  } catch (error) {
    r.ok(
      'renewToken 同身份 rotation 夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    await setRenewProbeAuth(page, tokenALong);
    const rejectedRotationMarker = 'cross-identity-refresh-keeps-cache';
    await mutateQueryClient(page, 'seed', rejectedRotationMarker);
    const rejectedRotation = await runRenewProbe(page, tokenB);
    const rejectedRotationCachePreserved =
      (await mutateQueryClient(page, 'inspect', rejectedRotationMarker)) === true;
    r.ok(
      'renewToken 拒绝 A→B 跨身份 refresh token 且保留 token/cache/身份',
      rejectedRotation.accepted === false &&
        rejectedRotation.token === tokenALong &&
        rejectedRotation.tenantId === userA.tenantId &&
        rejectedRotation.userId === userA.id &&
        rejectedRotation.generationUnchanged &&
        rejectedRotationCachePreserved,
      JSON.stringify({ ...rejectedRotation, cachePreserved: rejectedRotationCachePreserved }),
    );
  } catch (error) {
    r.ok(
      'renewToken 跨身份拒绝夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  const preRotation401 = {
    sourceToken: tokenARotatedNear,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  const inFlightRotation = {
    sourceToken: tokenARotatedNear,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    // T1 的业务请求和 refresh 同时在途；先放行 refresh 得到 T2，再放行 T1 的 401。
    // 这条走真实 request interceptor + maybeRenewToken，不用测试探针改写 auth store。
    state.refreshTokenBySource[tokenARotatedNear] = tokenARefreshed;
    state.delayedRefresh = inFlightRotation;
    await replaceSessionThroughUi(page, state, tokenARotatedNear);
    await withTimeout(inFlightRotation.started.promise, 'T1 refresh start');

    state.delayedConnector401 = preRotation401;
    await page.getByText('数据连接', { exact: true }).click();
    await withTimeout(preRotation401.started.promise, 'T1 connector request start');

    inFlightRotation.release.resolve();
    await withTimeout(inFlightRotation.finished.promise, 'T1→T2 refresh finish');
    await page.waitForFunction(
      (expected) =>
        JSON.parse(localStorage.getItem('jm-agent-auth') ?? '{}')?.state?.token === expected,
      tokenARefreshed,
      { timeout: 5000 },
    );
    state.delayedRefresh = null;
    const marker = 'rotated-session-survives-pre-rotation-401';
    await mutateQueryClient(page, 'seed', marker);
    preRotation401.release.resolve();
    await withTimeout(preRotation401.finished.promise, 'T1 stale 401 finish');
    await nextBrowserFrame(page);
    r.ok(
      'T1 请求在途时合法轮换到 T2，迟到的 T1 401 不会登出 T2',
      (await persistedToken(page)) === tokenARefreshed &&
        !page.url().includes('/login') &&
        (await mutateQueryClient(page, 'inspect', marker)) === true,
      page.url(),
    );
  } catch (error) {
    r.ok(
      'T1→T2 后迟到 T1 401 夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    inFlightRotation.release.resolve();
    preRotation401.release.resolve();
    delete state.refreshTokenBySource[tokenARotatedNear];
    state.delayedRefresh = null;
    state.delayedConnector401 = null;
  }

  const currentRotation401 = {
    sourceToken: tokenARefreshed,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    await replaceSessionThroughUi(page, state, tokenALong);
    const rotation = await runRenewProbe(page, tokenARefreshed);
    await page.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });
    state.delayedConnector401 = currentRotation401;
    await page.getByText('数据连接', { exact: true }).click();
    await withTimeout(currentRotation401.started.promise, 'current T2 request start');
    currentRotation401.release.resolve();
    await withTimeout(currentRotation401.finished.promise, 'current T2 401 finish');
    await page.waitForURL(/\/login/, { timeout: 5000 });
    await page.locator('#username').waitFor({ state: 'visible', timeout: 5000 });
    r.ok(
      '合法轮换后的当前 T2 请求收到 401 仍会强制登出',
      rotation.accepted === true && (await persistedToken(page)) == null,
    );
  } catch (error) {
    r.ok(
      '当前 T2 401 夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    currentRotation401.release.resolve();
    state.delayedConnector401 = null;
  }

  for (const status of [401, 403]) {
    const staleSse = {
      sourceToken: tokenALong,
      status,
      started: deferred(),
      release: deferred(),
      finished: deferred(),
    };
    try {
      await replaceSessionThroughUi(page, state, tokenALong);
      state.delayedSseAuth = staleSse;
      await page.evaluate(() => {
        void import('/src/api/sse.ts').then(({ streamSse }) => {
          void streamSse('/fixture/auth-sse', {}, { onError: () => undefined });
        });
      });
      await withTimeout(staleSse.started.promise, `A SSE ${status} request start`);

      await replaceSessionThroughUi(page, state, tokenB, 'member-b');
      const marker = `tenant-b-cache-survives-stale-sse-${status}`;
      await mutateQueryClient(page, 'seed', marker);
      staleSse.release.resolve();
      await withTimeout(staleSse.finished.promise, `A SSE ${status} finish`);
      await nextBrowserFrame(page);
      r.ok(
        `A 延迟 SSE 在 B 登录后返回 ${status} 不会登出 B 或清 B 缓存`,
        (await persistedToken(page)) === tokenB &&
          !page.url().includes('/login') &&
          (await mutateQueryClient(page, 'inspect', marker)) === true,
        page.url(),
      );
    } catch (error) {
      r.ok(
        `延迟 SSE ${status} 会话竞态夹具执行`,
        false,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      staleSse.release.resolve();
      state.delayedSseAuth = null;
    }
  }

  const currentSse401 = {
    sourceToken: tokenALong,
    status: 401,
    started: deferred(),
    release: deferred(),
    finished: deferred(),
  };
  try {
    await replaceSessionThroughUi(page, state, tokenALong);
    state.delayedSseAuth = currentSse401;
    await page.evaluate(() => {
      void import('/src/api/sse.ts').then(({ streamSse }) => {
        void streamSse('/fixture/auth-sse', {}, { onError: () => undefined });
      });
    });
    await withTimeout(currentSse401.started.promise, 'current SSE 401 request start');
    currentSse401.release.resolve();
    await withTimeout(currentSse401.finished.promise, 'current SSE 401 finish');
    await page.waitForURL(/\/login/, { timeout: 5000 });
    await page.locator('#username').waitFor({ state: 'visible', timeout: 5000 });
    r.ok('当前会话 SSE 401 仍会强制登出', (await persistedToken(page)) == null);
  } catch (error) {
    r.ok(
      '当前会话 SSE 401 夹具执行',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    currentSse401.release.resolve();
    state.delayedSseAuth = null;
  }

  await browser.close();

  return r.summary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const passed = await run();
  process.exit(passed ? 0 : 1);
}
