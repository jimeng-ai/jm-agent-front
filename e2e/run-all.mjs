// 顺序跑全部 e2e 套件，汇总通过情况。失败则退出码非 0（可接 CI）。
import resilientChat from './resilient-chat.mjs';
import multiWindow from './multi-window.mjs';
import unreadDot from './unread-dot.mjs';
import menuPersistence from './menu-persistence.mjs';

const suites = [
  ['resilient-chat', resilientChat],
  ['multi-window', multiWindow],
  ['unread-dot', unreadDot],
  ['menu-persistence', menuPersistence],
];

let allOk = true;
for (const [name, runSuite] of suites) {
  console.log(`\n##### ${name} #####`);
  try {
    const ok = await runSuite();
    allOk = allOk && ok;
  } catch (e) {
    console.error('SUITE ERROR', name, e.message);
    allOk = false;
  }
}

console.log(`\n##### OVERALL: ${allOk ? 'ALL GREEN ✅' : 'SOME FAILED ❌'} #####`);
process.exit(allOk ? 0 : 1);
