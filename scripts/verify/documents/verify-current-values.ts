/**
 * CURRENT-VALUES 生成一致性门禁（文档精简批 4）。
 * 契约：docs/CURRENT-VALUES.md 必须与渲染器从权威源现算的结果逐字节一致。
 * 任一权威源（config / 台账）变动、或本表被手改，都会让本门禁报红——
 * 处置：逐行复核口径后跑 npm run docs:generate-current-values。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCurrentValues } from '../../docs/current-values-render.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const target = path.join(ROOT, 'docs/CURRENT-VALUES.md');
const actual = fs.readFileSync(target, 'utf8');
const expected = renderCurrentValues();
if (actual !== expected) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  console.log('Current-values lint: 1 error(s)');
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) {
      console.log(`  x [stale_or_hand_edited] docs/CURRENT-VALUES.md:${i + 1}`);
      console.log(`      file:     ${a[i] ?? '<EOF>'}`);
      console.log(`      rendered: ${e[i] ?? '<EOF>'}`);
      break;
    }
  }
  console.log('  处置：逐行复核口径后跑 npm run docs:generate-current-values 重新生成。');
  process.exitCode = 1;
} else {
  console.log('Current-values lint: 0 error(s)');
}
