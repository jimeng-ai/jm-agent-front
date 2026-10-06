// 语义层工作台回归：所有语义 API 都由 Playwright fixture 接管。
// 重跑 / 删除会点到确认按钮以核对真实请求，但请求在浏览器内被拦截，不会写入后端。
import { CONFIG, launchBrowser, login, reporter, shot } from './lib.mjs';

const CONNECTOR_ID = 'semantic-workbench-fixture';
const DETAIL_PATH = `/data/admin/connectors/${CONNECTOR_ID}`;
const SEMANTIC_PATH = `${DETAIL_PATH}/semantic`;

const envelope = (data) => ({ success: true, respCode: '200', respMsg: 'ok', data });
const failedEnvelope = (message, respCode = '5000') => ({
  success: false,
  respCode,
  respMsg: message,
  data: null,
});

const baseConnector = {
  id: CONNECTOR_ID,
  name: 'semantic_fixture',
  displayName: '语义工作台 Fixture',
  kind: 'MYSQL',
  kindLabel: 'MySQL',
  params: {},
  status: 'ACTIVE',
  capabilities: ['QUERY', 'DESCRIBE'],
  healthState: 'HEALTHY',
  readonlyVerified: true,
  writePolicy: 'FORBIDDEN',
  writePolicyLabel: '只读',
  semanticStatus: 'READY',
  semanticSyncedAt: '2026-09-27T10:00:00+08:00',
  semanticClaimAt: null,
  semanticNote: 'fixture 生成详情',
  semanticCoverage: 'PARTIAL',
  semanticGaps: ['TABLES_MISSING', 'FUTURE_GAP'],
  semanticDataTier: 'SAMPLE_VALUES',
  semanticDataTierLabel: '第 3 档 · 样本值',
  semanticDataTierEgress: '允许经过敏感信息筛查的样本值出库。',
};

