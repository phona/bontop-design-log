import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  looksLikeLocalPath,
  markdownDestinations,
  markdownPathCandidates,
  metadataPathCandidates,
  movedArchiveIteration,
  rootedPathTokens,
  targetExists,
} from './document-reference-utils.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ROOTS = ['docs'];
const ROOT_RELATIVE_REFERENCES: string[] = [
  'README.md',
  'config/house.yaml',
  'scripts/test-opencode-prompt.mjs',
];

interface Issue {
  code: string;
  file: string;
  target: string;
  message: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (rel.split('/').some((part) => part === 'decisions' && rel.startsWith('docs/decisions/'))) continue;
      walk(full, out);
    } else if (/\.(?:md|yaml|yml|json)$/i.test(entry.name)) {
      if (entry.name.toLowerCase().endsWith('.md') && rel.startsWith('docs/decisions/')) continue;
      out.push(rel);
    }
  }
}

function lineFor(text: string, target: string): number | undefined {
  const index = text.indexOf(target);
  return index < 0 ? undefined : text.slice(0, index).split('\n').length;
}

function addTargetIssue(issues: Issue[], file: string, text: string, target: string, markdown: boolean): void {
  if (!looksLikeLocalPath(target)) return;
  const candidates = markdown
    ? markdownPathCandidates(ROOT, file, target)
    : metadataPathCandidates(ROOT, file, target);
  if (candidates.length === 0) return; // tmp/ references are ephemeral by contract.
  if (targetExists(candidates, fs.existsSync)) return;
  const at = lineFor(text, target);
  issues.push({
    code: 'local_reference_missing',
    file,
    target,
    message: `${file}${at ? `:${at}` : ''} 指向不存在的仓库内路径：${target}`,
  });
}

function collectMetadataPaths(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(...rootedPathTokens(value).filter((target) => target.startsWith('docs/design-iterations/')));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectMetadataPaths(entry, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectMetadataPaths(child, out);
    }
  }
}

function main(): void {
  const issues: Issue[] = [];
  const files: string[] = [];
  for (const root of ROOTS) walk(path.join(ROOT, root), files);
  for (const explicit of ROOT_RELATIVE_REFERENCES) files.push(explicit);
  const uniqueFiles = [...new Set(files)].sort();

  for (const file of uniqueFiles) {
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file.toLowerCase().endsWith('.md')) {
      for (const target of markdownDestinations(text)) addTargetIssue(issues, file, text, target, true);
    }

    if (/\.(?:yaml|yml|json)$/i.test(file)) {
      try {
        const parsed = file.endsWith('.json') ? JSON.parse(text) : yaml.load(text);
        const paths: string[] = [];
        collectMetadataPaths(parsed, paths);
        for (const target of paths) {
          const moved = movedArchiveIteration(target, (rel) => fs.existsSync(path.join(ROOT, rel)));
          if (moved) {
            const at = lineFor(text, target);
            issues.push({
              code: 'archive_path_not_rebased',
              file,
              target,
              message: `${file}${at ? `:${at}` : ''} 仍指向已归档轮次的旧路径 ${target}；当前目录是 docs/design-iterations/archive/${moved}`,
            });
          }
        }
      } catch {
        // Syntax failures are owned by verify-iteration-metadata / verify-facts.
      }
    }

    // Live config and helper source may cite a file path in prose rather than a path-named field.
    if (ROOT_RELATIVE_REFERENCES.includes(file)) {
      const expectedPrefix = file === 'config/house.yaml' || file === 'scripts/test-opencode-prompt.mjs' ? 'docs/hvac/' : undefined;
      for (const target of rootedPathTokens(text)) {
        if (!expectedPrefix || target.startsWith(expectedPrefix)) addTargetIssue(issues, file, text, target, false);
      }
    }
  }

  const sorted = [...new Map(issues.map((issue) => [`${issue.file}\0${issue.target}`, issue])).values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.target.localeCompare(b.target));
  const report = {
    version: 1,
    scope: ['Markdown links under docs/** except docs/decisions/**', 'stale pre-archive roots in iteration metadata', ...ROOT_RELATIVE_REFERENCES],
    counts: { errors: sorted.length, warnings: 0 },
    issues: sorted,
  };
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Document reference lint: ${sorted.length} error(s)`);
    for (const issue of sorted) console.log(`  x [${issue.code}] ${issue.message}`);
  }
  if (sorted.length > 0) process.exitCode = 1;
}

main();
