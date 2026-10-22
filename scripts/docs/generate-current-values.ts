/** 生成 docs/CURRENT-VALUES.md（渲染逻辑见 current-values-render.ts）。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderCurrentValues } from './current-values-render.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const target = path.join(ROOT, 'docs/CURRENT-VALUES.md');
fs.writeFileSync(target, renderCurrentValues(), 'utf8');
console.log('docs/CURRENT-VALUES.md regenerated');