const semanticRows = [
  ...Array.from({ length: 21 }, (_, index) => ({
    id: `semantic-row-${index + 1}`,
    scope: 'FIELD',
    objectName: 'orders',
    fieldName: `field_${index + 1}`,
    gloss: `字段 ${index + 1} 的业务含义`,
    source: index === 0 ? 'HUMAN' : 'INFERRED',
    evidence: index === 0 ? 'GUESS' : 'NAME',
    verified: 'NONE',
    status: index === 0 ? 'CONFIRMED' : 'DRAFT',
    answeredName: index === 0 ? '业务负责人' : null,
    answeredAt: index === 0 ? '2026-09-27T09:00:00+08:00' : null,
    traceId: index === 0 ? 'trace-semantic-fixture' : null,
    history:
      index === 0
        ? [
            {
              at: '2026-09-26T09:00:00+08:00',
              by_name: '历史回答人',
              from_gloss: '旧的字段含义',
              trace_id: 'trace-semantic-history',
            },
          ]
        : null,
  })),
  {
    id: 'semantic-value-profile',
    scope: 'FIELD',
    objectName: 'orders',
    fieldName: 'region_code',
    gloss: '值域阶段补写：华东、华南',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'NONE',
    status: 'DRAFT',
    detail: {
      origin: 'value_profile',
      value_domain: { complete: true, values: ['华东', '华南'] },
    },
  },
  {
    id: 'semantic-value-profile-legacy',
    scope: 'FIELD',
    objectName: 'orders',
    fieldName: 'legacy_region_code',
    gloss: '旧版值域补写：北区、南区',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'NONE',
    status: 'DRAFT',
    detail: { value_domain: { complete: true, values: ['北区', '南区'] } },
  },
  {
    id: 'semantic-ordinary-value-domain',
    scope: 'FIELD',
    objectName: 'orders',
    fieldName: 'channel_code',
    gloss: '普通字段的渠道代码',
    source: 'IMPORTED',
    evidence: 'COMMENT',
    verified: 'NONE',
    status: 'CONFIRMED',
    detail: {
      value_domain: {
        complete: true,
        values: ['WEB', 'STORE'],
        distinct_count: '2',
        note: 'fixture 渠道值域已采全',
      },
    },
  },
  {
    id: 'semantic-stale-value-domain',
    scope: 'FIELD',
    objectName: 'orders',
    fieldName: 'legacy_channel_code',
    gloss: '结构已变的渠道代码',
    source: 'IMPORTED',
    evidence: 'COMMENT',
    verified: 'NONE',
    status: 'STALE',
    detail: {
      value_domain: {
        complete: true,
        values: ['OLD_WEB', 'OLD_STORE'],
        distinct_count: '2',
        note: 'fixture 旧结构值域',
      },
    },
  },
  {
    id: 'semantic-outcome-value-domain',
    scope: 'FIELD',
    objectName: 'orders',
    fieldName: 'contact_hint',
    gloss: '可能包含个人信息的字段',
    source: 'IMPORTED',
    evidence: 'COMMENT',
    verified: 'NONE',
    status: 'CONFIRMED',
    detail: {
      value_domain: {
        complete: false,
        outcome: 'PII_BLOCKED',
      },
    },
  },
  {
    id: 'semantic-join-valid',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'customer_id',
    gloss: '这句 relation gloss 只留库，不是 conn_describe 的注入事实',
    source: 'INFERRED',
    evidence: 'DATA',
    confidence: '93',
    verified: 'confirmed',
    status: 'CONFIRMED',
    detail: {
      to_object: 'customers',
      to_column: 'id',
      cardinality: 'N:1',
      auto_joinable: true,
      basis: 'fixture 关系实测通过',
    },
  },
  {
    id: 'semantic-join-human-none',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'owner_id',
    gloss: '人工补充的关系说明只留库',
    source: 'HUMAN',
    evidence: 'GUESS',
    verified: 'NONE',
    status: 'CONFIRMED',
    detail: { to_object: 'users', to_column: 'id' },
  },
  {
    id: 'semantic-join-undecidable',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'campaign_id',
    gloss: '探查过但样本不足的关系',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'UNDECIDABLE',
    status: 'CONFIRMED',
    detail: {
      to_object: 'campaigns',
      to_column: 'id',
      verify_note: '目标表样本太少',
    },
  },
  {
    id: 'semantic-join-one-many',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'campaign_code',
    gloss: '右侧一对多关系',
    source: 'INFERRED',
    evidence: 'COMMENT',
    confidence: '88',
    verified: 'CONFIRMED',
    status: 'CONFIRMED',
    detail: {
      to_object: 'campaign_events',
      to_column: 'campaign_code',
      cardinality: '1:N',
      auto_joinable: true,
      sample_n: '100',
      match_n: '100',
      containment: '1',
    },
  },
  {
    id: 'semantic-join-many-many',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'tag_code',
    gloss: '两侧多对多关系',
    source: 'INFERRED',
    evidence: 'NAME',
    verified: 'NONE',
    status: 'CONFIRMED',
    detail: {
      to_object: 'tag_links',
      to_column: 'tag_code',
      cardinality: 'N:N',
    },
  },
  {
    id: 'semantic-join-not-unique',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'external_ref',
    gloss: '目标列唯一性未确认的关系',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'CONFIRMED',
    status: 'CONFIRMED',
    detail: {
      to_object: 'external_records',
      to_column: 'ref',
      cardinality: 'N:1',
      auto_joinable: false,
    },
  },
  {
    id: 'semantic-join-poly-composite-stored-care',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'entity_id',
    gloss: '多态复合关系的原始提醒必须原样投影',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'CONFIRMED',
    status: 'CONFIRMED',
    detail: {
      to_object: 'entities',
      to_column: 'id',
      join_kind: 'POLYMORPHIC',
      discriminator_column: 'entity_type',
      discriminator_value: [],
      composite_columns: ['id', 'partition_at'],
      care_reason: 'fixture 原样 care：已包含复合键提醒，不得再次拼接',
    },
  },
  {
    id: 'semantic-join-primitive-detail',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'primitive_target_id',
    gloss: 'detail primitive 按后端 String.valueOf 投影',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'UNDECIDABLE',
    status: 'CONFIRMED',
    detail: {
      to_object: true,
      to_column: [],
      join_kind: { future: 'kind' },
      cardinality: ['1', 'N'],
      verify_note: { reason: 'too_small' },
    },
  },
  {
    id: 'semantic-join-rejected-lowercase',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'rejected_customer_id',
    gloss: 'lowercase rejected 也绝不能冒充可注入关系',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'rejected',
    status: 'CONFIRMED',
    detail: {
      to_object: 'customers',
      to_column: 'id',
      join_kind: 'POLYMORPHIC',
      discriminator_column: 'customer_type',
      discriminator_value: 'REJECTED_JOIN_SECRET',
      care_reason: 'REJECTED_CARE_SECRET',
    },
  },
  {
    id: 'semantic-join-unknown-verified',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'future_customer_id',
    gloss: '未知验证枚举不能默认放行',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'FUTURE_VERDICT',
    status: 'CONFIRMED',
    detail: {
      to_object: 'customers',
      to_column: 'id',
      join_kind: 'POLYMORPHIC',
      discriminator_column: 'customer_type',
      discriminator_value: 'UNKNOWN_JOIN_SECRET',
      care_reason: 'UNKNOWN_CARE_SECRET',
    },
  },
  {
    id: 'semantic-join-missing-endpoint',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'missing_column_id',
    gloss: '缺完整 endpoint 的关系不能注入',
    source: 'INFERRED',
    evidence: 'NAME',
    verified: 'NONE',
    status: 'DRAFT',
    detail: {
      to_object: 'customers',
      join_kind: 'POLYMORPHIC',
      discriminator_column: 'customer_type',
      discriminator_value: 'MALFORMED_JOIN_SECRET',
      care_reason: 'MALFORMED_CARE_SECRET',
    },
  },
  {
    id: 'semantic-join-probed-secret',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'probed_target_id',
    gloss: '曾按样本值探查但没留判别值',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'UNDECIDABLE',
    status: 'CONFIRMED',
    detail: {
      to_object: 'targets',
      to_column: 'id',
      join_kind: 'POLYMORPHIC',
      discriminator_column: 'target_type',
      probed_with_sample_values: true,
      care_reason: "target_type = 'VIP_SECRET' 时才指向 targets",
    },
  },
  {
    id: 'semantic-join-null-secret',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'cleared_target_id',
    gloss: '判别值键仍在但值已清空',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'UNDECIDABLE',
    status: 'CONFIRMED',
    detail: {
      to_object: 'targets',
      to_column: 'id',
      join_kind: 'POLYMORPHIC',
      discriminator_column: 'target_type',
      discriminator_value: null,
      probed_with_sample_values: false,
      care_reason: "target_type = 'NULL_KEY_SECRET' 时才指向 targets",
    },
  },
  {
    id: 'semantic-join-composite',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'partitioned_customer_id',
    gloss: '目标端使用复合唯一键的关系',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'WEAK',
    status: 'CONFIRMED',
    detail: {
      to_object: 'customers_p',
      to_column: 'id',
      join_kind: 'COMPOSITE',
      composite_columns: ['id', 'created_at'],
    },
  },
  {
    id: 'semantic-join-weak-simple',
    scope: 'JOIN',
    objectName: 'orders',
    fieldName: 'weak_customer_id',
    gloss: '默认 SIMPLE 但只有部分取值命中的关系',
    source: 'INFERRED',
    evidence: 'DATA',
    verified: 'WEAK',
    status: 'CONFIRMED',
    detail: {
      to_object: 'customers',
      to_column: 'id',
      sample_n: '10',
      match_n: '4',
      containment: '0.4',
    },
  },
  {
    id: 'semantic-human-metric',
    scope: 'METRIC',
    objectName: '',
    fieldName: '',
    term: ' ROI ',
    gloss: 'ROI = 净收益 / 投入成本',
    source: 'HUMAN',
    evidence: 'GUESS',
    verified: 'NONE',
    status: 'CONFIRMED',
    answeredName: '财务负责人',
  },
  {
    id: 'semantic-answered-caveat',
    scope: 'CAVEAT',
    objectName: '',
    fieldName: '',
    term: 'roi',
    gloss: 'ROI 到底按含税还是不含税计算？',
    source: 'INFERRED',
    evidence: null,
    verified: 'NONE',
    status: 'DRAFT',
  },
];

const isVisible = (locator, timeout = 3_000) =>
  locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);

const hasNoHorizontalOverflow = (locator) =>
  locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);

