// 结构快照与漂移检测的 UI 实跑。
// 核心验证：真的去改客户库的结构，页面上能不能看见。
import { execSync } from 'node:child_process';
import { CONFIG, launchBrowser, login, shot, sleep } from './lib.mjs';

const BASE = CONFIG.baseUrl;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/** 直接对客户库做 DDL，模拟「客户悄悄改了结构」。 */
const customerDdl = (sql) =>
  execSync(
    `docker exec -i dev-mysql mysql --default-character-set=utf8mb4 -uroot -p123456 demo_shop -e ${JSON.stringify(sql)} 2>/dev/null`,
    { encoding: 'utf8' },
  );

const openSchemaDrawer = async (page) => {
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);
  await page.click('tr.ant-table-row:has-text("demo-shop") button:has-text("结构")');
  await sleep(1800);
};

const refresh = async (page) => {
  await page.click('.ant-drawer button:has-text("刷新结构")');
  await sleep(2500);
};

const { browser, page } = await launchBrowser();
try {
  await login(page);

  // ---- 只有支持自描述的连接器才有「结构」按钮 ----
  await page.goto(`${BASE}/console/connectors`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);
  const mysqlRow = await page.textContent('tr.ant-table-row:has-text("demo-shop")');
  const httpRow = await page.textContent('tr.ant-table-row:has-text("miaodong")');
  check('有 DESCRIBE 能力的连接器给「结构」入口', mysqlRow.includes('结构'));
  check('没有 DESCRIBE 能力的不给（给了只会点了报错）', !httpRow.includes('结构'));

  // ---- 打开并刷新，建立基线 ----
  await openSchemaDrawer(page);
  await refresh(page);
  await page.screenshot({ path: shot('schema-baseline.png') });
  let drawer = await page.textContent('.ant-drawer');
  check('结构表渲染', drawer.includes('orders'));
  check('展示上次同步时间', drawer.includes('上次同步'));

  // ---- 空刷：不该误报 ----
  await refresh(page);
  drawer = await page.textContent('.ant-drawer');
  check('结构没变时明确说「没有变化」', drawer.includes('结构没有变化'), '验证无误报');

  // ---- 真改客户库 ----
  customerDdl(
    "ALTER TABLE orders ADD COLUMN promo_code varchar(32) NULL COMMENT '促销码'; " +
      "CREATE TABLE coupons (id bigint NOT NULL AUTO_INCREMENT, code varchar(32) NOT NULL, PRIMARY KEY(id)) " +
      "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='优惠券表';",
  );
  await refresh(page);
  await page.screenshot({ path: shot('schema-drift.png') });
  drawer = await page.textContent('.ant-drawer');
  check('检出结构变化', drawer.includes('处结构变化'));
  // 差异少时列级明细默认展开——这条同时验证了「最有价值的信息不该藏在一次点击后面」。
  check('新增列被直接列出（无需展开）', drawer.includes('promo_code'));
  check('新增表被列出', drawer.includes('coupons'));

  // ---- 删表：REMOVED 默认展开，因为最该被看到 ----
  customerDdl('DROP TABLE coupons;');
  await refresh(page);
  await page.screenshot({ path: shot('schema-removed.png') });
  drawer = await page.textContent('.ant-drawer');
  check('删表被检出', drawer.includes('删除') && drawer.includes('coupons'));

  // 收尾：把客户库改回去，别给后续验证留脏结构
  customerDdl('ALTER TABLE orders DROP COLUMN promo_code;');
  await refresh(page);
  drawer = await page.textContent('.ant-drawer');
  check('还原后再刷仍能正确检出删除列', drawer.includes('删除列') && drawer.includes('promo_code'));
} catch (e) {
  console.log('  ✗ 异常中断:', e.message);
  await page.screenshot({ path: shot('schema-error.png') }).catch(() => {});
  results.push({ name: '脚本执行', ok: false, detail: e.message });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
