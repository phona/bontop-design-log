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
 * 2026-11-10 修 Codex major：本脚本原来只消费 `collectElements()`（电气/给排水/吊顶）。
 * S2 迁入 `config/layout/model-geometry.yaml` 的 `beams` 不是 SceneElement，整段不进清单——
 * 旧手账 #1 删除后，梁位/梁宽/梁底实测任务整类消失。现在：
 *   ① 梁体与 hvac reference_constraints 经 `shared/pending-carriers.ts` 的载体表并入 rows；
 *   ② 覆盖自检改成**源侧逐条对账**（源里有 pending 语义、视图里没有 → 抛错），
 *      不再只核对已采集 rows 的内部并集；
 *   ③ 反向扫 config/**\/*.yaml，出现 pending 语义却未登记的段会抛错，防止下一类静默漏掉。
 *
 * 用法：`npm run docs:generate-pending-view [-- --out <path>]`
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import { collectElements } from '../../shared/element-sources.js';
import { deriveElementStates } from '../../shared/element-state.js';
import {
  PENDING_CARRIERS,
  assertCarrierCoverage,
  assertNoUnregisteredPendingSections,
  hasPendingSemantics,
} from '../../shared/pending-carriers.js';
import type { ComponentBlocker } from '../../shared/types.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_OUT = 'tmp/capture/pending-view.md';

export interface Row {
  id: string;
  kind: string;
  room?: string;
  status: string;
  blocker: ComponentBlocker;
  /** 现场要量的字段 + 当前推断值（梁体 / hvac 参考约束这类无 note 的量房目标用）。 */
  measure?: string;
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

export function collectRows(): Row[] {
  const elements = collectElements();
  const result = deriveElementStates({ elements, issues: [] });
  const byId = new Map(elements.map((element) => [element.id, element]));
  const rows: Row[] = [];
  for (const state of result.states) {
    // 2026-11-09 修 Codex major：原只收 pending/undeclared **且带 blocker** 的构件，
    // 于是「仍声明 construction_status: pending / not_for_construction: true、note 明确
    // 要求量房核实的 inferred 构件」完全不进替代清单——旧手账删了之后，按本脚本打印
    // 量房清单会漏掉这类关键核验（实例：drain_riser_master_bath 要核实立管是否在幕墙
    // 切角内侧并回改两条路线）。判据扩为：pending/undeclared，或 note/结构化字段里
    // 显式声明了「待量房/待实测/待核实」的 inferred 构件。
    //
    // 2026-11-10 补漏：结构化判据此前只写在注释里，实际只匹配 note 散文——
    // 给排水 27 个 construction_status: pending 点位里有 16 个 note 不含关键词，
    // 整类缺席。现在直接复用载体表的 hasPendingSemantics（同一判据，源侧对账也用它）。
    const element = byId.get(state.id);
    if (!element) continue;
    const needsSurvey = /待量房|待实测|待核实|须实测|量房实测|待复测/.test(element.note ?? '');
    const isPending = state.status === 'pending' || state.status === 'undeclared';
    const marked = hasPendingSemantics({
      ...(element.configStatus !== undefined ? { status: element.configStatus } : {}),
      ...(element.blocker !== undefined ? { blocker: element.blocker } : {}),
      ...(element.constructionStatus !== undefined ? { construction_status: element.constructionStatus } : {}),
      ...(element.notForConstruction !== undefined ? { not_for_construction: element.notForConstruction } : {}),
    });
    if (!isPending && !needsSurvey && !marked) continue;
    const markerText = [
      element.constructionStatus === 'pending' ? 'construction_status=pending' : undefined,
      element.notForConstruction ? 'not_for_construction=true' : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join('、');
    rows.push({
      id: state.id,
      kind: state.kind,
      ...(state.room ? { room: state.room } : {}),
      status: state.status,
      blocker: element.blocker ?? {
        kind: 'site_measurement',
        owner: ['量房'],
        trigger: '量房实测（该构件未申报 blocker，按其结构化待核字段/note 纳入清单）',
        reverses_if: '实测后按结果回改或销号',
        rationale: `${markerText ? `${markerText}：` : ''}${element.note ?? '（无 note）'}`.slice(0, 400),
      },
    });
  }
  // 2026-11-10 修 Codex major：不是 SceneElement 的现役载体（结构梁 / hvac 参考约束）
  // 由 shared/pending-carriers.ts 的登记表并入。数据从权威 config 现读，不抄第二份。
  for (const carrier of PENDING_CARRIERS) {
    for (const item of carrier.rows()) {
      rows.push({
        id: item.id,
        kind: item.kind,
        ...(item.room ? { room: item.room } : {}),
        status: item.status,
        blocker: item.blocker,
        measure: `${item.measure}；当前推断：${item.currentValue}`,
      });
    }
  }
  return rows.sort((a, b) => a.blocker.kind.localeCompare(b.blocker.kind) || a.id.localeCompare(b.id));
}

function table(title: string, rows: Row[], note: string): string {
  const lines = [
    `## ${title}`,
    '',
    note,
    '',
    '| 构件 | 类型 | 房间 | kind | 责任方 | 解锁事件 | 什么条件下反转 | 为什么卡 | 量什么 / 当前值 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(`| \`${row.id}\` | ${row.kind} | ${row.room ?? '—'} | ${row.blocker.kind} | ${row.blocker.owner.join('/')} | ${row.blocker.trigger} | ${row.blocker.reverses_if} | ${row.blocker.rationale} | ${row.measure ?? '—'} |`);
  }
  if (rows.length === 0) lines.push('| — | — | — | — | — | — | — | — | — |');
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
    `- 数据来源：config 里构件自己的 \`status\` / \`blocker\` / 施工闸门字段（**不读任何台账**）`,
    `- 待决条目共 **${rows.length}** 个（场景构件 + \`model-geometry.yaml\` 结构梁 + \`hvac.yaml\` 参考约束）；另有 **${collectOpenItems().length}** 条独立未决项（\`config/open-items.yaml\`，无构件载体）`,
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
    throw new Error(`视图覆盖不完整：筛选表并集 ${shown.size} + 兜底表 ${rest.length} = ${covered}，待决条目 = ${rows.length}——有条目被筛掉了`);
  }
  return `${parts.join('\n')}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT;
  const rows = collectRows();
  // 2026-11-10 修 Codex major：渲染前做两道源侧覆盖自检——
  //   ① 每个现役载体的 pending 条目必须逐条出现在 rows（整类遗漏在此炸）；
  //   ② config 里出现 pending 语义的段必须已登记载体或写清豁免（新载体不能静默漏掉）。
  assertCarrierCoverage(new Set(rows.map((row) => row.id)));
  assertNoUnregisteredPendingSections();
  const markdown = render(rows);
  const full = path.join(ROOT, out);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, markdown);
  console.log(`待决视图已生成：${out}（${rows.length} 个待决条目 + ${collectOpenItems().length} 条独立未决项）`);
  const byKind = new Map<string, number>();
  for (const row of rows) byKind.set(row.blocker.kind, (byKind.get(row.blocker.kind) ?? 0) + 1);
  for (const [kind, count] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${kind}: ${count}`);
}

// 直接执行时跑 main；测试 import 本模块取 collectRows / render 时不写文件。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
