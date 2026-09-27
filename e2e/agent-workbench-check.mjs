// Agent 工作台 UI 实跑校验。
// 默认只读：会在浏览器里改动表单触发 dirty，但不会保存、发布或修改即时授权。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';
import { readFileSync } from 'node:fs';

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const FIXTURE_AGENT_ID = 'fixture-agent-1';

const okEnvelope = (data) => ({ success: true, respCode: '200', respMsg: 'ok', data });
const errorEnvelope = (message) => ({
  success: false,
  respCode: '5901',
  respMsg: message,
  data: null,
});

function checkConnectionMutationDefenseSource() {
  const source = readFileSync(
    new URL('../src/features/agent/components/AgentConnectionGrantPanel.tsx', import.meta.url),
    'utf8',
  );
  const grantStart = source.indexOf('const grantMut = useMutation');
  const revokeStart = source.indexOf('const revokeMut = useMutation');
  const mutationEnd = source.indexOf('// 权限查询失败时', revokeStart);
  const grantSource = source.slice(grantStart, revokeStart);
  const revokeSource = source.slice(revokeStart, mutationEnd);
  check(
    '静态：grant/revoke mutationFn 本体均有独立权限闸',
    grantStart >= 0 &&
      revokeStart > grantStart &&
      mutationEnd > revokeStart &&
      grantSource.includes('assertConnectionMutationAllowed();') &&
      grantSource.indexOf('assertConnectionMutationAllowed();') <
        grantSource.indexOf('agentApi.grantConnection') &&
      revokeSource.includes('assertConnectionMutationAllowed();') &&
      revokeSource.indexOf('assertConnectionMutationAllowed();') <
        revokeSource.indexOf('agentApi.revokeConnection'),
  );
}

