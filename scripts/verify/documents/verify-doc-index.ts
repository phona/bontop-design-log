import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const INDEX = 'docs/README.md';

interface Issue {
  code: string;
  message: string;
}

function countDirectories(rel: string, exclude?: string): number {
  return fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== exclude).length;
}

function markdownFiles(rel: string): number {
  return fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md')).length;
}

function resolveIndexPath(value: string): string {
  if (value.startsWith('docs/') || value.startsWith('config/') || value.startsWith('schedule/')) {
    return path.resolve(ROOT, value);
  }
  return path.resolve(ROOT, 'docs', value);
}

function main(): void {
  const text = fs.readFileSync(path.join(ROOT, INDEX), 'utf8');
  const issues: Issue[] = [];
  const actualRootDocs = markdownFiles('docs') - 1; // Exclude docs/README.md itself.
  const activeIterations = countDirectories('docs/design-iterations', 'archive');
  const archivedIterations = countDirectories('docs/design-iterations/archive');
  const hvacDocs = markdownFiles('docs/hvac');

  const rootHeading = text.match(/^## 根目录 (\d+) 个文档$/m);
  if (!rootHeading || Number(rootHeading[1]) !== actualRootDocs) {
    issues.push({ code: 'docs_root_count_mismatch', message: `docs/README 根文档数量=${rootHeading?.[1] ?? 'missing'}，文件系统=${actualRootDocs}` });
  }

  const iterationRow = text.match(/^\|\s*`design-iterations\/[^|]*\|[^|]*\|/m);
  const iterationNumbers = iterationRow?.[0].match(/(\d+) 个现役目录.*?archive\/.*?(\d+) 个/);
  if (!iterationNumbers || Number(iterationNumbers[1]) !== activeIterations || Number(iterationNumbers[2]) !== archivedIterations) {
    issues.push({ code: 'iteration_directory_count_mismatch', message: `docs/README 迭代目录数与文件系统不符（现役=${activeIterations}，归档=${archivedIterations}）` });
  }

  const hvacRow = text.match(/^\|\s*`hvac\/[^|]*\|[^|]*\|/m);
  const hvacNumber = hvacRow?.[0].match(/(\d+) 个 md/);
  if (!hvacNumber || Number(hvacNumber[1]) !== hvacDocs) {
    issues.push({ code: 'hvac_directory_count_mismatch', message: `docs/README 暖通文档数=${hvacNumber?.[1] ?? 'missing'}，文件系统=${hvacDocs}` });
  }

  const recentHeading = text.indexOf('## 最近变动');
  const nextHeading = recentHeading < 0 ? -1 : text.indexOf('\n## ', recentHeading + 1);
  const recentSection = recentHeading < 0 ? '' : text.slice(recentHeading, nextHeading < 0 ? undefined : nextHeading);
  const recentRows = [...recentSection.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*`([^`]+)`/gm)];
  if (recentRows.length === 0) issues.push({ code: 'recent_changes_empty', message: 'docs/README 最近变动区没有带日期的文件行' });
  let previous = '9999-12-31';
  for (const row of recentRows) {
    const date = row[1];
    const target = row[2];
    if (date > previous) issues.push({ code: 'recent_changes_unsorted', message: `最近变动未按日期倒序：${date} ${target}` });
    previous = date;
    if (!fs.existsSync(resolveIndexPath(target))) issues.push({ code: 'index_target_missing', message: `最近变动表路径不存在：${target}` });
  }

  const rootSectionStart = text.indexOf('## 根目录 ');
  const dateSnapshotsStart = text.indexOf('### C.', rootSectionStart);
  const rootRows = rootSectionStart < 0 || dateSnapshotsStart < 0 ? '' : text.slice(rootSectionStart, dateSnapshotsStart);
  const listedRootDocs = new Set<string>();
  for (const line of rootRows.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    const firstCell = cells[1] ?? '';
    const file = firstCell.match(/`([^`]+\.md)`/)?.[1];
    if (!file) continue;
    const currentPath = (cells[2] ?? '').match(/`([^`]+\.md)`/)?.[1];
    const candidates = [file, ...(currentPath ? [currentPath] : [])].map(resolveIndexPath);
    const existing = candidates.filter((target) => fs.existsSync(target));
    if (existing.length === 0) issues.push({ code: 'root_doc_entry_missing', message: `根目录文档清单路径不存在：${file}` });
    for (const target of existing) {
      if (path.dirname(target) === path.join(ROOT, 'docs')) listedRootDocs.add(path.basename(target));
    }
  }
  for (const entry of fs.readdirSync(path.join(ROOT, 'docs'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md') || entry.name === 'README.md') continue;
    if (!listedRootDocs.has(entry.name)) issues.push({ code: 'root_doc_unindexed', message: `docs 根目录文档未列入 A/B 清单：${entry.name}` });
  }

  const countTableRows = (startMarker: string, endMarker: string): number => {
    const start = text.indexOf(startMarker);
    if (start < 0) return -1;
    const end = text.indexOf(endMarker, start + startMarker.length);
    const section = text.slice(start, end < 0 ? undefined : end);
    return section.split('\n').filter((line) => {
      if (!line.startsWith('|')) return false;
      const cell = (line.split('|')[1] ?? '').trim();
      return cell.length > 0 && !/^文档$/.test(cell) && !/^[-:]+$/.test(cell);
    }).length;
  };
  for (const [section, next, label] of [
    ['### A.', '### B.', 'A'],
    ['### B.', '### 暖通专题常驻文档', 'B'],
  ]) {
    const heading = text.slice(text.indexOf(section), text.indexOf('\n', text.indexOf(section)));
    const declared = heading.match(/(?:文档)?[（(](\d+)[ 个)）]/)?.[1];
    const actual = countTableRows(section, next);
    if (declared && actual !== Number(declared)) {
      issues.push({ code: 'index_category_count_mismatch', message: `docs/README ${label} 区声明 ${declared} 项，表格有 ${actual} 项` });
    }
  }

  for (const marker of ['### C.', '### D.']) {
    const start = text.indexOf(marker);
    if (start < 0) {
      issues.push({ code: 'index_section_missing', message: `docs/README 缺少 ${marker} 索引区` });
      continue;
    }
    const next = text.indexOf('\n### ', start + marker.length);
    const section = text.slice(start, next < 0 ? undefined : next);
    for (const line of section.split('\n')) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1);
      const targets = cells.flatMap((cell) => [...cell.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1]));
      if (targets.length === 0) continue;
      if (!targets.some((target) => fs.existsSync(resolveIndexPath(target)))) {
        issues.push({ code: 'snapshot_target_missing', message: `${marker} 快照/零入链清单行没有现存路径：${targets.join(', ')}` });
      }
    }
  }

  const sorted = issues.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  const report = { version: 1, index: INDEX, counts: { errors: sorted.length, warnings: 0 }, inputs: { actualRootDocs, activeIterations, archivedIterations, hvacDocs, recentRows: recentRows.length }, issues: sorted };
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Document index lint: ${sorted.length} error(s)`);
    console.log(`  docs root=${actualRootDocs}; iterations=${activeIterations}+${archivedIterations} archived; HVAC=${hvacDocs}; recent rows=${recentRows.length}`);
    for (const issue of sorted) console.log(`  x [${issue.code}] ${issue.message}`);
  }
  if (sorted.length > 0) process.exitCode = 1;
}

main();
