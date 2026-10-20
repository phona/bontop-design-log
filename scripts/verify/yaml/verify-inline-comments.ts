import * as fs from 'node:fs';
import * as path from 'node:path';
import { findUnquotedInlineComments } from './inline-comment-utils.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ROOTS = ['config', 'docs', 'schedule', 'tests'];

interface Issue {
  file: string;
  line: number;
  code: 'inline_comment_on_value';
  message: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, out);
    } else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
  }
}

function main(): void {
  const issues: Issue[] = [];
  const files: string[] = [];
  for (const rel of ROOTS) walk(path.join(ROOT, rel), files);
  files.sort();

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const issue of findUnquotedInlineComments(text)) {
      issues.push({
        file: rel,
        line: issue.line,
        code: 'inline_comment_on_value',
        message: `${rel}:${issue.line} 行有紧跟内容的未加引号 # token；若它是值的一部分请给整个值加引号，若是注释请在 # 后留空格${issue.key ? `（字段 ${issue.key}）` : ''}`,
      });
    }
  }

  const sorted = issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const report = { version: 1, scope: ROOTS, counts: { errors: sorted.length, warnings: 0 }, inputs: { files: files.length }, issues: sorted };
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`YAML hash-token lint: ${sorted.length} error(s) in ${files.length} files`);
    for (const issue of sorted) console.log(`  x [${issue.code}] ${issue.message}`);
  }
  if (sorted.length > 0) process.exitCode = 1;
}

main();
