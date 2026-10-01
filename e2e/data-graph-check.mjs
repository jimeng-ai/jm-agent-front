// 数据星图端到端检查（data-service 设计文档 §8、§9、附录 E）：自起临时 Vite，浏览器里拦截全部 /data/ 请求返回夹具，
// 不访问真实数据库、网关或模型。运行：npm run test:data-graph（需先 cd e2e && npm run setup）。
// 入口是「数据连接」里每个库卡片上的「查看星图」，一个库一页（/console/connectors/:id/graph），只给企业超管。
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

// 数据连接页的卡片：MySQL 声明了「能自描述」，每个库都有「查看星图」（8 还没探测过、21 还没有任何结构也一样）；
// HTTP 接口没有表结构，没有星图。
const KINDS = [
  { kind: 'MYSQL', displayName: 'MySQL', capabilities: ['query', 'describe', 'health', 'write'], fields: [] },
  { kind: 'HTTP', displayName: 'HTTP 接口', capabilities: ['invoke', 'health'], fields: [] },
];
const connectorView = (id, name, displayName, kind, extra = {}) => ({
  id,
  name,
  displayName,
  kind,
  kindLabel: KINDS.find((k) => k.kind === kind).displayName,
  params: {},
  status: 'ACTIVE',
  capabilities: kind === 'MYSQL' ? ['QUERY', 'DESCRIBE'] : ['INVOKE'],
  healthState: 'HEALTHY',
  healthReason: null,
  readonlyVerified: true,
  writePolicy: 'FORBIDDEN',
  writePolicyLabel: '只读',
  semanticStatus: kind === 'MYSQL' ? 'READY' : 'NOT_APPLICABLE',
  semanticCoverage: kind === 'MYSQL' ? 'COMPLETE' : null,
  semanticGaps: [],
  semanticDataTier: 'DERIVED_STATS',
  semanticDataTierLabel: '第 2 档 · 派生统计',
  semanticDataTierEgress: '仅派生统计出库。',
  ...extra,
});
const CONNECTORS = [
  connectorView('7', 'erp', 'ERP 系统', 'MYSQL'),
  connectorView('8', 'crm', null, 'MYSQL', { capabilities: [], healthState: 'UNKNOWN', semanticStatus: 'NONE', semanticCoverage: null }),
  connectorView('20', 'pay-api', '支付接口', 'HTTP'),
];

const card = (name, view, related, keyColumns, relationColumns, extra = {}) => ({
  name,
  displayName: view.displayName ?? null,
  nameSource: view.nameSource ?? 'BUSINESS_VIEW',
  summary: view.summary ?? null,
  domain: view.domain ?? null,
  comment: view.comment ?? null,
  objectType: 'TABLE',
  related,
  selfReferences: [],
  keyColumns,
  relationColumns,
  fieldCount: String(keyColumns.length + relationColumns.length + 3),
  ...extra,
});

const rel = (id, fromTable, fromColumn, toTable, toColumn, cardinality, tier, confirmedBy, role, discriminatorColumn = null) => ({
  id, fromTable, fromColumn, toTable, toColumn, cardinality, tier, confirmedBy, role, discriminatorColumn,
});

// ERP：9 个对象（7 个上画布、2 个暂未发现关联），10 条关系合成 8 根线。
const erpGraph = {
  connectorId: '7',
  name: 'erp',
  displayName: 'ERP 系统',
  semanticStatus: 'READY',
  truncated: false,
  viewStatus: 'READY',
  tables: [
    card('t_vendor', { displayName: '供应商', summary: '一条记录是一个供应商，记着名称、联系方式和结算方式。', domain: '主数据', comment: '供应商表' }, true, [col('id')], [col('customer_id', '对应客户'), col('id')]),
    card('t_customer', { displayName: '客户', summary: '一条记录是一个客户。', domain: '主数据' }, true, [col('id')], [col('id'), col('vendor_id', '对应供应商')]),
    card('t_account', { displayName: '会计科目', summary: '一条记录是一个会计科目，科目之间有上下级。', domain: '财务' }, true, [col('id')], [col('id')], {
      selfReferences: [{ fromColumn: 'parent_id', toColumn: 'id', tier: 'INFERRED', confirmedBy: null, role: '上级科目' }],
    }),
    card('t_po_head', { displayName: '采购订单', summary: '一条记录是一张采购订单，记着供应商和下单日期。', domain: '采购' }, true, [col('id')], [col('id'), col('vendor_id')]),
    card('t_po_item', { displayName: '采购订单明细', summary: '一条记录是采购订单里的一行商品，记着数量和金额。', domain: '采购' }, true, [col('id')], [col('head_id', '所属订单'), col('vendor_id')]),
    card('t_voucher_line', { displayName: '凭证行', summary: '一条记录是一张凭证里的一行分录，记着科目和金额。', domain: '财务' }, true, [col('id')], [col('account_id'), col('gl_account_id'), col('recon_account_id'), col('vendor_id')]),
    card('t_ext', { displayName: '采购订单附加信息', summary: '一条记录是一张采购订单的附加信息。', domain: '采购' }, true, [col('id')], [col('id')]),
    card('t_region', { displayName: '地区', summary: '一条记录是一个地区。', domain: null }, false, [col('id')], [], {
      selfReferences: [{ fromColumn: 'parent_id', toColumn: 'id', tier: 'INFERRED', confirmedBy: null, role: '上级地区' }],
    }),
    card('t_log', { displayName: '操作日志', summary: '一条记录是一次系统操作。', domain: null }, false, [], []),
  ],
  relations: [
    rel('e000000000000001', 't_customer', 'vendor_id', 't_vendor', 'id', 'MANY_TO_ONE', 'INFERRED', null, '对应供应商'),
    rel('e000000000000002', 't_ext', 'id', 't_po_head', 'id', 'ONE_TO_ONE', 'INFERRED', null, null),
    rel('e000000000000003', 't_po_head', 'vendor_id', 't_vendor', 'id', 'MANY_TO_ONE', 'CONFIRMED', 'DATA', '供应商'),
    rel('e000000000000004', 't_po_item', 'head_id', 't_po_head', 'id', 'MANY_TO_ONE', 'CONFIRMED', 'BUSINESS', '所属订单'),
    rel('e000000000000005', 't_po_item', 'vendor_id', 't_vendor', 'id', 'MANY_TO_ONE', 'INFERRED', null, '供货方'),
    rel('e000000000000006', 't_vendor', 'customer_id', 't_customer', 'id', 'MANY_TO_ONE', 'INFERRED', null, '对应客户'),
    rel('e000000000000007', 't_voucher_line', 'account_id', 't_account', 'id', 'MANY_TO_ONE', 'INFERRED', null, '会计科目'),
    rel('e000000000000008', 't_voucher_line', 'gl_account_id', 't_account', 'id', 'MANY_TO_ONE', 'INFERRED', null, '总账科目'),
    rel('e000000000000009', 't_voucher_line', 'recon_account_id', 't_account', 'id', 'MANY_TO_ONE', 'CONFIRMED', 'DATA', '统驭科目'),
    rel('e00000000000000a', 't_voucher_line', 'vendor_id', 't_vendor', 'id', null, 'CONFIRMED', 'BUSINESS', null, 'partner_type'),
  ],
};

