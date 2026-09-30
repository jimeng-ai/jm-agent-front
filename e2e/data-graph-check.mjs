// 数据星图端到端检查（data-service 设计文档 §8）：自起临时 Vite，浏览器里拦截全部 /data/ 请求返回夹具，
// 不访问真实数据库、网关或模型。运行：npm run test:data-graph（需先 cd e2e && npm run setup）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, reporter, shot } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const apiResponse = (data) => ({ success: true, respCode: '200', respMsg: 'ok', data });
const col = (name, comment = null) => ({ name, comment });

// ---------------------------------------------------------------- 夹具

const systems = [
  { connectorId: '7', name: 'erp', displayName: 'ERP 系统', kind: 'MYSQL', status: 'ACTIVE', semanticStatus: 'READY', tableCount: '7' },
  { connectorId: '8', name: 'crm', displayName: null, kind: 'MYSQL', status: 'DISABLED', semanticStatus: null, tableCount: '2' },
  { connectorId: '9', name: 'big', displayName: '大系统', kind: 'MYSQL', status: 'ACTIVE', semanticStatus: 'RUNNING', tableCount: '200' },
  { connectorId: '10', name: 'running', displayName: null, kind: 'MYSQL', status: 'ACTIVE', semanticStatus: 'RUNNING', tableCount: '1' },
  { connectorId: '11', name: 'failed', displayName: null, kind: 'MYSQL', status: 'ACTIVE', semanticStatus: 'FAILED', tableCount: '1' },
  { connectorId: '12', name: 'ready-empty', displayName: null, kind: 'MYSQL', status: 'ACTIVE', semanticStatus: 'READY', tableCount: '1' },
];

const card = (name, displayName, comment, related, keyColumns, relationColumns, extra = {}) => ({
  name,
  displayName,
  comment,
  objectType: 'TABLE',
  related,
  selfReferences: [],
  keyColumns,
  relationColumns,
  fieldCount: String(keyColumns.length + relationColumns.length + 3),
  ...extra,
});

const erpGraph = {
  connectorId: '7',
  name: 'erp',
  displayName: 'ERP 系统',
  semanticStatus: 'READY',
  tables: [
    card('t_order', '订单表', '订单表', true, [col('id', '订单主键')], [col('customer_code'), col('customer_id', '下单客户'), col('id', '订单主键')]),
    card('t_customer', '客户表', '客户表', true, [col('id')], [col('code', '客户编码'), col('id')]),
    card('t_item', '订单明细', '订单明细', true, [col('id')], [col('order_id', '所属订单')]),
    card('t_ext', null, '扩展表，按 id 一对一拆出', true, [col('id')], [col('id')]),
    // 中文、带空格的表名和列名（ERP 里常见），走同样的连线与详情接口
    card('采购 单', '采购单', '采购单', true, [col('编号')], [col('客户 编号', '客户编号')]),
    card('t_region', '地区', '地区', false, [col('id')], [], { selfReferences: [{ fromColumn: 'parent_id', toColumn: 'id' }] }),
    card('t_log', '操作日志', '操作日志', false, [], []),
  ],
  relations: [
    { id: 'a1b2c3d4e5f60001', fromTable: 't_ext', fromColumn: 'id', toTable: 't_order', toColumn: 'id', cardinality: 'ONE_TO_ONE', tier: 'INFERRED', confirmedBy: null, label: null, discriminatorColumn: null },
    { id: 'a1b2c3d4e5f60002', fromTable: 't_item', fromColumn: 'order_id', toTable: 't_order', toColumn: 'id', cardinality: 'MANY_TO_ONE', tier: 'CONFIRMED', confirmedBy: 'DATA', label: '所属订单', discriminatorColumn: null },
    // 同一对表之间两条关系（不同列），各自连到各自的字段行
    { id: 'a1b2c3d4e5f60004', fromTable: 't_order', fromColumn: 'customer_code', toTable: 't_customer', toColumn: 'code', cardinality: 'MANY_TO_ONE', tier: 'CONFIRMED', confirmedBy: 'DATA', label: null, discriminatorColumn: null },
    { id: 'a1b2c3d4e5f60003', fromTable: 't_order', fromColumn: 'customer_id', toTable: 't_customer', toColumn: 'id', cardinality: 'MANY_TO_ONE', tier: 'CONFIRMED', confirmedBy: 'BUSINESS', label: '下单客户', discriminatorColumn: null },
    { id: 'a1b2c3d4e5f60005', fromTable: '采购 单', fromColumn: '客户 编号', toTable: 't_customer', toColumn: 'id', cardinality: 'MANY_TO_ONE', tier: 'INFERRED', confirmedBy: null, label: '客户编号', discriminatorColumn: null },
  ],
};

