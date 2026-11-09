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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
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

interface OpenItem {
  id: string;
  subject: string;
  owner: string;
  trigger: string;
  current_state?: string;
  needs?: string;
  reversal: string;
  carrier?: string;
  legacy_ref?: string;
}

/** config/open-items.yaml：无属主对象可挂的未决项（家具/采购选型/设计裁定/几何疑点）。 */
function collectOpenItems(): OpenItem[] {
  const file = path.join(ROOT, 'config/open-items.yaml');
  if (!existsSync(file)) return [];
  const parsed = parseYaml(readFileSync(file, 'utf8')) as { items?: OpenItem[] };
  return parsed.items ?? [];
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

function openItemsTable(title: string, items: OpenItem[], note: string): string {
  const lines = [
    `## ${title}`,
    '',
    note,
    '',
    '| 编号 | 事项 | 责任方 | 触发 | 现状 | 缺什么 | 反转/回退规则 | 原载体 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const item of items) {
    lines.push(`| \`${item.id}\` | ${item.subject} | ${item.owner} | ${item.trigger} | ${item.current_state ?? '—'} | ${item.needs ?? '—'} | ${item.reversal} | ${item.legacy_ref ?? '—'} |`);
  }
  if (items.length === 0) lines.push('| — | — | — | — | — | — | — | — |');
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
  // 2026-11-09 修 Codex major：原实现只输出上述三类，责任方是「厂家/柜商/商家/设计」等、
  // kind 又不是 site_measurement/unclosed_conflict 的构件**只进汇总数字、不出明细**——
  // 旧手账删了之后，拿这个出口交接厂家/柜商任务会漏项。补一张兜底表明细，
  // 并加覆盖完整性自检（三类 + 兜底 = 全部构件，一个都不许被筛掉）。
  const shown = new Set([...survey, ...ownerBlocked, ...conflicts].map((r) => r.id));
  const rest = rows.filter((row) => !shown.has(row.id));

  const parts: string[] = [
    '# 待决视图（按需生成，过程物不进 git）',
    '',
    `- 生成命令：\`npm run docs:generate-pending-view\``,
    `- 数据来源：config 里构件自己的 \`status\` / \`blocker\` 字段（**不读任何台账**）`,
    `- pending/undeclared 构件共 **${rows.length}** 个；另有 **${collectOpenItems().length}** 条独立未决项（\`config/open-items.yaml\`，无构件载体）`,
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

  // ④ 独立未决项（config/open-items.yaml）——2026-11-09 修 Codex major：原实现只扫构件，
  // 导致无属主可挂的 16 条（柜体出图基准 / 官方勘测 / 12 条待拍板决策 / 2 处白框定性）
  // 在任何视图里都不出现，而旧手账已删——用量房/下单的人会漏掉这些前置事项。
  const openItems = collectOpenItems();
  const oiSurvey = openItems.filter((i) => /量房|复尺|实测|特写/.test(`${i.owner} ${i.trigger}`));
  const oiOwner = openItems.filter((i) => !oiSurvey.includes(i) && /业主/.test(i.owner));
  const oiOther = openItems.filter((i) => !oiSurvey.includes(i) && !/业主/.test(i.owner));
  parts.push(openItemsTable('④ 量房清单·独立未决项（无构件载体）', oiSurvey, '来自 `config/open-items.yaml`——家具/采购/设计裁定/几何疑点这类没有 status/blocker schema 的未决项。'));
  parts.push(openItemsTable('⑤ 卡业主的决策·独立未决项', oiOwner, '同上，owner 含「业主」。'));
  parts.push(openItemsTable('⑥ 其他独立未决项', oiOther, '同上，owner 不含「业主」（量房方/物业/消防等）。'));
  parts.push(table('⑦ 其余受阻构件（责任方为厂家/柜商/商家/设计等）', rest, '兜底表：上面三张没盖到的 pending/undeclared 构件。它存在是为了保证「汇总数字 = 明细条目」，交接厂家/柜商任务时不漏项。'));
  // 覆盖完整性：并集大小 + 兜底 = 全部构件。用并集而不是逐表相加——同一构件可能
  // 同时命中多张筛选表（owner 既含「量房」又含「业主」），相加会双算。
  const covered = shown.size + rest.length;
  if (covered !== rows.length) {
    throw new Error(`视图覆盖不完整：筛选表并集 ${shown.size} + 兜底表 ${rest.length} = ${covered}，pending/undeclared 构件 = ${rows.length}——有构件被筛掉了`);
  }
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
  console.log(`待决视图已生成：${out}（${rows.length} 个 pending/undeclared 构件 + ${collectOpenItems().length} 条独立未决项）`);
  const byKind = new Map<string, number>();
  for (const row of rows) byKind.set(row.blocker.kind, (byKind.get(row.blocker.kind) ?? 0) + 1);
  for (const [kind, count] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${kind}: ${count}`);
}

main();
