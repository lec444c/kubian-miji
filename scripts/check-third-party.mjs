import { existsSync, readFileSync } from 'node:fs';

const required = ['LICENSE', 'NOTICE', 'licenses/tailuge-billiards-LICENSE.txt', 'third_party/tailuge-billiards/src/model/physics/physics.ts'];
const missing = required.filter(path => !existsSync(new URL(`../${path}`, import.meta.url)));
if (missing.length) {
  console.error(`第三方来源文件缺失：${missing.join(', ')}`);
  process.exit(1);
}
const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
if (!notice.includes('92a2818928e9ab8576fd300615509c88b0b0f183') || !notice.includes('tailuge')) {
  console.error('NOTICE 未记录固定提交或参考项目来源');
  process.exit(1);
}
console.log('第三方代码来源、固定提交和 GPLv3 文件检查通过。');
