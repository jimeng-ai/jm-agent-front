// 连接器管理页 + 使用记录抽屉的 UI 实跑校验。
// 只验「渲染得出来、数据接得上、交互点得动」，不替代后端的功能测试。
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const { browser, page } = await launchBrowser();
try {
  await login(page);

  // ---- 连接器列表页 ----
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await page.screenshot({ path: shot('connector-list.png') });

  const bodyText = await page.textContent('body');
  check('页面标题渲染', bodyText.includes('数据连接'));
  check('连接行渲染', bodyText.includes('demo-shop'), '来自真实接口');
  check('类型列显示 displayName 而非 kind', bodyText.includes('MySQL'));
  check('能力列已回填', bodyText.includes('能查') && bodyText.includes('能自描述'));
  check('只读验证列显示「已验证」', bodyText.includes('已验证'));

  // ---- 新建弹窗：schema 驱动表单 ----
  await page.click('button:has-text("新建连接")');
  await sleep(1200);
  // 默认选中的是类型清单的第一项（注册表顺序是 [HTTP, MYSQL]，所以默认是 HTTP）。
  let modal = await page.textContent('.ant-modal');
  await page.screenshot({ path: shot('connector-create-http.png') });
  check('默认类型按 schema 渲染 HTTP 字段', modal.includes('接口基地址') && !modal.includes('库名'));

  // 切类型 → 字段应【整组】换掉。前端没有任何 if (kind === ...) 分支，
  // 换掉这件事完全由后端下发的 schema 驱动——这是「新增类型前端零改动」的实证。
  await page.click('.ant-modal .ant-select-selector');
  await sleep(600);
  await page.click('.ant-select-item-option:has-text("MySQL")');
  await sleep(900);
  modal = await page.textContent('.ant-modal');
  await page.screenshot({ path: shot('connector-create-mysql.png') });
  check('切到 MySQL 后字段整组替换',
        modal.includes('主机地址') && modal.includes('库名') && !modal.includes('接口基地址'),
        'schema 驱动生效');
  check('只读账号提示文案由后端 ParamSpec 下发', modal.includes('只读账号'));

  await page.keyboard.press('Escape');
  await sleep(600);

  // ---- 使用记录抽屉 ----
  // 钉到具名连接，不用「第一行」：列表按名字排序，新增一条连接就会把断言挪到别人身上。
  // :text-is 是精确匹配——「demo-shop」不能顺带匹配到「demo-shop-rw」。
  await page.click('.ant-table-row:has(div:text-is("demo-shop")) button:has-text("使用记录")');
  await sleep(2200);
  await page.screenshot({ path: shot('connector-audit-drawer.png') });
  const drawer = await page.textContent('.ant-drawer');
  check('抽屉打开', drawer.includes('使用记录'));
  check('审计行来自真实接口', drawer.includes('conn_query') || drawer.includes('conn_catalog'));
  check('Agent 名已解析（不是雪花 id）', drawer.includes('全能助手'));
  // 断言「失败行带着九类错误码之一」，不写死某一个码：
  // 这张表只增不减，钉死具体码等于把断言绑在某一次历史调用上。
  const CODES = /UNREACHABLE|AUTH_FAILED|FORBIDDEN|NOT_FOUND|TIMEOUT|RATE_LIMITED|RESULT_TOO_LARGE|UPSTREAM_ERROR|CONFIG_ERROR/;
  check('失败行带错误码', CODES.test(drawer));

  // 展开【有语句的那一行】。不能随便展开第一行——conn_catalog 本来就没有语句，
  // 那样的断言会因为「没东西可看」而空转通过。
  // 必须选【成功的】那条 conn_query：表格按时间倒序，第一条 conn_query 是失败的那次（无语句），
  // 选错行会让断言在「没东西可看」的情况下空转。
  const queryRow = await page.$(
    '.ant-drawer tr.ant-table-row:has(:text("conn_query")):has(:text("成功")) .ant-table-row-expand-icon',
  );
  if (queryRow) {
    await queryRow.click();
    await sleep(900);
    await page.screenshot({ path: shot('connector-audit-expanded.png') });
    const expanded = await page.textContent('.ant-drawer');
    check('展开后看到平台实际执行的语句', expanded.includes('平台实际执行的语句'));
    check('语句是平台改写后的版本（含护栏注入的 LIMIT）', /LIMIT\s+\d+/i.test(expanded),
          '这条正是「查数必须亮出过程」在事后回溯时的落点');
  } else {
    check('展开行可用', false, '找不到 conn_query 行的展开图标');
  }

  // 筛选：切到「仅失败」后，表体里只该剩失败那条。
  await page.click('.ant-drawer .ant-segmented-item:has-text("仅失败")');
  await sleep(2000);
  await page.screenshot({ path: shot('connector-audit-failed-only.png') });
  // 只读表体，不读整个抽屉——顶部那段说明里就写着「查目录、看结构」之类的字样，
  // 拿整个抽屉的文本做「不包含」断言会被说明文案带偏。
  const tbody = await page.textContent('.ant-drawer .ant-table-tbody');
  // 断言不变量而不是固定条数：审计只增不减，「恰好 1 行」这种写法迟早会因为多跑了一次调用而假红。
  // 真正要守的是：筛完之后剩下的每一行都是失败行，且每行都带错误码。
  const statuses = await page.$$eval('.ant-drawer .ant-table-tbody tr.ant-table-row', (rs) =>
    rs.map((r) => r.innerText),
  );
  const allFailed = statuses.length > 0 && statuses.every((t) => t.includes('失败'));
  check('「仅失败」筛选生效',
        allFailed && CODES.test(tbody) && !/成功/.test(tbody),
        `表体行数=${statuses.length}`);
} catch (e) {
  console.log('  ✗ 异常中断:', e.message);
  await page.screenshot({ path: shot('connector-ui-error.png') }).catch(() => {});
  results.push({ name: '脚本执行', ok: false, detail: e.message });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