// 旧系统：业务名称还没整理完，标题按表注释、表名兜底。13 补全链在跑；14 上次失败；15 从没跑完过、也不会有人来跑
//（补全链开关关着，或语义层没生成成功），后端给的整理状态是 null。
const LEGACY_NAMES = { 13: ['legacy', '旧系统'], 14: ['legacy-failed', '旧系统二'], 15: ['legacy-idle', '旧系统三'] };
const legacyGraph = (connectorId, viewStatus) => ({
  connectorId,
  name: LEGACY_NAMES[connectorId][0],
  displayName: LEGACY_NAMES[connectorId][1],
  semanticStatus: 'READY',
  truncated: false,
  viewStatus,
  tables: [
    card('l_order', { displayName: '订单', nameSource: 'COMMENT', comment: '订单' }, true, [col('id')], [col('id'), col('user_id')]),
    card('l_item', { displayName: null, nameSource: 'PHYSICAL', comment: '订单里的一行，按 order_id 关联到订单' }, true, [col('id')], [col('order_id')]),
    card('l_user', { displayName: '用户', summary: '一条记录是一个用户。', domain: '主数据' }, true, [col('id')], [col('id')]),
  ],
  relations: [
    rel('l000000000000001', 'l_item', 'order_id', 'l_order', 'id', 'MANY_TO_ONE', 'INFERRED', null, null),
    rel('l000000000000002', 'l_order', 'user_id', 'l_user', 'id', 'MANY_TO_ONE', 'INFERRED', null, '下单人'),
  ],
});

const lonely = (connectorId, name, semanticStatus) => ({
  connectorId,
  name,
  displayName: null,
  semanticStatus,
  truncated: false,
  viewStatus: null,
  tables: [card(`${name}_t1`, { displayName: null, nameSource: 'PHYSICAL' }, false, [col('id')], [])],
  relations: [],
});

// 200 个对象、200 条关系：每个对象挂到 (i-1)/4 号对象上形成扇入树，再补一条跨枝的线。
const DOMAINS = ['采购', '销售', '财务', '库存', '主数据', '生产', '人事', '项目'];
const bigTables = Array.from({ length: 200 }, (_, i) => {
  const name = `table_${String(i).padStart(3, '0')}`;
  const outgoing = i > 0 ? [col('parent_id', '上级')] : [];
  return card(name, { displayName: `对象${i}`, summary: `一条记录是对象${i}。`, domain: DOMAINS[i % 8] }, true, [col('id')], [...outgoing, col('id')]);
});
const bigRelations = bigTables.slice(1).map((table, index) =>
  rel(`b${String(index).padStart(15, '0')}`, table.name, 'parent_id', bigTables[Math.floor(index / 4)].name, 'id', 'MANY_TO_ONE',
    index % 3 === 0 ? 'CONFIRMED' : 'INFERRED', index % 3 === 0 ? 'DATA' : null, '上级对象'),
);
bigRelations.push({ ...bigRelations[0], id: 'bextra0000000000', fromTable: 'table_150', toTable: 'table_010' });
const bigGraph = { connectorId: '9', name: 'big', displayName: '大系统', semanticStatus: 'READY', truncated: true, viewStatus: 'READY', tables: bigTables, relations: bigRelations };

const GRAPHS = {
  7: erpGraph,
  8: { ...lonely('8', 'crm', null), tables: [card('crm_a', { nameSource: 'PHYSICAL' }, false, [col('id')], []), card('crm_b', { nameSource: 'PHYSICAL' }, false, [col('id')], [])] },
  9: bigGraph,
  10: lonely('10', 'running', 'RUNNING'),
  11: lonely('11', 'failed', 'FAILED'),
  12: lonely('12', 'ready-empty', 'READY'),
  13: legacyGraph('13', 'RUNNING'),
  14: legacyGraph('14', 'FAILED'),
  15: legacyGraph('15', null),
  // 还没发现关联、业务名称还在整理：提示照样要挂（设计文档 §6.3 的条件里没有「得有关联」）。
  16: { ...lonely('16', 'naming-empty', 'READY'), displayName: '新系统', viewStatus: 'RUNNING' },
  // 刚接进来的库：还没有任何结构，语义层也没生成过。卡片上照样有「查看星图」，进来要说清这个库自己的状态。
  21: { connectorId: '21', name: 'fresh', displayName: '新接入的库', semanticStatus: null, truncated: false, viewStatus: null, tables: [], relations: [] },
};

// 单表详情的字段：键列、关系列，再补一些普通列；凭证行和采购订单明细各 30 列以上，才会出现字段搜索框。
const EXTRA_FIELDS = { t_voucher_line: 36, t_po_item: 32 };
function detailFields(table) {
  const names = [...new Set([...table.keyColumns, ...table.relationColumns, ...table.selfReferences.map((s) => col(s.fromColumn))].map((c) => c.name))];
  const comments = new Map([...table.keyColumns, ...table.relationColumns].map((c) => [c.name, c.comment]));
  const extra = Array.from({ length: EXTRA_FIELDS[table.name] ?? 3 }, (_, i) => `field_${String(i + 1).padStart(2, '0')}`);
  return [...names, 'name', 'amount', ...extra].map((name, index) => ({
    name,
    type: 'bigint',
    nullable: index > 0,
    comment: comments.get(name) ?? null,
    key: name === 'id' ? 'PRIMARY' : null,
    inRelation: table.relationColumns.some((r) => r.name === name),
  }));
}

function tableDetail(graph, name) {
  const table = graph.tables.find((t) => t.name === name);
  if (!table) return null;
  return {
    name: table.name,
    displayName: table.displayName,
    nameSource: table.nameSource,
    summary: table.summary,
    domain: table.domain,
    comment: table.comment,
    objectType: 'TABLE',
    selfReferences: table.selfReferences,
    fields: detailFields(table),
    relations: graph.relations.filter((r) => r.fromTable === name || r.toTable === name),
  };
}