function checkAgentCacheMaintenanceSource() {
  const source = readFileSync(
    new URL('../src/pages/console/agent/AgentListPage.tsx', import.meta.url),
    'utf8',
  );
  const detailInvalidations = source.match(/invalidateAgentDetail\(id\)/g) ?? [];
  check(
    '静态：发布和下架均精确失效对应 Agent 详情缓存',
    detailInvalidations.length >= 2 &&
      source.includes("queryKey: ['agent', 'detail', id]") &&
      source.includes('exact: true'),
  );
  check(
    '静态：删除仅移除对应 Agent 的详情、技能和连接缓存',
    source.includes('removeAgentCaches(id)') &&
      source.includes("queryKey: ['agent', 'detail', id]") &&
      source.includes("queryKey: ['agent', id, 'skills']") &&
      source.includes("queryKey: ['agent', id, 'connections']") &&
      (source.match(/removeQueries\(/g) ?? []).length >= 3,
  );
}

function fixtureAgent(overrides = {}) {
  return {
    id: FIXTURE_AGENT_ID,
    code: 'fixture-agent',
    name: '夹具 Agent',
    description: '仅用于浏览器路由夹具，不会写入后端',
    systemPrompt: '你是一个测试 Agent。',
    model: 'fixture-model',
    modelParams: JSON.stringify({ temperature: 0.7, topP: 1, maxTokens: 2048 }),
    kbConfig: JSON.stringify({ kbIds: ['kb-1'], topK: 5, scoreThreshold: 0.5, rerank: true }),
    presetQuestions: JSON.stringify(['预设问题一']),
    status: 'PUBLISHED',
    hasUnpublishedChanges: false,
    creatorName: 'E2E Fixture',
    updateTime: '2026-09-27 10:00:00',
    ...overrides,
  };
}

async function runFixtureSuite(ctx) {
  const fixturePage = await ctx.newPage();
  const state = {
    agent: fixtureAgent({ hasUnpublishedChanges: true }),
    agents: [
      fixtureAgent({ hasUnpublishedChanges: true }),
      fixtureAgent({
        id: 'fixture-agent-2',
        code: 'fixture-draft',
        name: '夹具草稿 Agent',
        status: 'DRAFT',
        kbConfig: JSON.stringify({ kbIds: [], topK: 5 }),
      }),
      fixtureAgent({
        id: 'fixture-agent-3',
        code: 'fixture-stable',
        name: '夹具稳定已发布 Agent',
        hasUnpublishedChanges: false,
        kbConfig: JSON.stringify({ kbIds: [], topK: 5 }),
      }),
    ],
    modes: {
      detail: 'success',
      models: 'success',
      skills: 'success',
      skillBindings: 'success',
      connectors: 'success',
      connectionBindings: 'success',
      permissions: 'success',
      knowledge: 'success',
      save: 'success',
      publish: 'success',
      skillMutation: 'success',
      connectionMutation: 'success',
      list: 'success',
    },
    delays: { list: 2000, save: 0, publish: 0, skillMutation: 0, connectionMutation: 0 },
    boundSkillIds: ['skill-1'],
    boundConnectionIds: ['connection-1'],
    counts: { models: 0, detail: 0, connectionWrites: 0 },
  };

  const errorText = {
    detail: '夹具错误：Agent 详情后台刷新失败',
    models: '夹具错误：模型目录后台刷新失败',
    skills: '夹具错误：技能目录后台刷新失败',
    skillBindings: '夹具错误：技能授权后台刷新失败',
    connectors: '夹具错误：连接目录后台刷新失败',
    connectionBindings: '夹具错误：连接授权后台刷新失败',
    permissions: '夹具错误：权限后台刷新失败',
    knowledge: '夹具错误：知识库后台刷新失败',
    save: '夹具错误：保存草稿失败',
    publish: '夹具错误：发布快照失败',
    skillMutation: '夹具错误：技能授权保存失败',
    connectionMutation: '夹具错误：连接授权保存失败',
    list: '夹具错误：Agent 列表首次加载失败',
  };
  const models = [
    {
      value: 'fixture-model',
      label: 'Fixture Model',
      provider: 'fixture',
      maxTemp: 2,
    },
  ];
  const skills = [
    {
      id: 'skill-1',
      name: '夹具技能一',
      description: '已授权技能',
      scope: 'TENANT',
      skillType: 'PROMPT',
      source: 'UPLOAD',
      status: 'ACTIVE',
      ownerUserId: 'fixture-user',
      version: 1,
    },
    {
      id: 'skill-2',
      name: '夹具技能二',
      description: '授权成功夹具',
      scope: 'TENANT',
      skillType: 'PROMPT',
      source: 'UPLOAD',
      status: 'ACTIVE',
      ownerUserId: 'fixture-user',
      version: 1,
    },
    {
      id: 'skill-3',
      name: '夹具技能三',
      description: '授权失败夹具',
      scope: 'TENANT',
      skillType: 'PROMPT',
      source: 'UPLOAD',
      status: 'ACTIVE',
      ownerUserId: 'fixture-user',
      version: 1,
    },
  ];
  const connectors = ['connection-1', 'connection-2', 'connection-3'].map((id, index) => ({
    id,
    name: `fixture_connection_${index + 1}`,
    displayName: `夹具连接${index + 1}`,
    kind: 'FIXTURE',
    kindLabel: '夹具数据库',
    params: {},
    status: 'ACTIVE',
    capabilities: ['QUERY', 'DESCRIBE'],
    healthState: 'HEALTHY',
    readonlyVerified: true,
    writePolicy: 'FORBIDDEN',
    writePolicyLabel: '只读',
    semanticStatus: 'READY',
    semanticCoverage: 'COMPLETE',
  }));

  const fulfill = (route, payload) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  const fail = (route, key) => fulfill(route, errorEnvelope(errorText[key]));
  const maybeFail = (route, key, data) =>
    state.modes[key] === 'error' ? fail(route, key) : fulfill(route, okEnvelope(data));
  const delay = async (key) => {
    if (state.delays[key]) await sleep(state.delays[key]);
  };

  await fixturePage.addInitScript(() => {
    const nativeNow = Date.now.bind(Date);
    window.__agentFixtureTimeOffset = 0;
    Date.now = () => nativeNow() + window.__agentFixtureTimeOffset;
  });
  const fixtureRouteHandler = async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method === 'GET' && path === '/data/admin/auth/me') {
      return fulfill(
        route,
        okEnvelope({
          id: 'fixture-user',
          tenantId: 'fixture-tenant',
          username: 'fixture',
          displayName: 'Fixture Admin',
          userType: 'SUPER_ADMIN',
        }),
      );
    }
    if (method === 'GET' && path === '/data/admin/me/permissions') {
      return maybeFail(route, 'permissions', {
        superAdmin: true,
        userType: 'SUPER_ADMIN',
        modules: ['AGENT', 'CONNECTOR'],
        agentIds: [],
        knowledgeBaseIds: [],
      });
    }
    if (method === 'GET' && path === '/data/admin/agent/agents') {
      await delay('list');
      return maybeFail(route, 'list', state.agents);
    }
    if (method === 'GET' && path === `/data/admin/agent/agents/${FIXTURE_AGENT_ID}`) {
      state.counts.detail += 1;
      return maybeFail(route, 'detail', state.agent);
    }
    if (method === 'PUT' && path === `/data/admin/agent/agents/${FIXTURE_AGENT_ID}`) {
      await delay('save');
      if (state.modes.save === 'error') return fail(route, 'save');
      const body = request.postDataJSON();
      state.agent = { ...state.agent, ...body, hasUnpublishedChanges: true };
      state.agents[0] = state.agent;
      return fulfill(route, okEnvelope(state.agent));
    }
    if (method === 'POST' && path.match(/^\/data\/admin\/agent\/agents\/[^/]+\/publish$/)) {
      await delay('publish');
      if (state.modes.publish === 'error') return fail(route, 'publish');
      const id = path.split('/').at(-2);
      state.agents = state.agents.map((agent) =>
        agent.id === id ? { ...agent, status: 'PUBLISHED', hasUnpublishedChanges: false } : agent,
      );
      if (id === FIXTURE_AGENT_ID) state.agent = { ...state.agent, ...state.agents[0] };
      return fulfill(route, okEnvelope(state.agents.find((agent) => agent.id === id)));
    }
    if (method === 'POST' && path.match(/^\/data\/admin\/agent\/agents\/[^/]+\/unpublish$/)) {
      const id = path.split('/').at(-2);
      state.agents = state.agents.map((agent) =>
        agent.id === id ? { ...agent, status: 'DRAFT', hasUnpublishedChanges: false } : agent,
      );
      if (id === FIXTURE_AGENT_ID) state.agent = { ...state.agent, status: 'DRAFT' };
      return fulfill(route, okEnvelope(state.agents.find((agent) => agent.id === id)));
    }
    if (method === 'DELETE' && path.match(/^\/data\/admin\/agent\/agents\/[^/]+$/)) {
      const id = path.split('/').at(-1);
      state.agents = state.agents.filter((agent) => agent.id !== id);
      return fulfill(route, okEnvelope(null));
    }
    if (method === 'GET' && path === '/data/admin/models') {
      state.counts.models += 1;
      return maybeFail(route, 'models', models);
    }
    if (method === 'GET' && path === '/data/tenant/skills') {
      return maybeFail(route, 'skills', skills);
    }
    if (path === `/data/admin/agent/agents/${FIXTURE_AGENT_ID}/skills` && method === 'GET') {
      return maybeFail(
        route,
        'skillBindings',
        state.boundSkillIds.map((skillId, index) => ({
          id: `skill-binding-${index}`,
          agentId: FIXTURE_AGENT_ID,
          skillId,
        })),
      );
    }
    if (path === `/data/admin/agent/agents/${FIXTURE_AGENT_ID}/skills` && method === 'POST') {
      await delay('skillMutation');
      if (state.modes.skillMutation === 'error') return fail(route, 'skillMutation');
      const { skillId } = request.postDataJSON();
      if (!state.boundSkillIds.includes(skillId)) state.boundSkillIds.push(skillId);
      return fulfill(route, okEnvelope(null));
    }
    if (
      method === 'DELETE' &&
      path.startsWith(`/data/admin/agent/agents/${FIXTURE_AGENT_ID}/skills/`)
    ) {
      await delay('skillMutation');
      if (state.modes.skillMutation === 'error') return fail(route, 'skillMutation');
      const skillId = path.split('/').at(-1);
      state.boundSkillIds = state.boundSkillIds.filter((id) => id !== skillId);
      return fulfill(route, okEnvelope(null));
    }
    if (method === 'GET' && path === '/data/admin/connectors') {
      return maybeFail(route, 'connectors', connectors);
    }
    if (path === `/data/admin/agent/agents/${FIXTURE_AGENT_ID}/connections` && method === 'GET') {
      return maybeFail(
        route,
        'connectionBindings',
        state.boundConnectionIds.map((connectionId, index) => ({
          id: `connection-binding-${index}`,
          agentId: FIXTURE_AGENT_ID,
          connectionId,
        })),
      );
    }
    if (
      path === `/data/admin/agent/agents/${FIXTURE_AGENT_ID}/connections` &&
      method === 'POST'
    ) {
      state.counts.connectionWrites += 1;
      await delay('connectionMutation');
      if (state.modes.connectionMutation === 'error') return fail(route, 'connectionMutation');
      const { connectionId } = request.postDataJSON();
      if (!state.boundConnectionIds.includes(connectionId)) state.boundConnectionIds.push(connectionId);
      return fulfill(route, okEnvelope(null));
    }
    if (
      method === 'DELETE' &&
      path.startsWith(`/data/admin/agent/agents/${FIXTURE_AGENT_ID}/connections/`)
    ) {
      state.counts.connectionWrites += 1;
      await delay('connectionMutation');
      if (state.modes.connectionMutation === 'error') return fail(route, 'connectionMutation');
      const connectionId = path.split('/').at(-1);
      state.boundConnectionIds = state.boundConnectionIds.filter((id) => id !== connectionId);
      return fulfill(route, okEnvelope(null));
    }
    if (method === 'GET' && path === '/data/rag/kb') {
      return maybeFail(route, 'knowledge', [
        { id: 'kb-1', name: '夹具知识库一' },
        { id: 'kb-2', name: '夹具知识库二' },
      ]);
    }

    return fulfill(route, okEnvelope([]));
  };
  await fixturePage.route('**/data/**', fixtureRouteHandler);

  try {
    await fixturePage.setViewportSize({ width: 1280, height: 850 });
    const fixtureNavigation = fixturePage.goto(`${BASE}/console/agents`, {
      waitUntil: 'domcontentloaded',
    });
    const skeletonVisible = await fixturePage
      .locator('.agent-card-skeleton')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    await fixtureNavigation;
    check('夹具：列表慢请求显示 Skeleton', skeletonVisible);
    await fixturePage.locator('[data-testid="agent-card"]').first().waitFor({ timeout: 5000 });
    state.delays.list = 0;

    const fixtureFilter = fixturePage.getByLabel('筛选 Agent 状态');
    await fixtureFilter.getByText('草稿', { exact: true }).click();
    const fixtureDraftIds = await fixturePage
      .locator('[data-testid="agent-card"]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-agent-id')));
    check(
      '夹具：草稿筛选精确命中草稿且排除全部非目标',
      JSON.stringify(fixtureDraftIds) === JSON.stringify(['fixture-agent-2']),
      JSON.stringify(fixtureDraftIds),
    );
    await fixtureFilter.getByText('待发布', { exact: true }).click();
    const fixturePendingIds = await fixturePage
      .locator('[data-testid="agent-card"]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-agent-id')));
    check(
      '夹具：待发布筛选精确命中有更新 Agent 且排除稳定已发布',
      JSON.stringify(fixturePendingIds) === JSON.stringify([FIXTURE_AGENT_ID]),
      JSON.stringify(fixturePendingIds),
    );
    await fixtureFilter.getByText('全部', { exact: true }).click();
    check(
      '夹具：全部筛选恢复草稿、待发布和稳定已发布三类',
      (await fixturePage.locator('[data-testid="agent-card"]').count()) === 3,
    );

    check(
      '夹具：1280px 列表无页面级横向滚动',
      await fixturePage.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    await fixturePage.emulateMedia({ reducedMotion: 'reduce' });
    const reducedTransition = await fixturePage
      .locator('.agent-entity-card')
      .first()
      .evaluate((node) => getComputedStyle(node).transitionDuration);
    check('夹具：reduced-motion 关闭卡片动画', reducedTransition === '0s', reducedTransition);
    await fixturePage.emulateMedia({ reducedMotion: 'no-preference' });

    const draftCard = fixturePage.locator('[data-testid="agent-card"][data-agent-id="fixture-agent-2"]');
    await draftCard.locator('[data-testid="agent-more-actions"]').click();
    await fixturePage.locator('.ant-dropdown:visible').getByText('发布', { exact: true }).click();
    state.delays.publish = 550;
    const publishDialog = fixturePage.locator('.ant-modal-confirm:visible');
    await publishDialog.locator('.ant-btn-primary').click();
    await sleep(80);
    check('夹具：单卡 mutation 只锁定目标卡', (await draftCard.getAttribute('aria-busy')) === 'true');
    check(
      '夹具：单卡 mutation 不锁定其它卡',
      (await fixturePage
        .locator(`[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`)
        .getAttribute('aria-busy')) !== 'true',
    );
    await fixturePage.waitForFunction(
      () => document.querySelector('[data-testid="agent-card"][data-agent-id="fixture-agent-2"]')?.getAttribute('aria-busy') !== 'true',
    );
    state.delays.publish = 0;

    const firstCard = fixturePage.locator(
      `[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`,
    );
    await firstCard.locator('[data-testid="agent-more-actions"]').click();
    await fixturePage.locator('.ant-dropdown:visible').getByText('删除', { exact: true }).click();
    const deleteDialog = fixturePage.locator('.ant-modal:visible').filter({ hasText: '此操作不可恢复' });
    check('夹具：危险删除显示不可恢复确认', await deleteDialog.isVisible().catch(() => false));
    await deleteDialog.locator('.ant-modal-confirm-btns .ant-btn').first().click();

    const primary = firstCard.locator('[data-testid="agent-primary-action"]');
    await primary.focus();
    await fixturePage.keyboard.press('Enter');
    await fixturePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    await fixturePage.locator('[data-testid="agent-editor-header"]').waitFor();
    check('夹具：键盘 Enter 可进入 Agent 编辑器', true);
    check(
      '夹具：1280px 编辑器无页面级横向滚动',
      await fixturePage.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );

    const presetDelete = fixturePage.getByLabel('删除第 1 个预设问题');
    await presetDelete.hover();
    await fixturePage
      .locator('.ant-tooltip:visible')
      .getByText('删除预设问题', { exact: true })
      .waitFor({ timeout: 2000 })
      .catch(() => {});
    check(
      '夹具：预设问题纯图标删除按钮有 Tooltip',
      await fixturePage
        .locator('.ant-tooltip:visible')
        .getByText('删除预设问题', { exact: true })
        .isVisible()
        .catch(() => false),
    );

    const nameInput = fixturePage.getByLabel('名称', { exact: true });
    const descriptionInput = fixturePage.getByLabel('描述', { exact: true });
    await nameInput.fill('夹具 Agent 已保存');
    state.modes.detail = 'error';
    state.delays.save = 500;
    await fixturePage.getByLabel('保存 Agent 草稿').click();
    await sleep(80);
    check(
      '夹具：保存请求 pending 时按钮显示 loading',
      await fixturePage.getByLabel('保存 Agent 草稿').evaluate((button) =>
        button.classList.contains('ant-btn-loading'),
      ),
    );
    await descriptionInput.fill('保存请求发出后的新修改');
    await fixturePage
      .getByText('草稿已保存，但保存期间有新修改尚未保存', { exact: true })
      .waitFor({ timeout: 4000 })
      .catch(() => {});
    await fixturePage.waitForFunction(
      () => !document.querySelector('[aria-label="保存 Agent 草稿"]')?.classList.contains('ant-btn-loading'),
    );
    state.delays.save = 0;
    check(
      '夹具：保存期间继续编辑不会被旧响应清除 dirty',
      (await fixturePage.getByText('有未保存变更').count()) > 0 &&
        (await descriptionInput.inputValue()) === '保存请求发出后的新修改' &&
        (await fixturePage
          .getByText('草稿已保存，但保存期间有新修改尚未保存', { exact: true })
          .count()) > 0,
    );
    await fixturePage.getByLabel('返回 Agents').click();
    await sleep(120);
    const saveRaceDialog = fixturePage
      .locator('.ant-modal:visible')
      .filter({ hasText: /离开.*未保存|正在保存/ });
    const saveRaceBlocked = (await saveRaceDialog.count()) === 1;
    check('夹具：保存响应后仍有新修改时离开继续受阻', saveRaceBlocked);
    if (saveRaceBlocked) {
      await saveRaceDialog.locator('.ant-modal-confirm-btns .ant-btn').first().click();
    } else {
      await fixturePage.waitForURL(/\/console\/agents$/);
      await fixturePage
        .locator(`[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`)
        .locator('[data-testid="agent-primary-action"]')
        .click();
      await fixturePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    }
    await fixturePage.getByText(errorText.detail, { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
    check(
      '夹具：详情后台刷新失败保留内容并显示真实原因',
      (await nameInput.inputValue()) === '夹具 Agent 已保存' &&
        (await fixturePage.getByText(errorText.detail, { exact: true }).count()) > 0,
    );
    state.modes.detail = 'success';
    await fixturePage.getByLabel('重试刷新 Agent 详情').click();
    await fixturePage.getByText(errorText.detail, { exact: true }).waitFor({ state: 'detached' }).catch(() => {});
    check(
      '夹具：详情后台刷新失败可显式重试恢复',
      (await fixturePage.getByLabel('重试刷新 Agent 详情').count()) === 0,
    );

    await descriptionInput.fill('触发保存失败');
    state.modes.save = 'error';
    await fixturePage.getByLabel('保存 Agent 草稿').click();
    await fixturePage.getByText(errorText.save, { exact: true }).waitFor({ timeout: 3000 }).catch(() => {});
    check(
      '夹具：保存失败显示真实原因且保留 dirty',
      (await fixturePage.getByText(errorText.save, { exact: true }).count()) > 0 &&
        (await fixturePage.getByText('有未保存变更').count()) > 0,
    );

    state.modes.save = 'success';
    await fixturePage.getByLabel('返回 Agents').click();
    const discardAfterFailedSave = fixturePage
      .locator('.ant-modal:visible')
      .filter({ hasText: /离开并放弃未保存的变更|Agent 正在保存/ });
    await discardAfterFailedSave.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
    await fixturePage.waitForURL(/\/console\/agents$/);
    await fixturePage
      .locator(`[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`)
      .locator('[data-testid="agent-primary-action"]')
      .click();
    await fixturePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    check('夹具：放弃失败保存后的本地编辑可恢复 clean', (await fixturePage.getByText('有未保存变更').count()) === 0);

    state.modes.publish = 'success';
    state.delays.publish = 500;
    await fixturePage.getByLabel('保存并发布 Agent').click();
    await sleep(80);
    check(
      '夹具：发布请求 pending 时按钮显示 loading',
      await fixturePage.getByLabel('保存并发布 Agent').evaluate((button) =>
        button.classList.contains('ant-btn-loading'),
      ),
    );
    const publishBeforeUnload = await fixturePage.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      const dispatched = window.dispatchEvent(event);
      return { dispatched, defaultPrevented: event.defaultPrevented };
    });
    check(
      '夹具：无 dirty 的发布 pending 仍安装 beforeunload 保护',
      publishBeforeUnload.defaultPrevented && !publishBeforeUnload.dispatched,
    );
    await fixturePage.getByLabel('返回 Agents').click();
    await sleep(120);
    const publishBusyDialog = fixturePage
      .locator('.ant-modal:visible')
      .filter({ hasText: 'Agent 正在发布，确定离开？' });
    const publishBusyBlocked = (await publishBusyDialog.count()) === 1;
    check('夹具：无 dirty 的发布 pending 仍阻止路由离开', publishBusyBlocked);
    if (publishBusyBlocked) {
      await publishBusyDialog.locator('.ant-modal-confirm-btns .ant-btn').first().click();
    }
    await fixturePage.getByText('已发布（对话端已更新为当前内容）').waitFor({ timeout: 4000 });
    if (fixturePage.url().endsWith('/console/agents')) {
      await fixturePage
        .locator(`[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`)
        .locator('[data-testid="agent-primary-action"]')
        .click();
      await fixturePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    }
    check('夹具：发布成功清除 dirty', (await fixturePage.getByText('有未保存变更').count()) === 0);

    await descriptionInput.fill('发布失败但草稿已保存');
    state.modes.publish = 'error';
    state.delays.publish = 500;
    await fixturePage.getByLabel('保存并发布 Agent').click();
    await sleep(80);
    await descriptionInput.fill('发布请求发出后的新修改');
    await fixturePage
      .getByText(new RegExp(`草稿已保存，但发布失败：${errorText.publish}`))
      .waitFor({ timeout: 4000 })
      .catch(() => {});
    check(
      '夹具：草稿保存成功但发布失败时不会清除期间的新修改',
      (await fixturePage.getByText(new RegExp(`草稿已保存，但发布失败：${errorText.publish}`)).count()) >
        0 &&
        (await fixturePage.getByText(/有新修改未保存/).count()) > 0 &&
        (await fixturePage.getByText('有未保存变更').count()) > 0 &&
        (await descriptionInput.inputValue()) === '发布请求发出后的新修改',
    );
    state.delays.publish = 0;
    state.modes.publish = 'success';
    await fixturePage.getByLabel('返回 Agents').click();
    await sleep(120);
    const discardAfterPublishRace = fixturePage
      .locator('.ant-modal:visible')
      .filter({ hasText: '离开并放弃未保存的变更？' });
    if ((await discardAfterPublishRace.count()) === 1) {
      await discardAfterPublishRace.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
    }
    await fixturePage.waitForURL(/\/console\/agents$/);
    await fixturePage
      .locator(`[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`)
      .locator('[data-testid="agent-primary-action"]')
      .click();
    await fixturePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));

    state.modes.models = 'error';
    await fixturePage.evaluate(() => {
      window.__agentFixtureTimeOffset += 6 * 60 * 1000;
    });
    await fixturePage.getByLabel('返回 Agents').click();
    await fixturePage.waitForURL(/\/console\/agents$/);
    const returnCard = fixturePage.locator(
      `[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`,
    );
    await returnCard.locator('[data-testid="agent-primary-action"]').click();
    await fixturePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    await fixturePage.getByRole('button', { name: '模型参数', exact: true }).click();
    await fixturePage
      .locator('.ant-alert')
      .filter({ hasText: errorText.models })
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const modelAlertTexts = await fixturePage.locator('.ant-alert').allTextContents();
    check(
      '夹具：模型目录缓存刷新失败保留选项并显示原因',
      modelAlertTexts.some((text) => text.includes(errorText.models)) &&
        (await fixturePage
          .locator('[data-testid="agent-editor-section-model"] .ant-select-selection-item')
          .filter({ hasText: 'Fixture Model' })
          .count()) === 1,
      `模型请求数=${state.counts.models} alerts=${JSON.stringify(modelAlertTexts)}`,
    );
    state.modes.models = 'success';
    await fixturePage.getByLabel('重试刷新模型目录').click();
    await fixturePage
      .getByLabel('重试刷新模型目录')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    check(
      '夹具：模型目录后台刷新失败可显式重试恢复',
      (await fixturePage.getByLabel('重试刷新模型目录').count()) === 0,
    );

    const nav = fixturePage.locator('[data-testid="agent-editor-nav"]');
    await nav.getByRole('button', { name: '技能', exact: true }).click();
    const skillPanel = fixturePage.locator('[data-testid="agent-skill-bind-panel"]');
    await skillPanel.waitFor();
    state.delays.skillMutation = 500;
    const selectTransferItem = async (title) => {
      const row = skillPanel.locator('.ant-transfer-list-content-item').filter({ hasText: title });
      await row.getByRole('checkbox').check();
      return row;
    };
    await selectTransferItem('夹具技能二');
    await skillPanel.locator('.ant-transfer-operation .ant-btn').first().click();
    await sleep(80);
    check('夹具：技能 mutation 显示逐项 pending', await skillPanel.getByText('保存中').isVisible());
    await skillPanel.getByText('已生效', { exact: true }).waitFor({ timeout: 4000 });
    check('夹具：技能 mutation 显示逐项成功', true);
    state.modes.skillMutation = 'error';
    state.delays.skillMutation = 0;
    await selectTransferItem('夹具技能三');
    await skillPanel.locator('.ant-transfer-operation .ant-btn').first().click();
    await skillPanel.getByText('保存失败', { exact: true }).waitFor({ timeout: 3000 });
    check(
      '夹具：技能 mutation 显示逐项失败和真实原因',
      (await skillPanel.getByText('保存失败', { exact: true }).count()) > 0 &&
        (await fixturePage.getByText(errorText.skillMutation, { exact: true }).count()) > 0,
    );

    state.modes.skills = 'error';
    state.modes.skillBindings = 'error';
    await fixturePage.evaluate(() => {
      window.__agentFixtureTimeOffset += 40 * 1000;
    });
    await nav.getByRole('button', { name: '基础信息', exact: true }).click();
    await nav.getByRole('button', { name: '技能', exact: true }).click();
    await fixturePage.getByText(errorText.skills, { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
    check(
      '夹具：技能缓存刷新失败保留 Transfer 并显示真实原因',
      (await fixturePage.getByText(errorText.skills, { exact: true }).count()) > 0 &&
        (await fixturePage.getByText('夹具技能一', { exact: true }).count()) > 0,
    );
    state.modes.skills = 'success';
    state.modes.skillBindings = 'success';
    await fixturePage.getByLabel('重试刷新技能授权').click();
    await fixturePage
      .getByLabel('重试刷新技能授权')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    check(
      '夹具：技能缓存刷新失败可显式重试恢复',
      (await fixturePage.getByLabel('重试刷新技能授权').count()) === 0,
    );

    await nav.getByRole('button', { name: '数据连接', exact: true }).click();
    const connectionPanel = fixturePage.locator('[data-testid="agent-connection-grant-panel"]');
    await connectionPanel.waitFor();
    state.modes.connectionMutation = 'success';
    state.delays.connectionMutation = 500;
    const grantTwo = connectionPanel.getByLabel('授权 夹具连接2');
    await grantTwo.click();
    await sleep(80);
    check('夹具：连接 mutation 显示逐项 pending', await connectionPanel.getByText('保存中…').isVisible());
    await connectionPanel.getByText('已生效').waitFor({ timeout: 4000 });
    check('夹具：连接 mutation 显示逐项成功', true);
    state.modes.connectionMutation = 'error';
    state.delays.connectionMutation = 0;
    await connectionPanel.getByLabel('授权 夹具连接3').click();
    await connectionPanel.getByText(new RegExp(errorText.connectionMutation)).waitFor({ timeout: 3000 });
    check('夹具：连接 mutation 显示逐项失败和真实原因', true);

    state.modes.permissions = 'error';
    state.modes.connectors = 'error';
    state.modes.connectionBindings = 'error';
    await fixturePage.evaluate(() => {
      window.__agentFixtureTimeOffset += 70 * 1000;
    });
    await nav.getByRole('button', { name: '基础信息', exact: true }).click();
    await nav.getByRole('button', { name: '数据连接', exact: true }).click();
    await fixturePage.getByText(errorText.permissions, { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
    const staleGrant = fixturePage.getByLabel('授权 夹具连接3');
    check(
      '夹具：权限缓存刷新失败 fail-closed 并显示真实原因',
      (await fixturePage.getByText(errorText.permissions, { exact: true }).count()) > 0 &&
        (await staleGrant.isDisabled().catch(() => false)),
    );
    check(
      '夹具：连接缓存刷新失败保留卡片并显示真实原因',
      (await fixturePage.getByText(errorText.connectors, { exact: true }).count()) > 0 &&
        (await fixturePage.getByText('夹具连接1', { exact: true }).count()) > 0,
    );
    const writesBeforeDeniedClick = state.counts.connectionWrites;
    await staleGrant.evaluate((button) => {
      button.removeAttribute('disabled');
      button.click();
    });
    await sleep(100);
    check(
      '行为：权限查询失败时强制触发 UI 路径也不发连接写请求',
      state.counts.connectionWrites === writesBeforeDeniedClick,
      `writes=${state.counts.connectionWrites}`,
    );
    state.modes.permissions = 'success';
    state.modes.connectors = 'success';
    state.modes.connectionBindings = 'success';
    await fixturePage.getByLabel('重试加载授权修改权限').click();
    await fixturePage.getByLabel('重试刷新连接授权').click();
    await fixturePage
      .getByLabel('重试刷新连接授权')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    await fixturePage
      .getByLabel('重试加载授权修改权限')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    check(
      '夹具：连接与权限后台刷新失败可显式重试恢复',
      (await fixturePage.getByLabel('重试刷新连接授权').count()) === 0 &&
        (await fixturePage.getByLabel('重试加载授权修改权限').count()) === 0 &&
        !(await staleGrant.isDisabled()),
    );

    await nav.getByRole('button', { name: '知识库', exact: true }).click();
    const topK = fixturePage.getByLabel('知识库召回数量 TopK');
    await topK.fill('6');
    check('夹具：知识库受控修改进入 dirty', (await fixturePage.getByText('有未保存变更').count()) > 0);
    const beforeUnload = await fixturePage.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      const dispatched = window.dispatchEvent(event);
      return { dispatched, defaultPrevented: event.defaultPrevented };
    });
    check(
      '夹具：知识库 dirty 安装 beforeunload 保护',
      beforeUnload.defaultPrevented && !beforeUnload.dispatched,
    );

    state.modes.knowledge = 'error';
    await fixturePage.evaluate(() => {
      window.__agentFixtureTimeOffset += 40 * 1000;
    });
    await nav.getByRole('button', { name: '基础信息', exact: true }).click();
    await nav.getByRole('button', { name: '知识库', exact: true }).click();
    await fixturePage.getByText(errorText.knowledge, { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
    check(
      '夹具：知识库缓存刷新失败保留旧值并显示真实原因',
      (await fixturePage.getByText(errorText.knowledge, { exact: true }).count()) > 0 &&
        (await fixturePage.getByLabel('知识库召回数量 TopK').inputValue()) === '6',
    );
    state.modes.knowledge = 'success';
    await fixturePage.getByLabel('重试刷新知识库').click();
    await fixturePage
      .getByLabel('重试刷新知识库')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    check(
      '夹具：知识库缓存刷新失败可显式重试恢复',
      (await fixturePage.getByLabel('重试刷新知识库').count()) === 0,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    check('路由夹具脚本执行', false, detail);
    await fixturePage.screenshot({ path: shot('agent-workbench-fixture-error.png') }).catch(() => {});
  } finally {
    await fixturePage.close();
  }

  const initialPage = await ctx.newPage();
  await initialPage.route('**/data/**', fixtureRouteHandler);
  try {
    state.delays.list = 0;
    state.modes.list = 'error';
    await initialPage.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });
    await initialPage.getByText(errorText.list, { exact: true }).waitFor({ timeout: 5000 });
    check(
      '夹具：Agent 列表首次加载失败显示真实原因且不伪装为空',
      (await initialPage.getByText('Agent 加载失败', { exact: true }).count()) === 1 &&
        (await initialPage.getByText(errorText.list, { exact: true }).count()) === 1 &&
        (await initialPage.getByText('还没有 Agent，可以从 AI 对话生成或空白配置开始').count()) ===
          0,
    );
    state.modes.list = 'success';
    await initialPage.getByLabel('重试加载 Agent').click();
    await initialPage.locator('[data-testid="agent-card"]').first().waitFor({ timeout: 4000 });
    check('夹具：Agent 列表首次加载失败可重试恢复', true);
  } catch (error) {
    check('首次列表错误夹具执行', false, error instanceof Error ? error.message : String(error));
  } finally {
    await initialPage.close();
  }

  const initialEditorPage = await ctx.newPage();
  await initialEditorPage.route('**/data/**', fixtureRouteHandler);
  try {
    state.modes.detail = 'error';
    state.modes.skills = 'success';
    state.modes.skillBindings = 'success';
    state.modes.connectors = 'success';
    state.modes.connectionBindings = 'success';
    state.modes.permissions = 'success';
    state.modes.knowledge = 'success';
    await initialEditorPage.goto(`${BASE}/console/agents/${FIXTURE_AGENT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await initialEditorPage.getByText(errorText.detail, { exact: true }).waitFor({ timeout: 5000 });
    check(
      '夹具：Agent 详情首次加载失败显示真实原因且不伪装不存在',
      (await initialEditorPage.getByText('Agent 加载失败', { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText(errorText.detail, { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText('Agent 不存在', { exact: true }).count()) === 0,
    );
    state.modes.detail = 'success';
    await initialEditorPage.getByLabel('重试加载 Agent 详情').click();
    await initialEditorPage.locator('[data-testid="agent-editor-workbench"]').waitFor();
    check('夹具：Agent 详情首次加载失败可重试恢复', true);

    const initialNav = initialEditorPage.locator('[data-testid="agent-editor-nav"]');
    state.modes.skills = 'error';
    await initialNav.getByRole('button', { name: '技能', exact: true }).click();
    await initialEditorPage.getByText(errorText.skills, { exact: true }).waitFor({ timeout: 5000 });
    check(
      '夹具：技能面板首次加载失败显示真实原因且不伪装为空',
      (await initialEditorPage.getByText('可用技能加载失败', { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText(errorText.skills, { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText('尚未在本页修改技能授权。').count()) === 0,
    );
    state.modes.skills = 'success';
    await initialEditorPage.getByLabel('重试加载技能').click();
    await initialEditorPage.locator('[data-testid="agent-skill-bind-panel"]').waitFor();
    check('夹具：技能面板首次加载失败可重试恢复', true);

    state.modes.connectors = 'error';
    await initialNav.getByRole('button', { name: '数据连接', exact: true }).click();
    await initialEditorPage
      .getByText(errorText.connectors, { exact: true })
      .waitFor({ timeout: 5000 });
    check(
      '夹具：连接面板首次加载失败显示真实原因且不伪装为空',
      (await initialEditorPage.getByText('无法读取企业数据连接', { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText(errorText.connectors, { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText('没有其它可授权连接').count()) === 0,
    );
    state.modes.connectors = 'success';
    await initialEditorPage.getByLabel('重试加载企业数据连接').click();
    await initialEditorPage.locator('[data-testid="agent-connection-grant-panel"]').waitFor();
    check('夹具：连接面板首次加载失败可重试恢复', true);

    state.modes.knowledge = 'error';
    await initialNav.getByRole('button', { name: '知识库', exact: true }).click();
    await initialEditorPage
      .getByText(errorText.knowledge, { exact: true })
      .waitFor({ timeout: 5000 });
    check(
      '夹具：知识库面板首次加载失败显示真实原因且不伪装为空',
      (await initialEditorPage.getByText('知识库列表加载失败', { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByText(errorText.knowledge, { exact: true }).count()) === 1 &&
        (await initialEditorPage.getByLabel('关联知识库').count()) === 0,
    );
    state.modes.knowledge = 'success';
    await initialEditorPage.getByLabel('重试加载知识库').click();
    await initialEditorPage.locator('[data-testid="agent-knowledge-bind-panel"]').waitFor();
    check('夹具：知识库面板首次加载失败可重试恢复', true);
  } catch (error) {
    check('首次编辑器错误夹具执行', false, error instanceof Error ? error.message : String(error));
  } finally {
    await initialEditorPage.close();
  }

  const cachePage = await ctx.newPage();
  await cachePage.route('**/data/**', fixtureRouteHandler);
  try {
    state.modes.list = 'success';
    state.modes.detail = 'success';
    state.agent = fixtureAgent({ status: 'PUBLISHED', hasUnpublishedChanges: false });
    state.agents = [
      state.agent,
      fixtureAgent({
        id: 'fixture-agent-2',
        code: 'fixture-draft',
        name: '夹具草稿 Agent',
        status: 'DRAFT',
      }),
      fixtureAgent({
        id: 'fixture-agent-3',
        code: 'fixture-stable',
        name: '夹具稳定已发布 Agent',
      }),
    ];
    state.counts.detail = 0;
    await cachePage.goto(`${BASE}/console/agents/${FIXTURE_AGENT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await cachePage.locator('[data-testid="agent-editor-workbench"]').waitFor();
    const initialDetailReads = state.counts.detail;
    await cachePage.getByLabel('返回 Agents').click();
    await cachePage.waitForURL(/\/console\/agents$/);

    const cacheCard = cachePage.locator(
      `[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"]`,
    );
    await cacheCard.locator('[data-testid="agent-more-actions"]').click();
    await cachePage.locator('.ant-dropdown:visible').getByText('下架', { exact: true }).click();
    await cachePage.locator('.ant-modal-confirm:visible .ant-btn-primary').click();
    await cachePage
      .locator(
        `[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"] [data-agent-status="DRAFT"]`,
      )
      .waitFor({ timeout: 4000 });
    await cacheCard.locator('[data-testid="agent-primary-action"]').click();
    await cachePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    await sleep(150);
    check(
      '行为：列表下架后重新进入会重新读取对应 Agent 详情',
      state.counts.detail === initialDetailReads + 1,
      `detailReads=${state.counts.detail}`,
    );

    await cachePage.getByLabel('返回 Agents').click();
    await cachePage.waitForURL(/\/console\/agents$/);
    const beforePublishReads = state.counts.detail;
    await cacheCard.locator('[data-testid="agent-more-actions"]').click();
    await cachePage.locator('.ant-dropdown:visible').getByText('发布', { exact: true }).click();
    await cachePage.locator('.ant-modal-confirm:visible .ant-btn-primary').click();
    await cachePage
      .locator(
        `[data-testid="agent-card"][data-agent-id="${FIXTURE_AGENT_ID}"] [data-agent-status="PUBLISHED"]`,
      )
      .waitFor({ timeout: 4000 });
    await cacheCard.locator('[data-testid="agent-primary-action"]').click();
    await cachePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    await sleep(150);
    check(
      '行为：列表发布后重新进入会重新读取对应 Agent 详情',
      state.counts.detail === beforePublishReads + 1,
      `detailReads=${state.counts.detail}`,
    );

    await cachePage.getByLabel('返回 Agents').click();
    await cachePage.waitForURL(/\/console\/agents$/);
    const beforeDeleteReads = state.counts.detail;
    await cacheCard.locator('[data-testid="agent-more-actions"]').click();
    await cachePage.locator('.ant-dropdown:visible').getByText('删除', { exact: true }).click();
    await cachePage.locator('.ant-modal-confirm:visible .ant-btn-primary').click();
    await cacheCard.waitFor({ state: 'detached', timeout: 4000 });
    state.agents = [state.agent, ...state.agents];
    await cachePage.goBack();
    await cachePage.waitForURL(new RegExp(`/console/agents/${FIXTURE_AGENT_ID}$`));
    await cachePage.locator('[data-testid="agent-editor-workbench"]').waitFor();
    check(
      '行为：删除后返回旧编辑路由会重新读取而非复用已删详情缓存',
      state.counts.detail === beforeDeleteReads + 1,
      `detailReads=${state.counts.detail}`,
    );
  } catch (error) {
    check('Agent 精确缓存夹具执行', false, error instanceof Error ? error.message : String(error));
  } finally {
    await cachePage.close();
  }
}

const { browser, ctx, page } = await launchBrowser();

try {
  checkConnectionMutationDefenseSource();
  checkAgentCacheMaintenanceSource();
  await login(page);
  await page.goto(`${BASE}/console/agents`, { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  await page.screenshot({ path: shot('agent-workbench-list.png') });

  const cards = page.locator('[data-testid="agent-card"]');
  const cardCount = await cards.count();
  check('Agent 使用实体卡片渲染', cardCount > 0, `卡片数=${cardCount}`);
  check(
    '搜索框有稳定语义选择器',
    await page
      .getByLabel('搜索 Agent')
      .isVisible()
      .catch(() => false),
  );
  check(
    '状态筛选器有稳定语义选择器',
    await page
      .getByLabel('筛选 Agent 状态')
      .isVisible()
      .catch(() => false),
  );
  check(
    '列表摘要同时显示总数、已发布和待发布',
    (await page.locator('[data-testid="agent-summary-total"]').count()) === 1 &&
      (await page.locator('[data-testid="agent-summary-published"]').count()) === 1 &&
      (await page.locator('[data-testid="agent-summary-pending"]').count()) === 1,
  );

  if (cardCount > 0) {
    const filter = page.getByLabel('筛选 Agent 状态');
    await filter.getByText('草稿', { exact: true }).click();
    await sleep(180);
    const draftStatuses = await cards
      .locator('[data-testid="agent-publish-status"]')
      .evaluateAll((tags) => tags.map((tag) => tag.getAttribute('data-agent-status')));
    check(
      '草稿筛选只保留草稿卡片',
      draftStatuses.length === 0 || draftStatuses.every((status) => status === 'DRAFT'),
      `结果数=${draftStatuses.length}`,
    );

    await filter.getByText('待发布', { exact: true }).click();
    await sleep(180);
    const pendingCards = await cards.count();
    check(
      '待发布筛选只保留有未发布更新的卡片',
      pendingCards === 0 ||
        (await cards.locator('[data-testid="agent-draft-delta"]').count()) === pendingCards,
      `结果数=${pendingCards}`,
    );

    await filter.getByText('全部', { exact: true }).click();
    await sleep(180);
    check('清除状态筛选后恢复全部卡片', (await cards.count()) === cardCount);

    await page.setViewportSize({ width: 1024, height: 800 });
    await sleep(180);
    check(
      '1024px 列表无页面级横向滚动',
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  if (cardCount > 0) {
    const firstCard = cards.first();
    const firstName = (await firstCard.getAttribute('data-agent-name')) || '';

    if (firstName) {
      const search = page.getByLabel('搜索 Agent');
      await search.fill(`__不存在_${Date.now()}__`);
      await sleep(250);
      check('搜索无匹配时显示过滤空状态', await page.getByText('没有匹配的 Agent').isVisible());
      await search.fill(firstName);
      await sleep(250);
      check('搜索名称可定位 Agent', (await cards.count()) >= 1, firstName);
      await search.fill('');
    } else {
      check('卡片暴露可测试的 Agent 名称', false, '缺少 data-agent-name');
    }

    await firstCard.locator('[data-testid="agent-primary-action"]').click();
    await page.waitForURL(/\/console\/agents\/[^/]+$/);
    await sleep(1200);
    await page.screenshot({ path: shot('agent-workbench-editor.png') });

    check(
      '编辑器头部吸顶并暴露语义容器',
      await page
        .locator('[data-testid="agent-editor-header"]')
        .isVisible()
        .catch(() => false),
    );
    check(
      '发布摘要独立呈现',
      await page
        .locator('[data-testid="agent-publish-summary"]')
        .isVisible()
        .catch(() => false),
    );

    const nav = page.locator('[data-testid="agent-editor-nav"]');
    check('编辑器使用纵向导航', await nav.isVisible().catch(() => false));
    const sectionLabels = ['基础信息', '人设 Prompt', '模型参数', '知识库', '技能', '数据连接'];
    for (const label of sectionLabels) {
      check(
        `纵向导航包含「${label}」`,
        (await nav.getByRole('button', { name: label, exact: true }).count()) === 1,
      );
    }

    const nameInput = page.getByLabel('名称', { exact: true });
    if (await nameInput.isVisible().catch(() => false)) {
      const original = await nameInput.inputValue();
      await nameInput.fill(`${original} `);
      await sleep(200);
      check('修改草稿字段后显示未保存状态', await page.getByText('有未保存变更').isVisible());
    } else {
      check('基础信息名称字段可访问', false);
    }

    await nav
      .getByRole('button', { name: '技能', exact: true })
      .click()
      .catch(() => {});
    await sleep(200);
    check(
      '技能授权明确标注即时生效',
      await page
        .getByText(/技能授权.*即时生效|更改后立即生效/)
        .first()
        .isVisible()
        .catch(() => false),
    );

    await nav
      .getByRole('button', { name: '数据连接', exact: true })
      .click()
      .catch(() => {});
    await sleep(200);
    check(
      '数据连接授权明确标注即时生效',
      await page
        .getByText(/数据连接授权.*即时生效|更改后立即生效/)
        .first()
        .isVisible()
        .catch(() => false),
    );

    await page.screenshot({ path: shot('agent-workbench-connections.png') });
    await page.setViewportSize({ width: 1024, height: 800 });
    await sleep(180);
    check(
      '1024px 编辑器无页面级横向滚动',
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByLabel('返回 Agents').click();
    await sleep(180);
    const leaveConfirmVisible =
      (await page
        .locator('.ant-modal:visible')
        .filter({ hasText: '离开并放弃未保存的变更？' })
        .count()) === 1;
    const openDialogs = await page.locator('.ant-modal').allTextContents();
    await page.screenshot({ path: shot('agent-workbench-leave-guard.png') });
    check(
      '离开有未保存草稿的页面会确认',
      leaveConfirmVisible,
      `url=${page.url()} dialogs=${JSON.stringify(openDialogs)}`,
    );
    await page
      .getByRole('button', { name: '继续编辑', exact: true })
      .click()
      .catch(() => {});
  }

  await runFixtureSuite(ctx);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  check('脚本执行', false, detail);
  await page.screenshot({ path: shot('agent-workbench-error.png') }).catch(() => {});
} finally {
  const failed = results.filter((result) => !result.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