const lonely = (connectorId, name, semanticStatus) => ({
  connectorId,
  name,
  displayName: null,
  semanticStatus,
  tables: [card(`${name}_t1`, null, null, false, [col('id')], [])],
  relations: [],
});

// 200 张表、200 条关系：每张表挂到 (i-1)/4 号表上形成扇入树，再补一条跨枝的线。
const bigTables = Array.from({ length: 200 }, (_, i) => {
  const name = `table_${String(i).padStart(3, '0')}`;
  const outgoing = i > 0 ? [col('parent_id', '上级')] : [];
  return card(name, `表${i}`, `表${i}`, true, [col('id')], [...outgoing, col('id')]);
});
const bigRelations = bigTables.slice(1).map((table, index) => ({
  id: `b${String(index).padStart(15, '0')}`,
  fromTable: table.name,
  fromColumn: 'parent_id',
  toTable: bigTables[Math.floor(index / 4)].name,
  toColumn: 'id',
  cardinality: 'MANY_TO_ONE',
  tier: index % 3 === 0 ? 'CONFIRMED' : 'INFERRED',
  confirmedBy: index % 3 === 0 ? 'DATA' : null,
  label: null,
  discriminatorColumn: null,
}));
bigRelations.push({ ...bigRelations[0], id: 'bextra0000000000', fromTable: 'table_150', toTable: 'table_010' });
const bigGraph = { connectorId: '9', name: 'big', displayName: '大系统', semanticStatus: 'RUNNING', tables: bigTables, relations: bigRelations };

const graphs = {
  7: erpGraph,
  8: { ...lonely('8', 'crm', null), tables: [card('crm_a', null, null, false, [col('id')], []), card('crm_b', null, null, false, [col('id')], [])] },
  9: bigGraph,
  10: lonely('10', 'running', 'RUNNING'),
  11: lonely('11', 'failed', 'FAILED'),
  12: lonely('12', 'ready-empty', 'READY'),
};

function tableDetail(graph, name) {
  const table = graph.tables.find((t) => t.name === name);
  if (!table) return null;
  const columns = [...table.keyColumns, ...table.relationColumns.filter((c) => !table.keyColumns.some((k) => k.name === c.name))];
  return {
    name: table.name,
    displayName: table.displayName,
    comment: table.comment,
    objectType: 'TABLE',
    selfReferences: table.selfReferences,
    fields: columns.map((c, index) => ({
      name: c.name,
      type: 'bigint',
      nullable: index > 0,
      comment: c.comment,
      key: index === 0 && table.keyColumns.length ? 'PRIMARY' : null,
      inRelation: table.relationColumns.some((r) => r.name === c.name),
    })),
    relations: graph.relations.filter((r) => r.fromTable === name || r.toTable === name),
  };
}