export default async function run() {
  const r = reporter('semantic-workbench');
  const { browser, page } = await launchBrowser();
  let connector = { ...baseConnector };
  const rows = semanticRows;
  let detailFails = false;
  let detailNotFound = false;
  let semanticFails = false;
  let deriveRequests = 0;
  let deriveDetailReads = 0;
  let deriveTracking = false;
  let deriveMode = 'terminal';
  let terminalRowsPublished = false;
  let terminalSemanticReads = 0;
  const deriveObservedStatuses = [];
  let deleteRequests = 0;
  const unexpectedWrites = [];

  try {
    await login(page);
    await page.addInitScript(() => {
      // 生产仍用 90 秒；fixture 只把状态机时钟压短，避免测试真的等 90 秒。
      window.__JM_SEMANTIC_CLAIM_WAIT_TIMEOUT_MS__ = 30_000;
    });

    await page.route('**/data/admin/connectors', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(envelope([connector])),
        });
        return;
      }
      const request = route.request();
      if (request.method() !== 'GET') {
        unexpectedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
        await route.fulfill({
          status: 418,
          contentType: 'application/json',
          body: JSON.stringify(failedEnvelope('fixture 拒绝未声明的写请求')),
        });
        return;
      }
      await route.fallback();
    });

    await page.route('**/data/admin/connectors/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;
      const method = request.method();

      if (pathname === `${SEMANTIC_PATH}/derive` && method === 'POST') {
        deriveRequests += 1;
        if (deriveMode === 'terminal') {
          deriveDetailReads = 0;
          deriveTracking = true;
          terminalRowsPublished = false;
          terminalSemanticReads = 0;
          deriveObservedStatuses.length = 0;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            envelope(
              deriveMode === 'not-started'
                ? { started: false, note: 'fixture 后台没有接受任务', error: '队列已关闭' }
                : { started: true },
            ),
          ),
        });
        return;
      }

      if (pathname === '/data/admin/connectors/kinds' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            envelope([
              {
                kind: 'MYSQL',
                displayName: 'MySQL',
                capabilities: ['query', 'describe'],
                fields: [],
              },
            ]),
          ),
        });
        return;
      }

      if (pathname.startsWith(`${SEMANTIC_PATH}/`) && method === 'DELETE') {
        deleteRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(envelope({ deleted: false, removed: '0' })),
        });
        return;
      }

      if (pathname === SEMANTIC_PATH && method === 'GET') {
        if (terminalRowsPublished) terminalSemanticReads += 1;
        const semanticPayload = terminalRowsPublished
          ? rows.map((row) =>
              row.id === 'semantic-row-1'
                ? { ...row, gloss: '终态刷新后的字段 1 业务含义' }
                : row,
            )
          : rows;
        await route.fulfill({
          // data-service 的业务异常仍走 HTTP 200，由非成功信封触发 client.ts 的 BizError。
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            semanticFails
              ? failedEnvelope('fixture 语义层读取失败')
              : envelope(semanticPayload),
          ),
        });
        return;
      }

      if (pathname === DETAIL_PATH && method === 'GET') {
        let detailData = connector;
        if (!detailNotFound && !detailFails && deriveTracking) {
          deriveDetailReads += 1;
          if (deriveDetailReads <= 3) {
            detailData = {
              ...connector,
              semanticStatus: 'READY',
              semanticNote: `已进入队列，前面还有 ${4 - deriveDetailReads} 个任务`,
            };
          } else if (deriveDetailReads <= 5) {
            connector = {
              ...connector,
              semanticStatus: 'RUNNING',
              semanticClaimAt: '2026-09-27T11:30:00+08:00',
              semanticNote: '正在生成语义层……',
            };
            detailData = connector;
          } else {
            connector = {
              ...connector,
              semanticStatus: 'READY',
              semanticSyncedAt: '2026-09-27T11:31:00+08:00',
              semanticClaimAt: '2026-09-27T11:30:00+08:00',
              semanticNote: 'fixture 终态已发布',
            };
            detailData = connector;
            terminalRowsPublished = true;
            deriveTracking = false;
          }
          deriveObservedStatuses.push(detailData.semanticStatus);
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            detailNotFound
              ? failedEnvelope('连接不存在', '4004')
              : detailFails
                ? failedEnvelope('fixture 连接详情读取失败')
                : envelope(detailData),
          ),
        });
        return;
      }

      if (method !== 'GET') {
        unexpectedWrites.push(`${method} ${pathname}`);
        await route.fulfill({
          status: 418,
          contentType: 'application/json',
          body: JSON.stringify(failedEnvelope('fixture 拒绝未声明的写请求')),
        });
        return;
      }
      await route.fallback();
    });

    const openFixture = async () => {
      await page.goto(`${CONFIG.baseUrl}/console/connectors/${CONNECTOR_ID}/semantic`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByTestId('semantic-workbench').waitFor({ state: 'visible', timeout: 10_000 });
    };

    await openFixture();
    await page.screenshot({ path: shot('semantic-workbench.png'), fullPage: true });

    r.ok('独立语义工作台可深链直达', await page.getByTestId('semantic-workbench').isVisible());
    r.ok('语义列表使用 labelled section，不产生嵌套 main', (await page.locator('main main').count()) === 0);
    r.ok(
      '连接级状态与 coverage 是两个独立区域',
      (await page.getByTestId('semantic-status').count()) === 1 &&
        (await page.getByTestId('semantic-coverage').count()) === 1,
    );
    const coverageText = (await page.getByTestId('semantic-coverage').textContent()) ?? '';
    r.ok(
      'PARTIAL 同时保留已知与未知 gap',
      coverageText.includes('有表没进说明书') && coverageText.includes('未知缺口（FUTURE_GAP）'),
    );
    const tierEditLink = page.getByRole('link', { name: '修改档位', exact: true });
    r.ok(
      '档位修改链接到连接编辑语义治理区',
      (await tierEditLink.getAttribute('href')) ===
        `/console/connectors?connector=${CONNECTOR_ID}&action=edit&section=semantic`,
    );

    const scopeRail = page.getByTestId('semantic-scope-rail');
    const scopeText = (await scopeRail.textContent()) ?? '';
    r.ok(
      'scope 固定顺序完整且未知收尾',
      ['业务口径', '待澄清的歧义', '表用途', '字段含义', '表关系', '未知分类'].every(
        (label, index, labels) =>
          scopeText.includes(label) &&
          (index === 0 || scopeText.indexOf(label) > scopeText.indexOf(labels[index - 1])),
      ),
    );
    r.ok('纯前端需关注筛选常驻', scopeText.includes('需关注'));

    await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
    await page.locator('button.semantic-row-card').first().click();
    r.ok('20 条阈值后分页', await page.locator('.semantic-pagination').isVisible());
    const renderedRows = await page.locator('button.semantic-row-card').count();
    r.ok('首页只渲染 20 条', renderedRows === 20, String(renderedRows));

    const firstRowCard = page.locator('button.semantic-row-card').first();
    const accessibleRefs = await firstRowCard.evaluate((element) => {
      const textOf = (attribute) =>
        (element.getAttribute(attribute) ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ');
      return {
        ariaLabel: element.getAttribute('aria-label'),
        labelled: textOf('aria-labelledby'),
        described: textOf('aria-describedby'),
      };
    });
    r.ok(
      '行卡 accessible name 保留锚点与说明，可信链进入 description',
      accessibleRefs.ariaLabel === null &&
        accessibleRefs.labelled.includes('orders.field_1') &&
        accessibleRefs.labelled.includes('字段 1 的业务含义') &&
        ['人工确认', '人给的定义', '未验证', '已确认'].every((text) =>
          accessibleRefs.described.includes(text),
        ),
      JSON.stringify(accessibleRefs),
    );
    const secondRowCard = page.locator('button.semantic-row-card').nth(1);
    await secondRowCard.focus();
    await page.keyboard.press('Enter');
    r.ok(
      '行卡保留原生键盘操作',
      ((await page.locator('[data-testid="semantic-inspector"]:visible h2').first().textContent()) ?? '') ===
        'orders.field_2',
    );
    await firstRowCard.click();

    await page.locator('.semantic-pagination .ant-pagination-next button').click();
    const pageTwoSelected = page.locator('button.semantic-row-card.is-selected');
    r.ok(
      '翻到下一页后 selection 与 Inspector 同步到新页首条',
      (await pageTwoSelected.count()) === 1 &&
        ((await pageTwoSelected.textContent()) ?? '').includes('orders.field_21') &&
        ((await page.locator('[data-testid="semantic-inspector"]:visible h2').first().textContent()) ?? '') ===
          'orders.field_21' &&
        !((await page.locator('[data-testid="semantic-inspector"]:visible').first().textContent()) ?? '').includes(
          '人工确认的口径',
        ),
    );
    await page.locator('.semantic-pagination .ant-pagination-prev button').click();
    await page.locator('button.semantic-row-card.is-selected').first().waitFor({ state: 'visible' });

    const inspector = page.locator('[data-testid="semantic-inspector"]:visible').first();
    const inspectorText = (await inspector.textContent()) ?? '';
    r.ok(
      'Inspector 四区完整',
      ['AI 能看到', 'AI 看不到', '信任与来源', '危险区'].every((label) =>
        inspectorText.includes(label),
      ),
    );
    r.ok(
      'HUMAN 行保留回答人、时间、Trace 与覆盖历史',
      ['业务负责人', 'trace-semantic-fixture', '修改记录'].every((label) =>
        inspectorText.includes(label),
      ),
    );

    await page.locator('.semantic-pagination .ant-pagination-next button').click();
    const ordinaryValueCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '普通字段的渠道代码' });
    await ordinaryValueCard.click();
    const liveInspector = page.locator('[data-testid="semantic-inspector"]:visible').first();
    const ordinaryValueCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      '普通 FIELD 在 SAMPLE_VALUES 投影真实 values / distinct / note',
      ['实际取值WEB、STORE', '去重取值数2', '采集说明fixture 渠道值域已采全'].every(
        (label) => ordinaryValueCurrent.includes(label),
      ),
      ordinaryValueCurrent,
    );

    const staleValueCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '结构已变的渠道代码' });
    await staleValueCard.click();
    const staleValueCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const staleValueRetained =
      (await liveInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      'STALE FIELD 不把旧值域冒充当前注入，真实片段进入 retained',
      staleValueCurrent.includes('结构已经变过') &&
        !staleValueCurrent.includes('OLD_WEB') &&
        staleValueRetained.includes('OLD_WEB、OLD_STORE') &&
        staleValueRetained.includes('fixture 旧结构值域'),
      `${staleValueCurrent} | ${staleValueRetained}`,
    );

    const outcomeValueCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '可能包含个人信息的字段' });
    await outcomeValueCard.click();
    const outcomeValueCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      '普通 FIELD 的 value_domain.note 缺失时按 outcome 还原真实模型说明',
      outcomeValueCurrent.includes('该列疑似个人信息，平台【不采集】它的取值。') &&
        !outcomeValueCurrent.includes('需要时应查询或向用户确认'),
      outcomeValueCurrent,
    );

    await page.locator('.semantic-scope-option').filter({ hasText: '表关系' }).click();
    const validJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '这句 relation gloss' });
    await validJoinCard.click();
    const validJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const validJoinRetained =
      (await liveInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      '合法 JOIN 规范化 verified 并只展示 structured relation facts',
      [
        '本表列（column）customer_id',
        '目标表（to_object）customers',
        '目标列（to_column）id',
        '验证结论（verified）CONFIRMED',
        '基数（cardinality）N:1',
        '可自动 JOIN（auto_joinable）true',
        '依据（basis）依据：库里的数据；已用真实数据采样验证通过，可以直接使用，不必再为它单跑一次 COUNT 自验',
      ].every((label) => validJoinCurrent.includes(label)) &&
        !validJoinCurrent.includes('这句 relation gloss') &&
        validJoinRetained.includes('这句 relation gloss'),
      `${validJoinCurrent} | ${validJoinRetained}`,
    );

    const humanJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '人工补充的关系说明只留库' });
    await humanJoinCard.click();
    const humanJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      'HUMAN JOIN 的 basis 只按后端 evidence=GUESS 投影，不改写成人工依据',
      humanJoinCurrent.includes('验证结论（verified）NONE') &&
        humanJoinCurrent.includes(
          '依据（basis）依据：常识推测，没有外部依据；未经数据验证，依赖它之前先跑一条 COUNT 自验',
        ) &&
        !humanJoinCurrent.includes('人给的定义'),
      humanJoinCurrent,
    );

    const undecidableJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '探查过但样本不足的关系' });
    await undecidableJoinCard.click();
    const undecidableJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      'UNDECIDABLE JOIN 投影后端已探查但判不出与 COUNT action',
      undecidableJoinCurrent.includes('验证结论（verified）UNDECIDABLE') &&
        undecidableJoinCurrent.includes(
          '已经用真实数据查过了，但判不出来（目标表样本太少）。这不等于这条关系不成立，只是这次没能判定；依赖它之前先自己跑一条 COUNT 核一次',
        ),
      undecidableJoinCurrent,
    );

    const oneManyJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '右侧一对多关系' });
    await oneManyJoinCard.click();
    const oneManyJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      '1:N JOIN 投影 measured basis 与先聚合再 join 的 fanout_warning',
      oneManyJoinCurrent.includes(
        '依据：客户库自己的注释；已用真实数据采样验证通过（采样 100 个取值，命中 100（包含率 100.0%）），可以直接使用，不必再为它单跑一次 COUNT 自验',
      ) &&
        oneManyJoinCurrent.includes('风险（fanout_warning）右侧不是唯一键（1:N）') &&
        oneManyJoinCurrent.includes('先在右表上按连接键聚合，再拿聚合结果去 join'),
      oneManyJoinCurrent,
    );

    const manyManyJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '两侧多对多关系' });
    await manyManyJoinCard.click();
    const manyManyJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      'N:N JOIN 投影禁止直接 join 与先聚合/去重指令',
      manyManyJoinCurrent.includes('依据：列名本身；未经数据验证，依赖它之前先跑一条 COUNT 自验') &&
        manyManyJoinCurrent.includes('风险（fanout_warning）两侧都不唯一（N:N）') &&
        manyManyJoinCurrent.includes('只把它当线索，不要直接 join') &&
        manyManyJoinCurrent.includes('先在一侧按连接键聚合或去重，再连'),
      manyManyJoinCurrent,
    );

    const notUniqueJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '目标列唯一性未确认的关系' });
    await notUniqueJoinCard.click();
    const notUniqueJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      'auto_joinable=false JOIN 投影 COUNT 对账 fanout_warning',
      notUniqueJoinCurrent.includes('可自动 JOIN（auto_joinable）false') &&
        notUniqueJoinCurrent.includes('平台没能确认右侧这一列是唯一的') &&
        notUniqueJoinCurrent.includes('动手前先用 COUNT 对一下 join 前后的行数'),
      notUniqueJoinCurrent,
    );

    const storedCareJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '多态复合关系的原始提醒必须原样投影' });
    await storedCareJoinCard.click();
    const storedCareJoinCurrent = liveInspector.locator(
      '.semantic-inspector-section.is-visible',
    );
    const storedCareValue =
      (await storedCareJoinCurrent
        .locator('.semantic-fact-list > div')
        .filter({ hasText: '需当心理由（care_reason）' })
        .locator('dd')
        .textContent()) ?? '';
    const storedCareJoinCurrentText = (await storedCareJoinCurrent.textContent()) ?? '';
    r.ok(
      'POLYMORPHIC + composite 的 stored care 在 tier3 原样投影且容器判别值字符串化',
      storedCareValue === 'fixture 原样 care：已包含复合键提醒，不得再次拼接' &&
        storedCareJoinCurrentText.includes('判别值（discriminator_value）[]') &&
        storedCareJoinCurrentText.includes("必须同时加上 entity_type = '[]' 条件") &&
        storedCareJoinCurrentText.includes('另外，entities.id 只是组合唯一键'),
      `${storedCareValue} | ${storedCareJoinCurrentText}`,
    );

    const primitiveJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: 'detail primitive 按后端 String.valueOf 投影' });
    await primitiveJoinCard.click();
    const primitiveJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      'JOIN detail 非字符串值与后端 stringOrNull / joinKind 一致',
      primitiveJoinCurrent.includes('目标表（to_object）true') &&
        primitiveJoinCurrent.includes('目标列（to_column）[]') &&
        primitiveJoinCurrent.includes('关系形态（join_kind）{FUTURE=KIND}') &&
        primitiveJoinCurrent.includes('基数（cardinality）[1, N]') &&
        primitiveJoinCurrent.includes('已经用真实数据查过，但判不出来（{reason=too_small}）'),
      primitiveJoinCurrent,
    );

    const rejectedJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: 'lowercase rejected' });
    const rejectedJoinCardText = (await rejectedJoinCard.textContent()) ?? '';
    await rejectedJoinCard.click();
    const rejectedJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const rejectedJoinRetained =
      (await liveInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      'lowercase rejected JOIN 按后端归一后整条 withheld',
      !rejectedJoinCurrent.includes('customers.id') &&
        rejectedJoinRetained.includes('lowercase rejected') &&
        rejectedJoinRetained.includes('数据不支持') &&
        !rejectedJoinCardText.includes('REJECTED_JOIN_SECRET') &&
        !rejectedJoinCardText.includes('REJECTED_CARE_SECRET') &&
        !`${rejectedJoinCurrent} ${rejectedJoinRetained}`.includes('REJECTED_JOIN_SECRET') &&
        !`${rejectedJoinCurrent} ${rejectedJoinRetained}`.includes('REJECTED_CARE_SECRET'),
      `${rejectedJoinCurrent} | ${rejectedJoinRetained}`,
    );

    const unknownJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '未知验证枚举' });
    const unknownJoinCardText = (await unknownJoinCard.textContent()) ?? '';
    await unknownJoinCard.click();
    const unknownJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const unknownJoinRetained =
      (await liveInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      '未知 verified JOIN fail-closed 并解释 retained 原因',
      !unknownJoinCurrent.includes('customers.id') &&
        unknownJoinRetained.includes('FUTURE_VERDICT') &&
        unknownJoinRetained.includes('未识别') &&
        !unknownJoinCardText.includes('UNKNOWN_JOIN_SECRET') &&
        !unknownJoinCardText.includes('UNKNOWN_CARE_SECRET') &&
        !`${unknownJoinCurrent} ${unknownJoinRetained}`.includes('UNKNOWN_JOIN_SECRET') &&
        !`${unknownJoinCurrent} ${unknownJoinRetained}`.includes('UNKNOWN_CARE_SECRET'),
      `${unknownJoinCurrent} | ${unknownJoinRetained}`,
    );

    const incompleteJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '缺完整 endpoint' });
    const incompleteJoinCardText = (await incompleteJoinCard.textContent()) ?? '';
    await incompleteJoinCard.click();
    const incompleteJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const incompleteJoinRetained =
      (await liveInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      '缺 to_column 的 JOIN 不注入并说明 endpoint 不完整',
      !incompleteJoinCurrent.includes('关系端点orders.') &&
        incompleteJoinRetained.includes('目标列') &&
        incompleteJoinRetained.includes('不完整') &&
        !incompleteJoinCardText.includes('MALFORMED_JOIN_SECRET') &&
        !incompleteJoinCardText.includes('MALFORMED_CARE_SECRET') &&
        !`${incompleteJoinCurrent} ${incompleteJoinRetained}`.includes('MALFORMED_JOIN_SECRET') &&
        !`${incompleteJoinCurrent} ${incompleteJoinRetained}`.includes('MALFORMED_CARE_SECRET'),
      `${incompleteJoinCurrent} | ${incompleteJoinRetained}`,
    );

    const compositeJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '目标端使用复合唯一键的关系' });
    await compositeJoinCard.click();
    const compositeJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      'COMPOSITE 展示后端先核唯一性的 condition，不臆造同名列必须全部对上',
      compositeJoinCurrent.includes(
        '平台只确认了 本表 partitioned_customer_id → customers_p.id 这一对',
      ) &&
        compositeJoinCurrent.includes('不要按同名列去配') &&
        compositeJoinCurrent.includes('COUNT(*)') &&
        !compositeJoinCurrent.includes('必须全部对上'),
      compositeJoinCurrent,
    );

    const weakSimpleJoinCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '默认 SIMPLE 但只有部分取值命中的关系' });
    await weakSimpleJoinCard.click();
    const weakSimpleJoinCurrent =
      (await liveInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    r.ok(
      '缺 join_kind 的 SIMPLE + WEAK 展示后端 unreliable care / condition',
      weakSimpleJoinCurrent.includes('采样验证只有一部分取值能在对面找到') &&
        weakSimpleJoinCurrent.includes('采样 10 个取值，命中 4（包含率 40.0%）') &&
        weakSimpleJoinCurrent.includes('常见成因是多态外键或复合键') &&
        weakSimpleJoinCurrent.includes('自己跑 COUNT 核对') &&
        !weakSimpleJoinCurrent.includes('必须全部对上'),
      weakSimpleJoinCurrent,
    );

    connector = {
      ...baseConnector,
      semanticDataTier: 'DERIVED_STATS',
      semanticDataTierLabel: '第 2 档 · 派生统计',
      semanticDataTierEgress: '只允许派生统计出库。',
    };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
    await page.locator('.semantic-pagination .ant-pagination-next button').click();
    const valueProfileCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '值域阶段补写：华东、华南' });
    await valueProfileCard.click();
    const valueProfileInspector = page.locator('[data-testid="semantic-inspector"]:visible').first();
    const valueProfileCurrent =
      (await valueProfileInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const valueProfileRetained =
      (await valueProfileInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    const valueProfileWarning =
      (await valueProfileInspector.locator('.semantic-inspector-warning').textContent().catch(() => '')) ?? '';
    const legacyValueProfileCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '旧版值域补写：北区、南区' });
    await legacyValueProfileCard.click();
    const legacyCurrent =
      (await valueProfileInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const legacyRetained =
      (await valueProfileInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      'DERIVED_STATS 按后端 K-3 挡住 origin 与兼容旧值域行的 gloss',
      !valueProfileCurrent.includes('值域阶段补写：华东、华南') &&
        valueProfileRetained.includes('值域阶段补写：华东、华南') &&
        valueProfileWarning.includes('第 3 档') &&
        !legacyCurrent.includes('旧版值域补写：北区、南区') &&
        legacyRetained.includes('旧版值域补写：北区、南区'),
    );

    const lowerTierOrdinaryCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: '普通字段的渠道代码' });
    await lowerTierOrdinaryCard.click();
    const lowerTierOrdinaryCurrent =
      (await valueProfileInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const lowerTierOrdinaryRetained =
      (await valueProfileInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      '普通 FIELD 降档后保留 gloss，但真实值域只进 retained',
      lowerTierOrdinaryCurrent.includes('普通字段的渠道代码') &&
        lowerTierOrdinaryCurrent.includes('没有确认开放第 3 档') &&
        !lowerTierOrdinaryCurrent.includes('WEB、STORE') &&
        !lowerTierOrdinaryCurrent.includes('fixture 渠道值域已采全') &&
        lowerTierOrdinaryRetained.includes('WEB、STORE') &&
        lowerTierOrdinaryRetained.includes('fixture 渠道值域已采全'),
      `${lowerTierOrdinaryCurrent} | ${lowerTierOrdinaryRetained}`,
    );

    await page.locator('.semantic-scope-option').filter({ hasText: '表关系' }).click();
    for (const [cardText, secret] of [
      ['曾按样本值探查但没留判别值', 'VIP_SECRET'],
      ['判别值键仍在但值已清空', 'NULL_KEY_SECRET'],
    ]) {
      await page.locator('button.semantic-row-card').filter({ hasText: cardText }).click();
      const current =
        (await valueProfileInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
      const retained =
        (await valueProfileInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
      r.ok(
        `DERIVED_STATS 对 ${cardText} 的旧 care_reason fail-closed`,
        !current.includes(secret) &&
          current.includes('疑似多态外键') &&
          current.includes('每个取值都指向 targets 时它只是分类列，不要加这个条件') &&
          !current.includes('需要 target_type 的类型条件') &&
          retained.includes(secret) &&
          retained.includes('AI 看不到'),
        `${current} | ${retained}`,
      );
    }

    connector = { ...baseConnector };
    await page.reload({ waitUntil: 'domcontentloaded' });
    const attentionListText = (await page.getByTestId('semantic-row-list').textContent()) ?? '';
    r.ok(
      '已有非 STALE METRIC 的同 term CAVEAT 不再进入需关注',
      !attentionListText.includes('ROI 到底按含税还是不含税计算？'),
      attentionListText,
    );
    await page.locator('.semantic-scope-option').filter({ hasText: '待澄清的歧义' }).click();
    const answeredCaveatCard = page
      .locator('button.semantic-row-card')
      .filter({ hasText: 'ROI 到底按含税还是不含税计算？' });
    const answeredCaveatCardText = (await answeredCaveatCard.textContent()) ?? '';
    await answeredCaveatCard.click();
    const caveatInspector = page.locator('[data-testid="semantic-inspector"]:visible').first();
    const caveatCurrent =
      (await caveatInspector.locator('.semantic-inspector-section.is-visible').textContent()) ?? '';
    const caveatRetained =
      (await caveatInspector.locator('.semantic-inspector-section.is-retained').textContent()) ?? '';
    r.ok(
      '同 term CAVEAT 仍可审计但不再声称注入模型',
      !answeredCaveatCardText.includes('等待业务方回答') &&
        !caveatCurrent.includes('ROI 到底按含税还是不含税计算？') &&
        caveatRetained.includes('ROI 到底按含税还是不含税计算？') &&
        ((await caveatInspector.locator('.semantic-inspector-warning').textContent()) ?? '').includes(
          '已有口径回答',
        ),
    );
    await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
    await page.locator('button.semantic-row-card').first().click();

    const headerDeriveButton = page.locator('.semantic-header-topline .ant-btn-primary');
    await headerDeriveButton.click();
    const deriveModal = page.locator('.ant-modal-content:visible');
    const deriveCopy = (await deriveModal.textContent()) ?? '';
    r.ok(
      '重跑确认说明只动机器生成的说明、在后台生成',
      ['只更新机器生成的说明', '人工确认的口径和库注释不会动', '在后台生成'].every(
        (label) => deriveCopy.includes(label),
      ) && !deriveCopy.includes('一次模型调用，对客户系统零访问'),
      deriveCopy,
    );
    await page.getByRole('button', { name: '开始生成', exact: true }).last().click();
    const claimWaitVisible = await isVisible(page.getByTestId('semantic-derive-claim-wait'), 3_000);
    const duplicateDispatchBlocked = await headerDeriveButton.isDisabled();
    const runningObserved = await isVisible(
      page.getByTestId('semantic-status').getByText('生成中', { exact: true }),
      15_000,
    );
    r.ok(
      '派发后跨多次旧 READY/queued 持续等待直到观察 RUNNING',
      claimWaitVisible &&
        duplicateDispatchBlocked &&
        runningObserved &&
        deriveObservedStatuses.slice(0, 3).every((status) => status === 'READY') &&
        deriveObservedStatuses.includes('RUNNING') &&
        deriveRequests === 1,
      JSON.stringify({ runningObserved, deriveObservedStatuses, deriveRequests }),
    );

    const terminalReadyObserved = await isVisible(
      page.getByTestId('semantic-status').getByText('已生成', { exact: true }),
      15_000,
    );
    await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
    const terminalPrev = page.locator('.semantic-pagination .ant-pagination-prev button');
    if (await terminalPrev.isEnabled().catch(() => false)) await terminalPrev.click();
    const terminalRowUpdated = await isVisible(
      page.getByText('终态刷新后的字段 1 业务含义', { exact: true }).first(),
      15_000,
    );
    r.ok(
      'RUNNING→READY 停轮询前 terminal rows 强制 refetch exactly once',
      terminalReadyObserved && terminalRowUpdated && terminalSemanticReads === 1,
      JSON.stringify({
        terminalReadyObserved,
        terminalRowUpdated,
        terminalSemanticReads,
      }),
    );

    deriveMode = 'not-started';
    await headerDeriveButton.click();
    await page.getByRole('button', { name: '开始生成', exact: true }).last().click();
    const notStartedNotice = page.getByTestId('semantic-derive-not-started');
    r.ok(
      'started=false 展示后端 note/error 且不创建 claimWait',
      (await isVisible(notStartedNotice, 3_000)) &&
        ((await notStartedNotice.textContent()) ?? '').includes('fixture 后台没有接受任务') &&
        ((await notStartedNotice.textContent()) ?? '').includes('队列已关闭') &&
        !(await isVisible(page.getByTestId('semantic-derive-claim-wait'), 300)) &&
        !(await headerDeriveButton.isDisabled()),
    );

    deriveMode = 'stuck';
    const timeoutOverrideApplied = await page.evaluate(() => {
      window.__JM_SEMANTIC_CLAIM_WAIT_TIMEOUT_MS__ = 250;
      return window.__JM_SEMANTIC_CLAIM_WAIT_TIMEOUT_MS__ === 250;
    });
    await headerDeriveButton.click();
    await page.getByRole('button', { name: '开始生成', exact: true }).last().click();
    const timeoutAction = page.getByRole('button', {
      name: '重新提交',
      exact: true,
    });
    const timeoutReached = await isVisible(timeoutAction, 10_000);
    if (timeoutReached) await timeoutAction.click();
    const retryModal = page.locator('.ant-modal-content:visible');
    const retryModalVisible = timeoutReached && (await isVisible(retryModal, 5_000));
    const claimWaitCleared = await page
      .getByTestId('semantic-derive-claim-wait')
      .waitFor({ state: 'hidden', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    r.ok(
      '90s 超时状态机可停止等待、清锁并重新打开提交确认',
      timeoutOverrideApplied && timeoutReached && retryModalVisible && claimWaitCleared,
      JSON.stringify({ timeoutOverrideApplied, timeoutReached, retryModalVisible, claimWaitCleared }),
    );
    if (await retryModal.isVisible().catch(() => false)) await page.keyboard.press('Escape');

    r.ok('重跑请求被 fixture 拦截，未访问真实后端', deriveRequests === 3);

    await page
      .locator('[data-testid="semantic-inspector"]:visible .ant-btn-dangerous')
      .first()
      .click();
    const deleteModal = page.locator('.ant-modal-content:visible');
    const deleteCopy = (await deleteModal.textContent()) ?? '';
    r.ok(
      '删除确认说明不可恢复、机器生成的会回来、人工口径连修改记录一起消失',
      ['删除后无法恢复', '重新生成后会再出现', '连同修改记录一起消失'].every(
        (label) => deleteCopy.includes(label),
      ),
    );
    semanticFails = true;
    detailFails = true;
    await deleteModal.locator('.ant-btn-primary.ant-btn-dangerous').click();
    await page.waitForTimeout(150);
    r.ok('删除请求被 fixture 拦截，未写入真实后端', deleteRequests === 1);
    r.ok(
      'removed=0 如实提示已经不在',
      await isVisible(page.getByText('这条说明已不存在。'), 2_000),
    );

    const backgroundSemanticRetry = page.getByRole('button', { name: '重试语义层', exact: true });
    const backgroundDetailRetry = page.getByRole('button', { name: '重试连接详情', exact: true });
    const semanticRefreshFailed = await isVisible(backgroundSemanticRetry, 10_000);
    const detailRefreshFailed = await isVisible(backgroundDetailRetry, 10_000);
    r.ok(
      '成功内容后的语义刷新失败保留旧条目与重试',
      semanticRefreshFailed &&
        (await page.locator('button.semantic-row-card').count()) === 20 &&
        (await isVisible(page.getByText('fixture 语义层读取失败', { exact: true }))),
    );
    r.ok(
      '成功内容后的连接详情刷新失败保留工作台与重试',
      detailRefreshFailed &&
        (await page.getByTestId('semantic-workbench').isVisible()) &&
        (await isVisible(page.getByText('fixture 连接详情读取失败', { exact: true }))),
    );
    semanticFails = false;
    detailFails = false;
    if (semanticRefreshFailed) await backgroundSemanticRetry.click();
    if (detailRefreshFailed) await backgroundDetailRetry.click();
    await page
      .getByText('fixture 语义层读取失败', { exact: true })
      .waitFor({ state: 'hidden' });
    await page
      .getByText('fixture 连接详情读取失败', { exact: true })
      .waitFor({ state: 'hidden' });

    connector = { ...baseConnector, semanticCoverage: 'FUTURE_COVERAGE', semanticGaps: [] };
    await page.reload({ waitUntil: 'domcontentloaded' });
    const unknownCoverage = (await page.getByTestId('semantic-coverage').textContent()) ?? '';
    r.ok(
      '未知 coverage 显式保留原值',
      unknownCoverage.includes('未知覆盖度（FUTURE_COVERAGE）'),
      unknownCoverage,
    );

    connector = { ...baseConnector, semanticCoverage: null, semanticGaps: null };
    await page.reload({ waitUntil: 'domcontentloaded' });
    const nullCoverage = (await page.getByTestId('semantic-coverage').textContent()) ?? '';
    r.ok(
      'null coverage 表示没跑过，不是残缺或未知枚举',
      nullCoverage.includes('尚未成功生成过'),
      nullCoverage,
    );

    const statusCases = [
      ['NONE', '未生成', '开始生成', false],
      ['RUNNING', '生成中', '重新生成', true],
      ['READY', '已生成', '重新生成', false],
      ['FAILED', '失败', '重新生成', false],
      ['NOT_APPLICABLE', '不适用', '重新生成', true],
      ['FUTURE_STATUS', '未知（FUTURE_STATUS）', '重新生成', false],
    ];
    for (const [status, label, action, disabled] of statusCases) {
      connector = {
        ...baseConnector,
        semanticStatus: status,
        semanticCoverage: status === 'NONE' ? null : 'COMPLETE',
        semanticClaimAt: status === 'RUNNING' ? '2026-09-27T11:00:00+08:00' : null,
      };
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('semantic-status').waitFor({ state: 'visible' });
      const statusText = (await page.getByTestId('semantic-status').textContent()) ?? '';
      const actionButton = page.locator('.semantic-header-topline .ant-btn-primary');
      r.ok(
        `${status} 状态、动作与禁用规则`,
        statusText.includes(label) &&
          ((await actionButton.textContent()) ?? '').trim() === action &&
          (await actionButton.isDisabled()) === disabled,
      );
      if (status === 'FAILED') {
        await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
        await page.locator('button.semantic-row-card').first().click();
        const failedInspectorText =
          (await page.locator('[data-testid="semantic-inspector"]:visible').first().textContent()) ?? '';
        r.ok(
          'FAILED 明示保留旧成功内容且不再宣称只靠表列名',
          statusText.includes('上一次成功的说明仍保留') &&
            !statusText.includes('只能靠表名和列名猜'),
          statusText,
        );
        r.ok(
          'FAILED Inspector 按行级规则说明旧内容的模型可见性',
          failedInspectorText.includes('上一次成功的说明仍保留'),
          failedInspectorText,
        );
      }
    }

    connector = {
      ...baseConnector,
      semanticStatus: 'FAILED',
      semanticSyncedAt: null,
      semanticCoverage: 'COMPLETE',
      semanticGaps: [],
    };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('semantic-status').waitFor({ state: 'visible' });
    const failedWithoutHistoryText =
      (await page.getByTestId('semantic-status').textContent()) ?? '';
    await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
    await page.locator('button.semantic-row-card').first().click();
    const failedWithoutHistoryInspector =
      (await page.locator('[data-testid="semantic-inspector"]:visible').first().textContent()) ?? '';
    r.ok(
      'FAILED 无成功时间戳时不声称存在上一版成功内容',
      !failedWithoutHistoryText.includes('上一次成功的说明仍保留') &&
        failedWithoutHistoryText.includes('之前的说明仍保留') &&
        !failedWithoutHistoryInspector.includes('上一次成功的说明仍保留') &&
        failedWithoutHistoryInspector.includes('之前的说明仍保留'),
      `${failedWithoutHistoryText} | ${failedWithoutHistoryInspector}`,
    );

    connector = { ...baseConnector, semanticCoverage: 'COMPLETE', semanticGaps: [] };
    semanticFails = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const semanticRetry = page.getByRole('button', { name: '重试语义层', exact: true });
    const semanticRetryVisible = await isVisible(semanticRetry, 15_000);
    r.ok('语义层首次读取失败提供重试', semanticRetryVisible);
    semanticFails = false;
    if (semanticRetryVisible) {
      await semanticRetry.click();
      r.ok('语义层重试后恢复内容', await isVisible(page.getByTestId('semantic-row-list'), 5_000));
    }

    detailFails = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const detailRetry = page.getByRole('button', { name: '重试连接详情', exact: true });
    const detailRetryVisible = await isVisible(detailRetry, 15_000);
    r.ok(
      '连接详情首次读取失败保留原因、重试与返回入口',
      detailRetryVisible &&
        (await isVisible(page.getByText('fixture 连接详情读取失败', { exact: true }))) &&
        (await isVisible(page.getByRole('button', { name: '返回数据连接', exact: true }))),
    );
    detailFails = false;
    if (detailRetryVisible) {
      await detailRetry.click();
      r.ok('连接详情重试后恢复工作台', await isVisible(page.getByTestId('semantic-workbench'), 5_000));
    } else {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('semantic-workbench').waitFor({ state: 'visible' });
    }

    detailNotFound = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    r.ok(
      '真实 4004 非成功信封进入连接不存在分支并提供返回入口',
      (await isVisible(page.getByText('连接不存在或已删除', { exact: true }), 15_000)) &&
        (await isVisible(page.getByText('连接不存在', { exact: true }))) &&
        (await isVisible(page.getByRole('button', { name: '返回数据连接', exact: true }))) &&
        (await page.getByRole('button', { name: '重试连接详情', exact: true }).count()) === 0,
    );
    detailNotFound = false;
    connector = { ...baseConnector, semanticCoverage: 'COMPLETE', semanticGaps: [] };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('semantic-workbench').waitFor({ state: 'visible' });

    await page.setViewportSize({ width: 1280, height: 800 });
    r.ok(
      '1280px 保留桌面三栏 Inspector',
      await page.locator('.semantic-inspector-desktop').isVisible().catch(() => false),
    );
    r.ok(
      '1280px 工作台与关键网格没有横向溢出',
      (await hasNoHorizontalOverflow(page.getByTestId('semantic-workbench'))) &&
        (await hasNoHorizontalOverflow(page.locator('.semantic-workbench-grid'))),
    );

    await page.setViewportSize({ width: 1024, height: 800 });
    const inspectorTrigger = page.getByRole('button', { name: '查看所选详情' });
    if (!(await inspectorTrigger.isEnabled().catch(() => false))) {
      await page.locator('.semantic-scope-option').filter({ hasText: '字段含义' }).click();
      await page.locator('button.semantic-row-card').first().click();
    }
    r.ok(
      '1024px 收起桌面 Inspector 并保留真实按钮入口',
      !(await page.locator('.semantic-inspector-desktop').isVisible()) &&
        (await inspectorTrigger.isVisible().catch(() => false)),
    );
    r.ok(
      '1024px 工作台与关键网格没有横向溢出',
      (await hasNoHorizontalOverflow(page.getByTestId('semantic-workbench'))) &&
        (await hasNoHorizontalOverflow(page.locator('.semantic-workbench-grid'))),
    );
    await inspectorTrigger.click();
    const drawerWrapper = page.locator('.ant-drawer-content-wrapper:visible').last();
    const drawerBox = await drawerWrapper.boundingBox();
    r.ok('1024px 窄屏 Inspector 整页呈现', Boolean(drawerBox && drawerBox.width >= 1023), String(drawerBox?.width));
    await page.locator('.semantic-inspector-drawer .ant-drawer-close').click();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transitionDuration = await page
      .locator('.semantic-row-card')
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration)
      .catch(() => '0s');
    const reduced = transitionDuration.split(',').every((duration) => {
      const value = Number.parseFloat(duration);
      return duration.trim().endsWith('ms') ? value <= 0.01 : value <= 0.00001;
    });
    r.ok('reduced-motion 会压低动效时长', reduced, transitionDuration);

    await tierEditLink.click();
    const formDrawer = page.getByTestId('connector-form-drawer');
    await formDrawer.waitFor({ state: 'visible', timeout: 10_000 });
    const tierField = page.getByTestId('connector-form-semantic-tier');
    const tierCombobox = tierField.getByRole('combobox');
    const editUrl = new URL(page.url());
    r.ok(
      '修改档位真实打开编辑 Drawer 的可编辑档位控件',
      editUrl.pathname === '/console/connectors' &&
        editUrl.searchParams.get('connector') === CONNECTOR_ID &&
        editUrl.searchParams.get('action') === 'edit' &&
        editUrl.searchParams.get('section') === 'semantic' &&
        (await tierCombobox.isVisible()) &&
        (await tierCombobox.isEnabled()),
    );

    connector = {
      ...baseConnector,
      semanticStatus: 'FAILED',
      semanticSyncedAt: '2026-09-27T10:00:00+08:00',
      semanticCoverage: 'COMPLETE',
      semanticGaps: [],
    };
    await page.goto(`${CONFIG.baseUrl}/console/connectors`, { waitUntil: 'domcontentloaded' });
    const failedConnectorCard = page
      .getByTestId('connector-card')
      .filter({ hasText: '语义工作台 Fixture' });
    await failedConnectorCard.waitFor({ state: 'visible', timeout: 10_000 });
    const failedWithHistoryCardText = (await failedConnectorCard.textContent()) ?? '';
    r.ok(
      'FAILED 连接卡有成功时间戳时保守说明旧内容仍按行级规则生效',
      failedWithHistoryCardText.includes('上一次的说明') &&
        !failedWithHistoryCardText.includes('只能凭结构名称'),
      failedWithHistoryCardText,
    );

    connector = { ...connector, semanticSyncedAt: null };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await failedConnectorCard.waitFor({ state: 'visible', timeout: 10_000 });
    const failedWithoutHistoryCardText = (await failedConnectorCard.textContent()) ?? '';
    r.ok(
      'FAILED 连接卡无成功时间戳时不臆断旧内容或只靠结构名',
      failedWithoutHistoryCardText.includes('无法确认') &&
        !failedWithoutHistoryCardText.includes('最近一次成功说明仍') &&
        !failedWithoutHistoryCardText.includes('只能凭结构名称'),
      failedWithoutHistoryCardText,
    );
    r.ok(
      '全程未声明写请求 fail-closed，fixture 没有放行真实后端写入',
      unexpectedWrites.length === 0,
      unexpectedWrites.join(', '),
    );
  } finally {
    await browser.close();
  }
  return r.summary();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = await run();
  process.exit(ok ? 0 : 1);
}