/** 一个系统的物理标识符（小写）：全部表名 + 长度 ≥ 4 的列名，与后端 BusinessTextRules 同一口径。 */
function identifiersOf(graph) {
  const out = new Set(graph.tables.map((t) => t.name.toLowerCase()));
  for (const table of graph.tables) {
    for (const field of detailFields(table)) if (field.name.length >= 4) out.add(field.name.toLowerCase());
  }
  for (const r of graph.relations) {
    for (const c of [r.fromColumn, r.toColumn, r.discriminatorColumn]) if (c && c.length >= 4) out.add(c.toLowerCase());
  }
  return out;
}

/** 按完整单词、不分大小写找物理标识符。 */
const codesIn = (text, identifiers) =>
  [...text.matchAll(/[A-Za-z0-9_$]+/g)].map((m) => m[0]).filter((token) => identifiers.has(token.toLowerCase()));

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

const FORBIDDEN = ['包含', 'READY', 'RUNNING', 'FAILED', 'INSPECTOR', 'UNKNOWN', '%', 'AI', '置信度', '语义层'];
const SUPER = { superAdmin: true, userType: 'SUPER_ADMIN', modules: [], agentIds: [], knowledgeBaseIds: [] };
const MEMBER_WITH_MODULE = { superAdmin: false, userType: 'MEMBER', modules: ['DATA_GRAPH_MODULE'], agentIds: [], knowledgeBaseIds: [] };
const MEMBER_WITHOUT_MODULE = { superAdmin: false, userType: 'MEMBER', modules: ['AGENT_MODULE'], agentIds: [], knowledgeBaseIds: [] };

async function nodePositions(page) {
  return page.$$eval('.react-flow__node', (nodes) =>
    Object.fromEntries(nodes.map((node) => [node.getAttribute('data-id'), node.style.transform])),
  );
}

// 等画布画完：卡片数、连线数到位，视口（自动缩放 / 居中）连续两次读数不变。等不到不抛，返回 false，由调用方记一条失败。
async function waitForGraph(page, cards, edges) {
  const drawn = await page
    .waitForFunction(
      ([c, e]) =>
        document.querySelectorAll('[data-testid="dg-card"]').length === c &&
        document.querySelectorAll('.react-flow__edge').length === e,
      [cards, edges],
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!drawn) return false;
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    const now = await page.$eval('.react-flow__viewport', (el) => el.style.transform).catch(() => '');
    if (now && now === last) return true;
    last = now;
    await page.waitForTimeout(100);
  }
  return true;
}

/** 打开某个库的星图；页面没出来（比如被权限拦下）不抛，返回 false。 */
async function openSystem(page, baseUrl, system) {
  await page.goto(`${baseUrl}/console/connectors/${system}/graph`, { waitUntil: 'domcontentloaded' });
  return page
    .locator('[data-testid="data-graph-page"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

/** 某张卡片是否整张落在画布可见区域里。 */
const insideCanvas = (page, name) =>
  page.evaluate((table) => {
    const canvas = document.querySelector('[data-testid="data-graph-canvas"]')?.getBoundingClientRect();
    const box = document.querySelector(`[data-testid="dg-card"][data-table="${table}"]`)?.getBoundingClientRect();
    if (!canvas || !box) return false;
    return box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom <= canvas.bottom;
  }, name);

/**
 * WCAG 2.x 对比度（设计文档 §8.5：新增的颜色要加进对比度清单，仍须满足 AA）。不手抄色值：直接读页面上实际渲染的颜色，
 * 底色沿祖先一层层往上叠（半透明的按透明度叠；渐变的每个色标都算一遍，取最差的），改了样式这里自动跟着变。
 * 返回不达标的条目：scope 里每段可见文字（含输入框的占位文字），普通字要 4.5:1、大字（≥ 24px，或粗体 ≥ 18.66px）要 3:1；
 * marks 选中的色块（领域色条、色点）按图形对象要 3:1，填充色或描边有一个达到就算看得出。
 * 被调暗（opacity < 1）的元素是选中状态下的有意弱化，不算。
 */
const contrastProblems = (page, scope, marks = []) =>
  page.evaluate(
    ({ scope, marks }) => {
      const rgba = (s) => {
        const m = /rgba?\(([^)]+)\)/.exec(s ?? '');
        if (!m) return null;
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (top, bottom) => ({
        r: top.r * top.a + bottom.r * (1 - top.a),
        g: top.g * top.a + bottom.g * (1 - top.a),
        b: top.b * top.a + bottom.b * (1 - top.a),
        a: 1,
      });
      const lum = ({ r, g, b }) => {
        const f = (c) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (x, y) => {
        const [hi, lo] = [lum(x), lum(y)].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
      };
      // 元素背后所有可能的底色：从最外层叠到它的父元素（withSelf 时连它自己的背景也叠上）。
      const backdrops = (el, withSelf) => {
        const chain = [];
        for (let n = withSelf ? el : el.parentElement; n; n = n.parentElement) chain.unshift(n);
        let cands = [{ r: 255, g: 255, b: 255, a: 1 }];
        for (const n of chain) {
          const cs = getComputedStyle(n);
          const base = rgba(cs.backgroundColor);
          if (base && base.a > 0) cands = cands.map((c) => over(base, c));
          const stops = cs.backgroundImage && cs.backgroundImage !== 'none'
            ? [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => rgba(m[0]))
            : [];
          if (stops.length) {
            const next = [];
            for (const c of cands) {
              for (const stop of stops) next.push(stop.a > 0 ? over(stop, c) : c);
              if (stops.some((stop) => stop.a < 1)) next.push(c);
            }
            const seen = new Set();
            cands = next.filter((c) => {
              const k = [c.r, c.g, c.b].map(Math.round).join(',');
              return seen.has(k) ? false : seen.add(k);
            });
          }
        }
        return cands;
      };
      const shown = (el) => {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return false;
        for (let n = el; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 1) return false;
        }
        return true;
      };
      const problems = [];
      for (const root of document.querySelectorAll(scope)) {
        for (const el of [root, ...root.querySelectorAll('*')]) {
          if (el.closest('svg')) continue;
          const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent.trim()).join('');
          if (!own || !shown(el)) continue;
          const cs = getComputedStyle(el);
          const fg = rgba(cs.color);
          const size = parseFloat(cs.fontSize);
          const need = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
          const worst = Math.min(...backdrops(el, true).map((bg) => ratio(fg.a < 1 ? over(fg, bg) : fg, bg)));
          if (worst < need) problems.push(`「${own.slice(0, 16)}」${worst.toFixed(2)}:1（要 ${need}:1）`);
        }
        for (const input of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
          if (!input.placeholder || !shown(input)) continue;
          const fg = rgba(getComputedStyle(input, '::placeholder').color);
          if (!fg) continue;
          const worst = Math.min(...backdrops(input, true).map((bg) => ratio(fg.a < 1 ? over(fg, bg) : fg, bg)));
          if (worst < 4.5) problems.push(`占位文字「${input.placeholder.slice(0, 16)}」${worst.toFixed(2)}:1（要 4.5:1）`);
        }
      }
      for (const selector of marks) {
        for (const el of document.querySelectorAll(selector)) {
          if (!shown(el)) continue;
          const cs = getComputedStyle(el);
          const mark = rgba(cs.backgroundColor);
          if (!mark) continue;
          const edge = parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none' ? rgba(cs.borderTopColor) : null;
          const worst = Math.min(
            ...backdrops(el, false).map((bg) => Math.max(ratio(mark, bg), edge ? ratio(edge.a < 1 ? over(edge, bg) : edge, bg) : 0)),
          );
          if (worst < 3) problems.push(`${selector} rgb(${mark.r},${mark.g},${mark.b}) ${worst.toFixed(2)}:1（要 3:1）`);
        }
      }
      return [...new Set(problems)];
    },
    { scope, marks },
  );

const { baseUrl, child } = await startVite();
const r = reporter('data-graph');
const { browser, page } = await launchBrowser();
const pageErrors = [];
const unknownApis = new Set();
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text());
});

