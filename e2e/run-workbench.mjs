// 工作台 UI/UX 回归集合。沿用各脚本原有 CLI 入口，避免改变历史套件的退出语义。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  ['navigation', 'workbench-navigation-check.mjs'],
  ['auth-agent-integration', 'auth-agent-integration-check.mjs'],
  ['agents', 'agent-workbench-check.mjs'],
  ['connector-ui', 'connector-ui-check.mjs'],
  ['connector-schema', 'connector-schema-check.mjs'],
  ['connector-probe', 'connector-probe-check.mjs'],
  ['connector-write-policy', 'connector-writepolicy-check.mjs'],
  ['semantic', 'semantic-workbench-check.mjs'],
];

function runScript(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], {
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', (error) => {
      console.error('SUITE ERROR', file, error.message);
      resolve(false);
    });
    child.on('exit', (code, signal) => {
      if (signal) console.error('SUITE TERMINATED', file, signal);
      resolve(code === 0);
    });
  });
}

let allPassed = true;
for (const [name, file] of suites) {
  console.log(`\n##### workbench / ${name} #####`);
  allPassed = (await runScript(file)) && allPassed;
}

console.log(`\n##### WORKBENCH: ${allPassed ? 'ALL GREEN ✅' : 'SOME FAILED ❌'} #####`);
process.exit(allPassed ? 0 : 1);