// ---------------------------------------------------------------- 临时 Vite

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite 还在启动。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Vite 启动超时: ${url}`);
}

async function startVite() {
  if (process.env.E2E_BASE_URL) return { baseUrl: process.env.E2E_BASE_URL, child: null };
  const port = await freePort();
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl);
    return { baseUrl, child };
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

// ---------------------------------------------------------------- 浏览器侧

const FORBIDDEN = ['包含', 'READY', 'RUNNING', 'FAILED', 'INSPECTOR', 'UNKNOWN', '%', 'AI 推测', 'AI 可信度', '置信度'];

async function nodePositions(page) {
  return page.$$eval('.react-flow__node', (nodes) =>
    Object.fromEntries(nodes.map((node) => [node.getAttribute('data-id'), node.style.transform])),
  );
}

// 等画布画完：卡片数、连线数到位，视口（自动缩放 / 居中）连续两次读数不变。
async function waitForGraph(page, cards, edges) {
  await page.waitForFunction(
    ([c, e]) =>
      document.querySelectorAll('[data-testid="dg-card"]').length === c &&
      document.querySelectorAll('.react-flow__edge').length === e,
    [cards, edges],
    { timeout: 30_000 },
  );
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    const now = await page.$eval('.react-flow__viewport', (el) => el.style.transform).catch(() => '');
    if (now && now === last) return;
    last = now;
    await page.waitForTimeout(100);
  }
}

async function openSystem(page, baseUrl, system) {
  await page.goto(`${baseUrl}/console/data-graph${system ? `?system=${system}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="data-graph-page"]').waitFor({ state: 'visible', timeout: 15_000 });
}

const { baseUrl, child } = await startVite();
const r = reporter('data-graph');
const { browser, page } = await launchBrowser();
const pageErrors = [];
const unknownApis = new Set();
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text());
});

try {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ id: '1', tenant_id: 'tenant-fixture', exp: Math.floor(Date.now() / 1000) + 86_400 }),
  ).toString('base64url');
  const token = `${header}.${payload}.fixture`;
  const user = { id: '1', username: 'graph-admin', displayName: '星图管理员', tenantId: 'tenant-fixture', status: 'ACTIVE', userType: 'SUPER_ADMIN' };

  await page.route(
    (url) => url.pathname.startsWith('/data/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiResponse(data)) });
      if (path.endsWith('/admin/auth/login')) return json({ token, user });
      if (path.endsWith('/admin/auth/me')) return json(user);
      if (path.endsWith('/admin/me/permissions')) return json({ superAdmin: true, modules: [], agentIds: [], knowledgeBaseIds: [] });
      if (path === '/data/admin/data-graph/systems') return json(systems);
      const tableMatch = path.match(/^\/data\/admin\/data-graph\/systems\/([^/]+)\/tables$/);
      if (tableMatch) {
        const name = new URL(route.request().url()).searchParams.get('name');
        return json(tableDetail(graphs[tableMatch[1]], name));
      }
      const systemMatch = path.match(/^\/data\/admin\/data-graph\/systems\/([^/]+)$/);
      if (systemMatch) return json(graphs[systemMatch[1]]);
      unknownApis.add(path);
      return json(null);
    },
  );

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', 'graph-admin');
  await page.fill('#password', 'fixture-password');
  await page.locator('.login-submit').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });

  // 1. 默认打开第一个系统：只有有关系的表上画布，线有实线有虚线
  await openSystem(page, baseUrl, null);
  await waitForGraph(page, 5, 5);
  r.ok('画布只放有关系的表（5 张）', (await page.locator('[data-testid="dg-card"]').count()) === 5);
  r.ok('5 条关系线（同一对表的两条各自画出）', (await page.locator('.react-flow__edge').count()) === 5);
  r.ok('推断关系是虚线（2 条）', (await page.locator('.react-flow__edge-path.dg-edge.is-inferred').count()) === 2);
  const summary = await page.locator('.data-graph-summary').innerText();
  r.ok('概览：7 张表、已确认 3、推断 2、未发现关联 2', /表\s*7/.test(summary) && /已确认关系\s*3/.test(summary) && /推断关系\s*2/.test(summary) && /未发现关联的表\s*2/.test(summary), summary.replace(/\s+/g, ' '));
  const pageText = await page.locator('[data-testid="data-graph-page"]').innerText();
  const leaked = FORBIDDEN.filter((word) => pageText.includes(word));
  r.ok('界面文案不含运维 / AI 用语', leaked.length === 0, leaked.join(','));
  r.ok('图例写明实线与虚线', pageText.includes('已确认：数据核对通过或业务方确认') && pageText.includes('推断：按表结构，尚未核对'));
  r.ok('关系清单是句子', pageText.includes('每条「订单明细」对应一条「订单表」（order_id → id）'));
  r.ok('一对一句子', pageText.includes('「t_ext」与「订单表」一一对应（id → id）'));
  r.ok('中文带空格的表名照常成句', pageText.includes('每条「采购单」对应一条「客户表」（客户 编号 → id）'));
  r.ok('来源说明', pageText.includes('业务方确认') && pageText.includes('数据核对通过') && pageText.includes('按表结构推断，尚未核对'));
  r.ok(
    '小图整图显示，没有小地图和提示',
    (await page.locator('.react-flow__minimap').count()) === 0 &&
      (await page.locator('[data-testid="dg-explore-hint"]').count()) === 0,
  );
  const allInside = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="data-graph-canvas"]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid="dg-card"]')].every((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom <= canvas.bottom;
    });
  });
  r.ok('小图 5 张卡片都在画布视野里', allInside);
  await page.screenshot({ path: shot('data-graph-v2.png'), fullPage: true });

  // 2. 布局确定：连续加载 3 次坐标一致
  const first = await nodePositions(page);
  let stable = true;
  for (let i = 0; i < 2; i += 1) {
    await openSystem(page, baseUrl, '7');
    await waitForGraph(page, 5, 5);
    stable = stable && JSON.stringify(await nodePositions(page)) === JSON.stringify(first);
  }
  r.ok('同一份数据刷新 3 次，卡片坐标完全一致', stable);

  // 3. 点每一张卡片：不报错、坐标不动、右侧出详情
  const errorsBefore = pageErrors.length;
  let clickStable = true;
  let detailShown = true;
  for (const name of ['t_order', 't_customer', 't_item', 't_ext', '采购 单']) {
    await page.locator(`[data-testid="dg-card"][data-table="${name}"]`).click();
    detailShown = detailShown && (await page.locator('[data-testid="dg-detail"]').waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false));
    clickStable = clickStable && JSON.stringify(await nodePositions(page)) === JSON.stringify(first);
  }
  r.ok('点卡片后右侧出现表详情', detailShown);
  r.ok('点卡片不改变任何卡片坐标', clickStable);
  r.ok('点卡片期间控制台无报错', pageErrors.length === errorsBefore, pageErrors.slice(errorsBefore).join(' | '));
  r.ok('选中后非相邻的表变暗', (await page.locator('.dg-card.is-dimmed').count()) >= 1);

  // 3b. 搜索定位：选中搜索结果即打开该表详情
  await page.locator('.dg-detail__back').click();
  await page.locator('.data-graph-search input').fill('订单明细');
  await page.locator('.dg-search-option', { hasText: '订单明细' }).first().click();
  const searchDetail = await page.locator('[data-testid="dg-detail"]').innerText().catch(() => '');
  r.ok('搜索选中后右侧是该表详情', searchDetail.includes('订单明细') && searchDetail.includes('t_item'));

  // 4. 未发现关联的表：在右侧列表里，带「有上下级」标记
  await page.locator('.dg-detail__back').click();
  await page.getByRole('tab', { name: /未发现关联的表/ }).click();
  const isolatedText = await page.locator('[data-testid="dg-isolated-list"]').innerText();
  r.ok('未发现关联的表列出地区与操作日志', isolatedText.includes('地区') && isolatedText.includes('操作日志') && isolatedText.includes('有上下级'));

  // 4b. 带自关联的表打开详情：「内部有上下级」那句占满整行，不能被挤进图例那一窄列、一行一个字
  await page.locator('[data-testid="dg-isolated-list"] button', { hasText: '地区' }).click();
  const selfLine = page.locator('.dg-detail .dg-sentences li', { hasText: '内部有上下级' });
  await selfLine.waitFor({ state: 'visible', timeout: 5_000 });
  const selfBox = await selfLine.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
  r.ok('「内部有上下级」句子横排（不超过两行）', selfBox.height <= 48, JSON.stringify(selfBox));
  await page.locator('.dg-detail__back').click();

  // 5. 空状态
  const states = [
    ['8', '这个系统的表关系还没整理'],
    ['10', '正在整理表关系，完成后刷新页面即可看到'],
    ['11', '表关系整理没有成功'],
    ['12', '暂未发现可以确认的表关系'],
  ];
  for (const [system, text] of states) {
    await openSystem(page, baseUrl, system);
    const shown = await page.locator('[data-testid="dg-empty"]').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    r.ok(`空状态（系统 ${system}）`, shown && (await page.locator('[data-testid="dg-empty"]').innerText()).includes(text));
  }

  // 6. 200 张表、200 条关系：能渲染，记录首屏耗时；语义层更新中的提示
  const started = Date.now();
  await openSystem(page, baseUrl, '9');
  await waitForGraph(page, 200, 200);
  const elapsed = Date.now() - started;
  r.ok('200 张表的大图能渲染', true, `首屏 ${elapsed} ms`);
  r.ok('语义层更新中有提示', (await page.locator('.data-graph-note').innerText()).includes('语义层正在更新'));
  r.ok('大图不强行缩成一屏：有小地图', await page.locator('.react-flow__minimap').isVisible());
  const hint = await page.locator('[data-testid="dg-explore-hint"]').innerText().catch(() => '');
  r.ok('大图提示先显示关联最多的表附近', hint.includes('「表10」附近'), hint);
  const hubBox = await page.locator('[data-testid="dg-card"][data-table="table_010"]').boundingBox();
  const canvasBox = await page.locator('[data-testid="data-graph-canvas"]').boundingBox();
  r.ok(
    '关联最多的表在视野里、卡片够大能读',
    Boolean(hubBox && canvasBox) &&
      hubBox.width >= 200 &&
      hubBox.x >= canvasBox.x &&
      hubBox.x + hubBox.width <= canvasBox.x + canvasBox.width &&
      hubBox.y >= canvasBox.y &&
      hubBox.y + hubBox.height <= canvasBox.y + canvasBox.height,
    JSON.stringify({ hubBox, canvasBox }),
  );
  await page.screenshot({ path: shot('data-graph-v2-big.png'), fullPage: true });
  r.ok('全程无未预期的接口', unknownApis.size === 0, [...unknownApis].join(','));
} finally {
  await browser.close();
  if (child) child.kill('SIGTERM');
}

const ok = r.summary();
process.exit(ok ? 0 : 1);