// 路由夹具的可变状态：换身份、让某个库的接口失败，都只改这里。
const state = { perm: SUPER, failGraph: null };

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
      const fail = () => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, respCode: '500', respMsg: '服务暂时不可用', data: null }) });
      if (path.endsWith('/admin/auth/login')) return json({ token, user });
      if (path.endsWith('/admin/auth/me')) return json(user);
      if (path.endsWith('/admin/me/permissions')) return json(state.perm);
      if (path === '/data/admin/connectors/kinds') return json(KINDS);
      if (path === '/data/admin/connectors') return json(CONNECTORS);
      const tableMatch = path.match(/^\/data\/admin\/data-graph\/systems\/([^/]+)\/tables$/);
      if (tableMatch) {
        const name = new URL(route.request().url()).searchParams.get('name');
        return json(tableDetail(GRAPHS[tableMatch[1]], name));
      }
      const systemMatch = path.match(/^\/data\/admin\/data-graph\/systems\/([^/]+)$/);
      if (systemMatch) return state.failGraph === systemMatch[1] ? fail() : json(GRAPHS[systemMatch[1]]);
      unknownApis.add(path);
      return json(null);
    },
  );

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', 'graph-admin');
  await page.fill('#password', 'fixture-password');
  await page.locator('.login-submit').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });

  // ======================================================== 0. 入口：数据连接里每个库的卡片上有「查看星图」，侧栏没有单独的入口
  const errorsAtStart = pageErrors.length;
  await page.goto(`${baseUrl}/console/connectors`, { waitUntil: 'domcontentloaded' });
  const gridShown = await page.locator('[data-testid="connector-card-grid"]').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
  r.ok('数据连接页出了卡片', gridShown);
  r.ok('★ 侧栏没有单独的「数据星图」入口', (await page.locator('.atlas-nav-item', { hasText: '数据星图' }).count()) === 0);
  const graphEntry = (id) => page.locator(`[data-testid="connector-card"][data-connector-id="${id}"] [data-testid="connector-card-graph"]`);
  r.ok(
    '★ 每个库的卡片上都有「查看星图」（还没探测过的库也有）',
    (await graphEntry('7').count()) === 1 && (await graphEntry('8').count()) === 1 && ((await graphEntry('7').innerText().catch(() => '')) ?? '').includes('查看星图'),
  );
  r.ok('没有表结构的连接（HTTP 接口）没有「查看星图」', (await graphEntry('20').count()) === 0);
  await page.screenshot({ path: shot('data-graph-entry.png'), fullPage: true });
  if (await graphEntry('7').count()) await graphEntry('7').click();
  await page.waitForURL((url) => url.pathname === '/console/connectors/7/graph', { timeout: 10_000 }).catch(() => null);
  r.ok('点「查看星图」进这个库自己的星图', new URL(page.url()).pathname === '/console/connectors/7/graph', page.url());

  // ======================================================== 1. 一个库一页（ERP）
  r.ok('画布画完：7 张卡片、8 根线', await waitForGraph(page, 7, 8));
  const erpIds = identifiersOf(erpGraph);
  r.ok('加载后控制台无报错', pageErrors.length === errorsAtStart, pageErrors.slice(errorsAtStart).join(' | '));
  const headerText = await page.locator('.data-graph-header').innerText();
  r.ok(
    '页头：标题与说明',
    headerText.includes('数据星图') &&
      headerText.includes('看看业务系统里有哪些业务对象、它们之间怎样关联。内容由平台根据接入的系统自动整理，并随系统更新自动同步。'),
    headerText,
  );
  r.ok('页头标题带这个库的名字', ((await page.locator('.data-graph-header__title').innerText().catch(() => '')) ?? '') === '数据星图 · ERP 系统');
  r.ok('★ 只看这一个库：没有系统切换', (await page.locator('.data-graph-systems').count()) === 0);
  r.ok('页头有「返回数据连接」', (await page.locator('[data-testid="dg-back"]').getAttribute('href').catch(() => null)) === '/console/connectors');
  r.ok('侧栏高亮「数据连接」', ((await page.locator('.atlas-nav-item.active').innerText().catch(() => '')) ?? '').includes('数据连接'));
  r.ok('画布只放有关联的对象（7 个）', (await page.locator('[data-testid="dg-card"]').count()) === 7);
  r.ok('同一方向的多条关系合并成一根线：10 条关系画 8 根线', (await page.locator('.react-flow__edge').count()) === 8);
  r.ok(
    'A→B 与 B→A 是两根线（客户、供应商互相引用）',
    (await page.locator('[data-testid="dg-edge-label"][data-edge="t_customer→t_vendor"]').count()) === 1 &&
      (await page.locator('[data-testid="dg-edge-label"][data-edge="t_vendor→t_customer"]').count()) === 1,
  );
  r.ok(
    '任一条已核对就画实线：实线 4 根、虚线 4 根',
    (await page.locator('.react-flow__edge-path.dg-edge.is-confirmed').count()) === 4 &&
      (await page.locator('.react-flow__edge-path.dg-edge.is-inferred').count()) === 4,
  );
  const multi = page.locator('[data-testid="dg-edge-label"][data-edge="t_voucher_line→t_account"]');
  const multiTitle = (await multi.getAttribute('title').catch(() => '')) ?? '';
  r.ok('多条关系的线写「3 种关联」', ((await multi.innerText().catch(() => '')) ?? '').includes('3 种关联'));
  r.ok('悬停列出这根线上的全部角色', ['会计科目', '总账科目', '统驭科目'].every((role) => multiTitle.includes(role)), multiTitle);
  r.ok('单条关系的线写角色名', ((await page.locator('[data-testid="dg-edge-label"][data-edge="t_po_item→t_po_head"]').innerText().catch(() => '')) ?? '') === '所属订单');
  r.ok('线带箭头（指向被引用的对象）', (await page.locator('.react-flow__edge-path[marker-end]').count()) === 8);
  const vendorCard = page.locator('[data-testid="dg-card"][data-table="t_vendor"]');
  r.ok(
    '卡片：业务名、一句说明、领域色条，不列字段',
    (await vendorCard.locator('.dg-card__title').innerText().catch(() => '')) === '供应商' &&
      ((await vendorCard.locator('.dg-card__summary').innerText().catch(() => '')) ?? '').startsWith('一条记录是一个供应商') &&
      (await vendorCard.locator('.dg-card__domain').count()) === 1 &&
      (await page.locator('.dg-card__rows').count()) === 0,
  );
  const sizes = await page.$$eval('[data-testid="dg-card"]', (cards) => [
    ...new Set(cards.map((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`)),
  ]);
  r.ok('所有卡片尺寸相同', sizes.length === 1, sizes.join(','));
  r.ok('有自关联的对象带「内部关联」徽标', (await page.locator('[data-testid="dg-card"][data-table="t_account"] .dg-badge').innerText().catch(() => '')) === '内部关联');
  const summary = (await page.locator('.data-graph-summary').innerText()).replace(/\s+/g, ' ');
  r.ok('概览：对象 9、已核对的关联 4、待核对的关联 6、暂未发现关联的对象 2', /对象 9/.test(summary) && /已核对的关联 4/.test(summary) && /待核对的关联 6/.test(summary) && /暂未发现关联的对象 2/.test(summary), summary);
  r.ok('业务名称都有了、没截断：不显示提示', (await page.locator('[data-testid="dg-hint-naming"]').count()) === 0 && (await page.locator('[data-testid="dg-hint-truncated"]').count()) === 0);
  const pageText = await page.locator('[data-testid="data-graph-page"]').innerText();
  const codes = codesIn(pageText, erpIds);
  r.ok('★ 默认视图扫描不到任何表名、字段名', codes.length === 0, codes.join(','));
  const defaultContrast = await contrastProblems(page, '[data-testid="data-graph-page"]');
  r.ok('文字对比度达到 WCAG AA：默认视图（页头、概览、领域筛选、画布、关联清单）', defaultContrast.length === 0, defaultContrast.join('；'));
  const hintContrast = [];
  const markContrast = await contrastProblems(page, 'none', ['.dg-card__domain', '[data-testid="dg-domains"] i']);
  // 读屏软件念的标签、悬停提示也算默认视图：React Flow 默认给线的读屏标签是「Edge from 表名 to 表名」。
  const spoken = await page.$$eval('[data-testid="data-graph-page"] [aria-label], [data-testid="data-graph-page"] [title]', (els) =>
    els.map((el) => `${el.getAttribute('aria-label') ?? ''}\n${el.getAttribute('title') ?? ''}`).join('\n'),
  );
  const spokenCodes = codesIn(spoken, erpIds);
  r.ok('读屏标签、悬停提示里也没有表名、字段名', spokenCodes.length === 0, [...new Set(spokenCodes)].join(','));
  const lineSpoken = await page.locator('.react-flow__edge[data-id="t_po_item→t_po_head"]').getAttribute('aria-label').catch(() => '');
  r.ok('读屏念一根线：念关系句子', lineSpoken === '每条「采购订单明细」对应一个「采购订单」（作为所属订单）', lineSpoken ?? '');
  const leaked = FORBIDDEN.filter((word) => pageText.includes(word));
  r.ok('界面文案不含运维 / AI 用语', leaked.length === 0, leaked.join(','));
  r.ok('图例写明实线与虚线', pageText.includes('已核对：数据核对通过或业务方确认') && pageText.includes('待核对：按表结构推断，尚未核对'));
  const groups = await page.locator('[data-testid="dg-relation-list"] .dg-group').count();
  const voucherGroup = page.locator('[data-testid="dg-relation-list"] .dg-group', { hasText: '「凭证行」与「会计科目」' });
  r.ok('关联清单按对象两两分组', groups === 7 && (await voucherGroup.locator('li').count()) === 3, `groups=${groups}`);
  r.ok('多对一句子（带角色名）', pageText.includes('每条「采购订单明细」对应一个「采购订单」（作为所属订单）'));
  const voucherLines = ((await voucherGroup.innerText().catch(() => '')) ?? '').split('\n').map((line) => line.trim());
  r.ok('角色名与终点业务名相同时不写「作为」', voucherLines.includes('每条「凭证行」对应一个「会计科目」'), voucherLines.join(' | '));
  r.ok('一对一句子', pageText.includes('「采购订单附加信息」与「采购订单」一一对应'));
  r.ok('已确认的多态关系句末加「只对部分类型成立」', pageText.includes('「凭证行」与「供应商」有关联（只对部分类型成立）'));
  r.ok('来源说明', pageText.includes('业务方确认') && pageText.includes('数据核对通过') && pageText.includes('按表结构推断，尚未核对'));
  const domainButtons = await page.locator('[data-testid="dg-domains"] button').allInnerTexts();
  r.ok('领域筛选：「全部」加各领域，没有领域的归「未分类」排最后', JSON.stringify(domainButtons.map((t) => t.trim())) === JSON.stringify(['全部', '主数据', '财务', '采购', '未分类']), domainButtons.join('|'));
  r.ok(
    '小图整图显示，没有小地图和提示',
    (await page.locator('.react-flow__minimap').count()) === 0 && (await page.locator('[data-testid="dg-explore-hint"]').count()) === 0,
  );
  let allInside = true;
  for (const table of erpGraph.tables.filter((t) => t.related)) allInside = allInside && (await insideCanvas(page, table.name));
  r.ok('小图 7 张卡片都在画布视野里', allInside);
  await page.screenshot({ path: shot('data-graph-v3.png'), fullPage: true });

  // ======================================================== 2. 布局确定、领域筛选不动布局
  const first = await nodePositions(page);
  let stable = true;
  for (let i = 0; i < 2; i += 1) {
    await openSystem(page, baseUrl, '7');
    await waitForGraph(page, 7, 8);
    stable = stable && JSON.stringify(await nodePositions(page)) === JSON.stringify(first);
  }
  r.ok('同一份数据刷新 3 次，卡片坐标完全一致', stable);
  const financeButton = page.locator('[data-testid="dg-domains"] button', { hasText: '财务' });
  if (await financeButton.count()) await financeButton.click();
  const dimmedByDomain = await page.$$eval('[data-testid="dg-card"].is-dimmed', (cards) => cards.map((c) => c.getAttribute('data-table')).sort());
  r.ok(
    '★ 选「财务」：其他领域的对象变暗、坐标不变',
    JSON.stringify(dimmedByDomain) === JSON.stringify(['t_customer', 't_ext', 't_po_head', 't_po_item', 't_vendor']) &&
      JSON.stringify(await nodePositions(page)) === JSON.stringify(first),
    dimmedByDomain.join(','),
  );
  const allButton = page.locator('[data-testid="dg-domains"] button', { hasText: '全部' });
  if (await allButton.count()) await allButton.click();
  r.ok('选回「全部」：没有变暗的对象', (await page.locator('[data-testid="dg-card"].is-dimmed').count()) === 0);

  // ======================================================== 3. 点卡片：不报错、坐标不动、右侧出详情
  const errorsBefore = pageErrors.length;
  let clickStable = true;
  let detailShown = true;
  for (const name of ['t_vendor', 't_customer', 't_po_item', 't_ext', 't_voucher_line']) {
    await page.locator(`[data-testid="dg-card"][data-table="${name}"]`).click();
    detailShown = detailShown && (await page.locator('[data-testid="dg-detail"]').waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false));
    clickStable = clickStable && JSON.stringify(await nodePositions(page)) === JSON.stringify(first);
  }
  r.ok('点卡片后右侧出现对象详情', detailShown);
  r.ok('点卡片不改变任何卡片坐标', clickStable);
  r.ok('点卡片期间控制台无报错', pageErrors.length === errorsBefore, pageErrors.slice(errorsBefore).join(' | '));
  r.ok('选中后非相邻的对象变暗', (await page.locator('.dg-card.is-dimmed').count()) >= 1);

  // 当前选中「凭证行」
  const detail = page.locator('[data-testid="dg-detail"]');
  await detail.locator('.dg-detail__title', { hasText: '凭证行' }).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null);
  const headings = await detail.locator('.dg-detail__section h4, .dg-tech > summary').allInnerTexts();
  r.ok('详情依次是「它是什么」「和谁有关」「技术信息」', JSON.stringify(headings.map((h) => h.trim())) === JSON.stringify(['它是什么', '和谁有关', '技术信息']), headings.join('|'));
  const detailText = await detail.innerText().catch(() => '');
  r.ok('它是什么：业务名、领域、一句说明', detailText.includes('凭证行') && detailText.includes('财务') && detailText.includes('一条记录是一张凭证里的一行分录'));
  r.ok('和谁有关：按相关对象分组', (await detail.locator('.dg-group').count()) === 2 && detailText.includes('每条「凭证行」对应一个「会计科目」（作为总账科目）'));
  const detailCodes = codesIn(await page.locator('[data-testid="data-graph-page"]').innerText(), erpIds);
  r.ok('★ 选中对象后，默认展开的内容里也没有表名、字段名（技术信息折叠）', detailCodes.length === 0, detailCodes.join(','));
  const techSummary = detail.locator('.dg-tech > summary');
  if (await techSummary.count()) await techSummary.click();
  const techText = await detail.locator('.dg-tech').innerText().catch(() => '');
  r.ok('展开技术信息：看得到表名、字段对应与核对状态', techText.includes('t_voucher_line') && techText.includes('t_voucher_line.recon_account_id → t_account.id · 数据核对通过'), techText.slice(0, 200));
  const detailContrast = await contrastProblems(page, '[data-testid="dg-detail"]');
  r.ok('文字对比度达到 WCAG AA：对象详情（含展开的技术信息）', detailContrast.length === 0, detailContrast.join('；'));
  const fieldSearch = detail.locator('.dg-tech input');
  if (await fieldSearch.count()) await fieldSearch.fill('recon');
  r.ok('字段搜索能筛字段', (await detail.locator('.dg-fields li').count()) === 1);

  // 切换到另一个对象：详情状态整个重置（v2 审查 #1）
  await page.locator('[data-testid="dg-card"][data-table="t_po_item"]').click();
  await detail.locator('.dg-detail__title', { hasText: '采购订单明细' }).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null);
  const techOpen = await detail.locator('.dg-tech').evaluate((el) => el.open).catch(() => null);
  if (techOpen === false) await detail.locator('.dg-tech > summary').click();
  r.ok('★ 切换对象后字段搜索词清空', (await detail.locator('.dg-tech input').inputValue().catch(() => 'x')) === '');

  // ======================================================== 4. 右侧页签：暂未发现关联的对象；返回时记住页签（#9）
  await page.locator('.dg-detail__back').click();
  await page.getByRole('tab', { name: /暂未发现关联的对象/ }).click().catch(() => null);
  const isolatedText = await page.locator('[data-testid="dg-isolated-list"]').innerText().catch(() => '');
  r.ok('暂未发现关联的对象列出地区与操作日志，地区带「内部关联」', isolatedText.includes('地区') && isolatedText.includes('操作日志') && isolatedText.includes('内部关联'));
  await page.locator('[data-testid="dg-isolated-list"] button', { hasText: '地区' }).click().catch(() => null);
  const selfLine = page.locator('.dg-detail .dg-sentences li', { hasText: '内部有关联' });
  const selfShown = await selfLine.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  r.ok('自关联句子带角色名', selfShown && (await selfLine.innerText()).includes('「地区」内部有关联（上级地区）'));
  r.ok('没有领域的对象在详情里写「未分类」', ((await detail.innerText().catch(() => '')) ?? '').includes('未分类'));
  await page.locator('.dg-detail__back').click().catch(() => null);
  const activeTab = await page.locator('.dg-side .ant-tabs-tab-active').innerText().catch(() => '');
  r.ok('★ 从详情返回后停在上次的页签', activeTab.includes('暂未发现关联的对象'), activeTab);

  // 搜索：按业务名找，下拉里不出现表名
  await page.locator('.data-graph-search input').fill('明细');
  const option = page.locator('.dg-search-option', { hasText: '采购订单明细' }).first();
  await option.waitFor({ state: 'visible', timeout: 5_000 });
  const optionCodes = codesIn(await option.innerText(), erpIds);
  await option.click();
  const searchDetail = await detail.innerText().catch(() => '');
  r.ok('搜索选中后右侧是该对象详情；下拉里没有表名', searchDetail.includes('采购订单明细') && optionCodes.length === 0, optionCodes.join(','));

  // ======================================================== 5. 换库：地址里的库变了、页面没重新挂载（浏览器前进后退），选中状态同步清掉（#11）；
  // 兜底标题与整理提示
  await page.evaluate(() => {
    history.pushState(null, '', '/console/connectors/13/graph');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  r.ok('旧系统画完：3 张卡片、2 根线', await waitForGraph(page, 3, 2));
  r.ok('★ 换库后没有残留的选中与变暗', (await page.locator('[data-testid="dg-detail"]').count()) === 0 && (await page.locator('.dg-card.is-dimmed').count()) === 0);
  r.ok(
    '兜底标题：像名称的表注释，其次表名',
    (await page.locator('[data-testid="dg-card"][data-table="l_order"] .dg-card__title').innerText()) === '订单' &&
      (await page.locator('[data-testid="dg-card"][data-table="l_item"] .dg-card__title').innerText()) === 'l_item',
  );
  r.ok('有对象还没拿到业务名、补全链在跑：提示「业务名称整理中」', ((await page.locator('[data-testid="dg-hint-naming"]').innerText().catch(() => '')) ?? '').includes('业务名称整理中'));
  hintContrast.push(...(await contrastProblems(page, '[data-testid="dg-hint-naming"]')));
  // 后退回原来的库：之前在 ERP 里搜索选中的「采购订单明细」不能恢复（设计文档 §8.1：换库时清掉选中，不是藏起来）。
  await page.goBack();
  await waitForGraph(page, 7, 8);
  r.ok(
    '★ 后退回原来的库：之前的选中已经清掉，不恢复',
    (await page.locator('[data-testid="dg-detail"]').count()) === 0 &&
      (await page.locator('.dg-card.is-selected').count()) === 0 &&
      (await page.locator('.dg-card.is-dimmed').count()) === 0,
  );
  await openSystem(page, baseUrl, '14');
  await waitForGraph(page, 3, 2);
  r.ok('补全链上次失败：安静地用兜底，不挂提示', (await page.locator('[data-testid="dg-hint-naming"]').count()) === 0);
  await openSystem(page, baseUrl, '15');
  await waitForGraph(page, 3, 2);
  r.ok('★ 补全链不会来跑（开关关着、语义层没生成成功）：安静地用兜底，不挂提示', (await page.locator('[data-testid="dg-hint-naming"]').count()) === 0);

  // ======================================================== 6. 空状态（画布区与页签用同一句话，#10）
  const emptyStates = [
    ['8', '这个系统的业务对象还在整理中，完成后会自动出现。'],
    ['10', '正在整理，完成后刷新页面即可看到。'],
    ['11', '整理没有成功，请联系企业管理员。'],
    ['12', '暂未发现可以确认的关联。'],
  ];
  for (const [system, text] of emptyStates) {
    await openSystem(page, baseUrl, system);
    const shown = await page.locator('[data-testid="dg-empty"]').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    const canvasText = shown ? await page.locator('[data-testid="dg-empty"]').innerText() : '';
    const tabText = await page.locator('[data-testid="dg-relations-empty"]').innerText().catch(() => '');
    r.ok(`空状态（系统 ${system}）：画布区与页签同一句话`, canvasText.includes(text) && tabText.includes(text), `${canvasText} / ${tabText}`);
  }
  await openSystem(page, baseUrl, '8');
  await page.locator('[data-testid="dg-empty"]').waitFor({ state: 'visible', timeout: 10_000 });
  r.ok('空状态里有「去数据连接」', (await page.locator('[data-testid="dg-empty"] a', { hasText: '去「数据连接」' }).count()) === 1);
  await openSystem(page, baseUrl, '21');
  const freshShown = await page.locator('[data-testid="dg-empty"]').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  const freshSummary = (await page.locator('.data-graph-summary').innerText().catch(() => '')).replace(/\s+/g, ' ');
  r.ok(
    '★ 还没有任何结构的库：说这个库自己的状态，不落到别的库上',
    freshShown &&
      (await page.locator('[data-testid="dg-empty"]').innerText()).includes('这个系统的业务对象还在整理中，完成后会自动出现。') &&
      /对象 0/.test(freshSummary) &&
      ((await page.locator('.data-graph-header__title').innerText().catch(() => '')) ?? '') === '数据星图 · 新接入的库',
    freshSummary,
  );
  await openSystem(page, baseUrl, '16');
  await page.locator('[data-testid="dg-empty"]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  r.ok(
    '还没发现关联、业务名称还在整理：空状态之外照样提示「业务名称整理中」',
    ((await page.locator('[data-testid="dg-hint-naming"]').innerText().catch(() => '')) ?? '').includes('业务名称整理中'),
  );
  hintContrast.push(...(await contrastProblems(page, '[data-testid="dg-empty"], [data-testid="dg-relations-empty"]')));

  // ======================================================== 7. 大图：截断提示、小地图、先显示关联最多的对象、键盘聚焦跟随（#6）
  const started = Date.now();
  await openSystem(page, baseUrl, '9');
  const bigDrawn = await waitForGraph(page, 200, 200);
  const elapsed = Date.now() - started;
  r.ok('200 个对象的大图能渲染', bigDrawn, `首屏 ${elapsed} ms`);
  r.ok('快照截断：提示「只整理了按重要性排前 200 个对象」', ((await page.locator('[data-testid="dg-hint-truncated"]').innerText().catch(() => '')) ?? '').includes('这个系统表很多，只整理了按重要性排前 200 个对象'));
  r.ok('大图不强行缩成一屏：有小地图', await page.locator('.react-flow__minimap').isVisible());
  const chromeTips = await page.$$eval('.react-flow__controls button, .react-flow__minimap svg > title', (els) =>
    els.map((el) => el.getAttribute('title') ?? el.textContent),
  );
  r.ok('画布按钮、小地图的提示是中文', JSON.stringify(chromeTips) === JSON.stringify(['放大', '缩小', '显示全图', '小地图']), chromeTips.join('|'));
  const hint = await page.locator('[data-testid="dg-explore-hint"]').innerText().catch(() => '');
  r.ok('大图提示先显示关联最多的对象附近', hint.includes('「对象10」附近'), hint);
  hintContrast.push(...(await contrastProblems(page, '[data-testid="dg-hint-truncated"], [data-testid="dg-explore-hint"]')));
  r.ok('文字对比度达到 WCAG AA：整理提示、空状态、截断提示、大图提示', hintContrast.length === 0, hintContrast.join('；'));
  markContrast.push(...(await contrastProblems(page, 'none', ['.dg-card__domain', '[data-testid="dg-domains"] i'])));
  r.ok('领域颜色（8 色与「未分类」：卡片色条、筛选色点）与底色的对比度至少 3:1', markContrast.length === 0, [...new Set(markContrast)].join('；'));
  const hubBox = await page.locator('[data-testid="dg-card"][data-table="table_010"]').boundingBox();
  r.ok('关联最多的对象在视野里、卡片够大能读', Boolean(hubBox) && hubBox.width >= 200 && (await insideCanvas(page, 'table_010')), JSON.stringify(hubBox));
  const far = 'table_199';
  const farBefore = await insideCanvas(page, far);
  const scale = () => page.$eval('.react-flow__viewport', (el) => el.style.transform.replace(/.*scale\(([^)]+)\).*/, '$1'));
  const scaleBefore = await scale();
  // 先按一下 Tab：只有键盘带来的焦点才让画布跟过去（鼠标按下也会让卡片拿到焦点，那时不能挪画布）。
  await page.keyboard.press('Tab');
  await page.locator(`[data-testid="dg-card"][data-table="${far}"]`).focus();
  // 等视口停稳再判断：平移若带动画，中途会先缩小再放大，停在半路读会误判。
  let lastViewport = '';
  for (let i = 0; i < 30; i += 1) {
    const now = await page.$eval('.react-flow__viewport', (el) => el.style.transform);
    if (now === lastViewport) break;
    lastViewport = now;
    await page.waitForTimeout(100);
  }
  r.ok(
    '★ 键盘聚焦到视野外的卡片：画布平移过去，缩放不变',
    !farBefore && (await insideCanvas(page, far)) && (await scale()) === scaleBefore,
    `之前在视野里=${farBefore} 缩放 ${scaleBefore} → ${await scale()}`,
  );
  // 鼠标点到半露在画布边上的卡片：选中它，画布不动。按下的那一刻卡片就拿到了焦点，若当成键盘聚焦把画布挪走，
  // 松开时鼠标已经落在别处，这一下点击就落空了。
  const edge = await page.evaluate(() => {
    const frame = document.querySelector('.dg-canvas').getBoundingClientRect();
    for (const el of document.querySelectorAll('[data-testid="dg-card"]')) {
      const b = el.getBoundingClientRect();
      const inside = b.left >= frame.left && b.right <= frame.right && b.top >= frame.top && b.bottom <= frame.bottom;
      const left = Math.max(b.left, frame.left);
      const right = Math.min(b.right, frame.right);
      const top = Math.max(b.top, frame.top);
      const bottom = Math.min(b.bottom, frame.bottom);
      if (inside || right - left < 40 || bottom - top < 30) continue;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      if (document.elementFromPoint(x, y)?.closest('[data-testid="dg-card"]') === el) return { name: el.dataset.table, x, y };
    }
    return null;
  });
  const viewportBefore = await page.$eval('.react-flow__viewport', (el) => el.style.transform);
  if (edge) await page.mouse.click(edge.x, edge.y);
  await page.waitForTimeout(300);
  const viewportAfter = await page.$eval('.react-flow__viewport', (el) => el.style.transform);
  const edgePressed = edge ? await page.locator(`[data-testid="dg-card"][data-table="${edge.name}"]`).getAttribute('aria-pressed') : null;
  r.ok(
    '★ 鼠标点画布边上半露的卡片：选中它，画布不动',
    Boolean(edge) && edgePressed === 'true' && viewportAfter === viewportBefore,
    `${edge?.name ?? '没找到半露的卡片'} 选中=${edgePressed} 视口 ${viewportBefore} → ${viewportAfter}`,
  );
  await page.screenshot({ path: shot('data-graph-v3-big.png'), fullPage: true });

  // ======================================================== 8. 成员：侧栏没有入口，直接敲地址被拦（以前授过「数据星图」模块的也一样）
  for (const [who, perm] of [['以前授过「数据星图」模块的成员', MEMBER_WITH_MODULE], ['普通成员', MEMBER_WITHOUT_MODULE]]) {
    state.perm = perm;
    await openSystem(page, baseUrl, '7');
    const denied = await page.getByText('仅企业超管可访问').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    r.ok(`★ ${who}直接敲地址：「仅企业超管可访问」`, denied);
    r.ok(
      `${who}侧栏既没有「数据星图」也没有「数据连接」`,
      (await page.locator('.atlas-nav-item', { hasText: '数据星图' }).count()) === 0 &&
        (await page.locator('.atlas-nav-item', { hasText: '数据连接' }).count()) === 0,
    );
  }
  state.perm = SUPER;

  // ======================================================== 9. 接口失败；返回数据连接
  state.failGraph = '7';
  await openSystem(page, baseUrl, '7');
  const graphError = await page.getByText('这个系统的关联没有加载出来').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
  r.ok('接口失败：这个库的关联加载失败有提示和重试', graphError && (await page.getByRole('button', { name: /重试/ }).count()) >= 1);
  state.failGraph = null;
  await page.locator('[data-testid="dg-back"]').click().catch(() => null);
  await page.waitForURL((url) => url.pathname === '/console/connectors', { timeout: 10_000 }).catch(() => null);
  r.ok('点「返回数据连接」回到数据连接', new URL(page.url()).pathname === '/console/connectors', page.url());
  r.ok('全程无未预期的接口', unknownApis.size === 0, [...unknownApis].join(','));
} finally {
  await browser.close();
  if (child) child.kill('SIGTERM');
}

const ok = r.summary();
process.exit(ok ? 0 : 1);
