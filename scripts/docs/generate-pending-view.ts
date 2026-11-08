/**
 * 待决视图生成器（issue #98 第六阶段 S2-A）——**不进仓**，输出到 `tmp/capture/`。
 *
 * 业主裁定③⑥：对象即源；人要视图时按需生成，量房清单从此不常驻 git。
 * 所以本脚本只读 config 里构件自己的 `status` / `blocker`（不读任何台账），
 * 把 pending/undeclared 的构件按 `blocker.kind` / `blocker.owner` 重排成三张表：
 *
 *   ① 量房清单   —— blocker.owner 含「量房」或 kind = site_measurement
 *   ② 卡业主的决策 —— blocker.owner 含「业主」或 kind = pending_adjudication
 *   ③ 未闭冲突   —— kind = unclosed_conflict
 *
 * 同一构件可同时出现在多张表里（它可能既卡量房又卡业主）——三张表是三个**视角**，
 * 不是三个互斥分区，去重会让「找谁」变难。
 *
 * 用法：`npm run docs:generate-pending-view [-- --out <path>]`
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { collectElements } from '../../shared/element-sources.js';
import { deriveElementStates } from '../../shared/element-state.js';
import type { ComponentBlocker } from '../../shared/types.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_OUT = 'tmp/capture/pending-view.md';

interface Row {
  id: string;
  kind: string;
  room?: string;
  status: string;
  blocker: ComponentBlocker;
}

function collectRows(): Row[] {
  const elements = collectElements();
  const result = deriveElementStates({ elements, issues: [] });
  const byId = new Map(elements.map((element) => [element.id, element]));
  const rows: Row[] = [];
  for (const state of result.states) {
    if (state.status !== 'pending' && state.status !== 'undeclared') continue;
    const element = byId.get(state.id);
    if (!element?.blocker) continue;
    rows.push({
      id: state.id,
      kind: state.kind,
      ...(state.room ? { room: state.room } : {}),
      status: state.status,
      blocker: element.blocker,
    });
  }
  return rows.sort((a, b) => a.blocker.kind.localeCompare(b.blocker.kind) || a.id.localeCompare(b.id));
}

function table(title: string, rows: Row[], note: string): string {
  const lines = [
    `## ${title}`,
    '',
    note,
    '',
    '| 构件 | 类型 | 房间 | kind | 责任方 | 解锁事件 | 什么条件下反转 | 为什么卡 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(`| \`${row.id}\` | ${row.kind} | ${row.room ?? '—'} | ${row.blocker.kind} | ${row.blocker.owner.join('/')} | ${row.blocker.trigger} | ${row.blocker.reverses_if} | ${row.blocker.rationale} |`);
  }
  if (rows.length === 0) lines.push('| — | — | — | — | — | — | — | — |');
  lines.push('');
  return lines.join('\n');
}

function render(rows: Row[]): string {
  const byKind = new Map<string, Row[]>();
  for (const row of rows) {
    byKind.set(row.blocker.kind, [...(byKind.get(row.blocker.kind) ?? []), row]);
  }
  const survey = rows.filter((row) => row.blocker.owner.includes('量房') || row.blocker.kind === 'site_measurement');
  const ownerBlocked = rows.filter((row) => row.blocker.owner.includes('业主') || row.blocker.kind === 'pending_adjudication');
  const conflicts = rows.filter((row) => row.blocker.kind === 'unclosed_conflict');

  const parts: string[] = [
    '# 待决视图（按需生成，过程物不进 git）',
    '',
    `- 生成命令：\`npm run docs:generate-pending-view\``,
    `- 数据来源：config 里构件自己的 \`status\` / \`blocker\` 字段（**不读任何台账**）`,
    `- pending/undeclared 构件共 **${rows.length}** 个`,
    '',
    '## 按 blocker.kind 汇总',
    '',
    '| kind | 条数 | 责任方分布 |',
    '|---|---|---|',
  ];
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const owners = new Map<string, number>();
    for (const row of list) for (const owner of row.blocker.owner) owners.set(owner, (owners.get(owner) ?? 0) + 1);
    const distribution = [...owners.entries()].sort((a, b) => b[1] - a[1]).map(([owner, count]) => `${owner}×${count}`).join('、');
    parts.push(`| ${kind} | ${list.length} | ${distribution} |`);
  }
  parts.push('');
  parts.push(table('① 量房清单（量房前一天人生成到 tmp 打印，不常驻 git）', survey, '筛选：`blocker.owner` 含「量房」或 `blocker.kind = site_measurement`。'));
  parts.push(table('② 卡业主的决策', ownerBlocked, '筛选：`blocker.owner` 含「业主」或 `blocker.kind = pending_adjudication`。'));
  parts.push(table('③ 未闭冲突', conflicts, '筛选：`blocker.kind = unclosed_conflict`——两处口径互相矛盾，量房/裁定分出胜负后才能闭。'));
  return `${parts.join('\n')}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT;
  const rows = collectRows();
  const markdown = render(rows);
  const full = path.join(ROOT, out);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, markdown);
  console.log(`待决视图已生成：${out}（${rows.length} 个 pending/undeclared 构件）`);
  const byKind = new Map<string, number>();
  for (const row of rows) byKind.set(row.blocker.kind, (byKind.get(row.blocker.kind) ?? 0) + 1);
  for (const [kind, count] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${kind}: ${count}`);
}

main();
