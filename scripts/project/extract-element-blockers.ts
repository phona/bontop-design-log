/**
 * 机械抽取：把 pending/undeclared 构件的 blocker 从既有 `note` / 配置字段里抽出来，
 * 写回 config（`--write`）或只报告（默认 dry-run）。
 *
 * 为什么必须是脚本而不是 AI 逐条填（业主裁定④「能机械就不用 AI」）：
 * 这些 blocker 的原文**早就写在对象自己的 note 里**（如 sock_kitchen_hood 的 note 含
 * 「Hood SKU, final face/access and duct joint remain pending」），缺的只是结构化。
 * 脚本用关键词规则抽 kind / owner / trigger，抽不出的列进「未命中清单」交人工判——
 * 人工只处理脚本报错的那几条，不逐条重写。
 *
 * 同一份 config 重跑结果一致（幂等）：已带 blocker 的条目整条跳过，不重复写、不改写已有值。
 *
 * 顺带做一件机械事（业主裁定①「状态是对象的声明」）：把 electrical 的第二个状态字段
 * `position_status` 对齐回唯一的 `status`——
 *   · `position_status: pending` 而 `status` 不是 pending  → `status` 改/补为 pending；
 *   · 同时删掉该条 `position_status`（位置精度不再是状态字段；DXF 的「位置待核」告警由
 *     `status: pending` 等价触发，shared/dxf/project-dxf.ts 的判定是 OR）。
 * 例外保留 `position_status` 的两种情形：① 原本 `status` 已是 pending 的点位——它是
 * `shared/mep-takeoff.ts` 算量延期判定（status 与 position_status 均 pending）的一半；
 * ② `position_status` 不是 pending 的点位（如 measured/likely 配电箱），删了会丢 DXF 告警。
 *
 * 用法：
 *   npm run state:extract-blockers            # dry-run，打印拟写入内容 + 未命中清单
 *   npm run state:extract-blockers -- --write # 写回 config
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { BLOCKER_KINDS, BLOCKER_OWNERS } from '../../shared/element-blockers.js';
import type { BlockerKind, BlockerOwner } from '../../shared/types.js';
import { sourceFile } from '../../shared/envelope-sources.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** 一个待补 blocker 的构件（来自 config，不来自任何台账）。 */
interface Candidate {
  file: string;
  id: string;
  kind: 'electrical' | 'plumbing' | 'ceiling';
  /** 该条目在 YAML 文本里的行范围（1-based，含起不含止——即下一个 `- id:` 行）。 */
  startLine: number;
  endLine: number;
  note: string;
  status?: string;
  positionStatus?: string;
  /** 已有 blocker（幂等：整条跳过）。 */
  hasBlocker: boolean;
  /** 该条目在 YAML 里的缩进（空格数）。 */
  indent: number;
}

export interface Extraction {
  kind: BlockerKind;
  owner: BlockerOwner[];
  trigger: string;
  reverses_if: string;
  rationale: string;
  /** 命中依据：抽中它的关键词，供人工复核。 */
  evidence: string[];
  /** 未命中字段（kind 或 owner 抽不出）——交人工判。 */
  missing: Array<'kind' | 'owner'>;
  /** trigger 用的是 kind 派生模板而不是 note 原文——人工可改进。 */
  triggerTemplated: boolean;
}

// ── 关键词规则（全部来自 config note 的既有措辞，不发明新概念）──────────────────

// 顺序即优先级：越具体的类别越靠前。冲突未闭最specific（两处口径互相矛盾），
// 量房待测次之（note 里出现 site_pending / 待实测就是它），再往下是选型、深化图、裁定。
// 顺序是**启发式**，不是真理——脚本同时在报告里列出每条命中依据（evidence）与未命中清单，
// 抽错的由实施者按 note 原文改（本轮的修正清单见 PR 说明）。
const KIND_RULES: Array<{ kind: BlockerKind; patterns: RegExp[] }> = [
  {
    // 冲突未闭：两处口径互相矛盾/二选一未定
    kind: 'unclosed_conflict',
    patterns: [/冲突/, /矛盾/, /二选一/, /并存候选/, /量房定后删其一/, /哪一处为真/, /定性不明/],
  },
  {
    // 量房待测
    kind: 'site_measurement',
    patterns: [/量房/, /待实测/, /复尺/, /现场量/, /现场确认/, /实测/, /拍特写/, /site_pending/i, /site pending/i],
  },
  {
    // 待选型：SKU/型号/方案未定
    kind: 'pending_selection',
    patterns: [/SKU/, /选型/, /型号/, /采购/, /商家/, /报价/, /竞品/, /比价/, /随设备定案/, /定案补登/, /SKU 冻结/],
  },
  {
    // 待深化图：厂家/橱柜/柜商出图后才能定（不匹配裸「深化」——「另行深化」常是量房项）
    kind: 'pending_vendor_drawing',
    patterns: [/深化图/, /厂家图/, /厂家安装图/, /厂家资料/, /厂商图/, /橱柜深化/, /柜体深化/, /深化时/, /深化核对/, /深化时落实/],
  },
  {
    // 待裁定：业主/设计决策未拍板
    kind: 'pending_adjudication',
    patterns: [/待业主/, /业主裁/, /业主拍板/, /待定/, /未定/, /设计裁定/, /设计待决/, /取舍/, /定标/, /定案/],
  },
];

const OWNER_RULES: Array<{ owner: BlockerOwner; patterns: RegExp[] }> = [
  { owner: '业主', patterns: [/业主/] },
  { owner: '设计', patterns: [/设计/] },
  { owner: '量房', patterns: [/量房/, /复尺/, /实测/] },
  { owner: '厂家', patterns: [/厂家/, /厂商/, /安装图/] },
  { owner: '商家', patterns: [/商家/, /门店/, /卖家/, /电商/, /供应商/, /经销/] },
  { owner: '电工', patterns: [/电工/] },
  { owner: '柜商', patterns: [/柜商/, /橱柜方/, /橱柜/, /柜体/] },
  { owner: '运营商', patterns: [/运营商/] },
  { owner: '物业', patterns: [/物业/] },
  { owner: '燃气公司', patterns: [/燃气公司/, /燃气/] },
];

/** trigger：优先抓「截止节点 = X」「触发 = X」「随 X 冻结」这类既有措辞。 */
const TRIGGER_RULES: RegExp[] = [
  /截止节点\s*[=＝:：]\s*([^；;。\n，,]{2,40})/,
  /触发\s*[=＝:：]\s*([^；;。\n，,]{2,40})/,
  /随\s*([A-Za-z0-9一-龥·/ ]{2,20}?)\s*冻结/,
  /以\s*([^，,。；;\n]{2,24}?)\s*为触发/,
  /待\s*([^；;。\n，,]{2,24}?)(?:到手|确认|定标|定案|量房|实测|冻结|核验|深化)/,
];

/** trigger 兜底模板：按 blocker.kind 派生（note 没写明具体事件时用，报告里计数显形）。 */
const TRIGGER_TEMPLATE: Record<BlockerKind, string> = {
  site_measurement: '量房实测该项',
  pending_selection: 'SKU/型号定标',
  pending_vendor_drawing: '厂家/柜商深化图到手',
  pending_adjudication: '业主/设计裁定',
  unclosed_conflict: '两处口径对齐',
};

/** 从 note 里取一句最能代表「为什么卡」的原文（截断到 120 字）。 */
function rationaleFromNote(note: string): string {
  const sentences = note
    .split(/[。；;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 8);
  const hit = sentences.find((part) => KIND_RULES.some((rule) => rule.patterns.some((pattern) => pattern.test(part))));
  const picked = hit ?? sentences[0] ?? note.trim();
  return picked.length > 120 ? `${picked.slice(0, 117)}…` : picked;
}

function triggerFromNote(note: string, kind: BlockerKind): { trigger: string; templated: boolean } {
  for (const pattern of TRIGGER_RULES) {
    const match = pattern.exec(note);
    if (match?.[1]) {
      const value = match[1].trim().replace(/[，,、\s]+$/, '');
      if (value.length >= 2) return { trigger: value.length > 40 ? `${value.slice(0, 37)}…` : value, templated: false };
    }
  }
  return { trigger: TRIGGER_TEMPLATE[kind], templated: true };
}

function reversesIfFromNote(note: string, kind: BlockerKind): string {
  const patterns = [
    /(若[^。；;\n]{6,90}?(?:则|须|即|改|重定义|另找|不能|不得)[^。；;\n]{0,60})/,
    /(不得[^。；;\n]{6,90})/,
    /(不能[^。；;\n]{6,60})/,
    /(推翻[^。；;\n]{6,90})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(note);
    if (match?.[1]) {
      const value = match[1].trim();
      return value.length > 100 ? `${value.slice(0, 97)}…` : value;
    }
  }
  const fallback: Record<BlockerKind, string> = {
    site_measurement: '量房实测值与现声明不符时按实测重算（note 未写明具体反转条件）',
    pending_selection: 'SKU/型号变更时机型尺寸、接管方向与回路口径须重算（note 未写明具体反转条件）',
    pending_vendor_drawing: '深化图与现声明不符时按图重算并同步墙体/路线/回路（note 未写明具体反转条件）',
    pending_adjudication: '业主/设计作出相反裁定时按新裁定重算（note 未写明具体反转条件）',
    unclosed_conflict: '两处口径经量房/裁定的胜负已分时按胜者改写（note 未写明具体反转条件）',
  };
  return fallback[kind];
}

/** 机械抽取：规则命中即返回，缺 kind/owner 时进 missing（交人工判）。 */
export function extractBlocker(input: { note: string; status?: string; positionStatus?: string }): Extraction {
  const note = input.note ?? '';
  const evidence: string[] = [];
  const missing: Array<'kind' | 'owner'> = [];

  let kind: BlockerKind | undefined;
  for (const rule of KIND_RULES) {
    const hit = rule.patterns.find((pattern) => pattern.test(note));
    if (hit) {
      kind = rule.kind;
      evidence.push(`kind=${rule.kind} ← /${hit.source}/`);
      break;
    }
  }
  if (!kind) missing.push('kind');

  const owners = new Set<BlockerOwner>();
  for (const rule of OWNER_RULES) {
    const hit = rule.patterns.find((pattern) => pattern.test(note));
    if (hit) {
      owners.add(rule.owner);
      evidence.push(`owner=${rule.owner} ← /${hit.source}/`);
    }
  }
  // note 没点名任何一方时，按 blocker.kind 给默认责任方——「待量房」卡量房、「待选型」卡商家/厂家。
  if (owners.size === 0) {
    const defaults: Record<BlockerKind, BlockerOwner[]> = {
      site_measurement: ['量房'],
      pending_selection: ['商家'],
      pending_vendor_drawing: ['厂家'],
      pending_adjudication: ['业主'],
      unclosed_conflict: ['设计'],
    };
    for (const owner of defaults[kind ?? 'pending_adjudication']) {
      owners.add(owner);
      evidence.push(`owner=${owner} ← 默认责任方（note 未点名）`);
    }
  }
  if (owners.size === 0) missing.push('owner');

  const resolvedKind = kind ?? 'pending_adjudication';
  const { trigger, templated } = triggerFromNote(note, resolvedKind);
  return {
    kind: resolvedKind,
    owner: [...owners],
    trigger,
    reverses_if: reversesIfFromNote(note, resolvedKind),
    rationale: rationaleFromNote(note),
    evidence,
    missing,
    triggerTemplated: templated,
  };
}

// ── config 读取与写回（保留原文件其余字节，只动受管条目）──────────────────────

/** 把一个 YAML 列表文件按 `- id:` 切成条目，记录每个条目的行范围与关键字段。 */
function readCandidates(file: string, kind: Candidate['kind']): Candidate[] {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const lines = text.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^- id:/.test(lines[i])) starts.push(i);
  }
  const out: Candidate[] = [];
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    const body = lines.slice(start, end).join('\n');
    const idMatch = /^- id:\s*['"]?([A-Za-z0-9_.-]+)['"]?/.exec(body);
    if (!idMatch) return;
    // ac_indoor 内机的权威状态在 config/hvac.yaml 的 anchor（collectCeilingHvacAnchors），
    // 分区自身不声明 status——把它们当候选会把「anchor 已确认」误判成待补。
    const type = /^\s+type:\s*['"]?([a-z_]+)['"]?/m.exec(body)?.[1];
    if (kind === 'ceiling' && type === 'ac_indoor') return;
    const status = /^\s+status:\s*['"]?([a-z_]+)['"]?/m.exec(body)?.[1];
    const positionStatus = /^\s+position_status:\s*['"]?([a-z_]+)['"]?/m.exec(body)?.[1];
    const hasBlocker = /^\s+blocker:/m.test(body);
    const note = /^\s+note:\s*"([\s\S]*?)"\s*$/m.exec(body)?.[1]
      ?? /^\s+note:\s*'([\s\S]*?)'\s*$/m.exec(body)?.[1]
      ?? /^\s+note:\s*(.+)$/m.exec(body)?.[1]
      ?? '';
    const indent = /^(\s*)- id:/.exec(lines[start])?.[1].length ?? 0;
    out.push({
      file, id: idMatch[1], kind,
      startLine: start + 1, endLine: end + 1,
      note: note.replace(/\\"/g, '"'), status, positionStatus, hasBlocker, indent,
    });
  });
  return out;
}

/**
 * 需要补 blocker 的候选：**对象自己还没有 blocker**，且它的状态会落 pending / undeclared。
 *
 * 三种来源：
 *  ① `status: pending`（S1-B 补录通道）；
 *  ② `position_status: pending`（electrical 的旧第二状态字段——本轮对齐回 `status`）；
 *  ③ 完全没声明状态——它们在 S2-A 前靠 `docs/pending-site-data.md` 的 ledger 规则落 pending，
 *     台账删除后会被兜底成 undeclared。脚本给它们补 `status: pending`（默认语义，报告里显形），
 *     真正该是 `undeclared` 的个别条目由实施者改。
 */
function pendingCandidates(): Candidate[] {
  const all = [
    ...readCandidates(sourceFile('electrical'), 'electrical'),
    ...readCandidates(sourceFile('plumbing'), 'plumbing'),
    ...readCandidates(sourceFile('ceiling'), 'ceiling'),
  ];
  return all.filter((candidate) => {
    if (candidate.hasBlocker) return false;
    // effective 用旧采集器口径（position_status 优先）——本轮要保住的正是这个状态。
    const status = candidate.positionStatus ?? candidate.status;
    return status === 'pending' || status === 'undeclared' || (status === undefined && candidate.note.length > 0);
  });
}

/** 把 blocker 写成 YAML 片段（缩进与条目一致；值内含 `#` 一律加引号——AGENTS.md 铁律 7）。 */
function renderBlocker(extraction: Extraction, indent: number): string {
  const pad = ' '.repeat(indent + 2);
  const quote = (value: string): string => JSON.stringify(value);
  return [
    `${pad}blocker:`,
    `${pad}  kind: ${extraction.kind}`,
    `${pad}  owner: [${extraction.owner.map((owner) => quote(owner)).join(', ')}]`,
    `${pad}  trigger: ${quote(extraction.trigger)}`,
    `${pad}  reverses_if: ${quote(extraction.reverses_if)}`,
    `${pad}  rationale: ${quote(extraction.rationale)}`,
  ].join('\n');
}

interface FileEdits {
  insertions: Array<{ at: number; lines: string[] }>;
  deletions: number[];
  replacements: Map<number, string>;
}

/** 应用一组插入/删除/替换，保持文件其余字节不变。 */
function applyEdits(file: string, edits: FileEdits): void {
  const full = path.join(ROOT, file);
  const lines = readFileSync(full, 'utf8').split('\n');
  const drop = new Set(edits.deletions);
  const insertBefore = new Map<number, string[]>();
  for (const insertion of edits.insertions) {
    insertBefore.set(insertion.at, [...(insertBefore.get(insertion.at) ?? []), ...insertion.lines]);
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const before = insertBefore.get(lineNumber);
    if (before) out.push(...before);
    if (drop.has(lineNumber)) continue;
    out.push(edits.replacements.get(lineNumber) ?? lines[i]);
  }
  // 末尾条目的插入点（at = 行数 + 1）在循环里永远不会触发——这里补上，否则最后一个
  // `- id:` 条目（如 electrical.yaml 的 night_corridor）会静默丢掉整段 blocker。
  for (const [at, fragment] of [...insertBefore.entries()].sort((a, b) => a[0] - b[0])) {
    if (at > lines.length) out.push(...fragment);
  }
  writeFileSync(full, out.join('\n'));
}

/** 在条目块内找第一个匹配 `pattern` 的行号（1-based）；找不到返回 undefined。 */
function findLineInBlock(file: string, candidate: Candidate, pattern: RegExp): number | undefined {
  const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  for (let i = candidate.startLine - 1; i < candidate.endLine - 1 && i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return undefined;
}

function main(): void {
  const write = process.argv.includes('--write');
  const candidates = pendingCandidates();

  const report: Array<{ id: string; file: string; extraction: Extraction }> = [];
  const seeded: string[] = [];
  const aligned: string[] = [];
  const unresolved: Array<{ id: string; file: string; note: string; missing: string[] }> = [];
  const templated: string[] = [];
  const perFile = new Map<string, FileEdits>();

  for (const candidate of candidates) {
    const extraction = extractBlocker({ note: candidate.note, status: candidate.status, positionStatus: candidate.positionStatus });
    if (extraction.missing.length > 0) {
      unresolved.push({ id: candidate.id, file: candidate.file, note: candidate.note, missing: extraction.missing });
    }
    if (extraction.triggerTemplated) templated.push(`${candidate.file} ${candidate.id}`);
    report.push({ id: candidate.id, file: candidate.file, extraction });

    const edits: FileEdits = perFile.get(candidate.file) ?? { insertions: [], deletions: [], replacements: new Map() };
    const pad = ' '.repeat(candidate.indent + 2);
    // effective = 旧采集器口径（position_status 优先于 status）——本轮要保住的正是这个状态。
    const effective = candidate.positionStatus ?? candidate.status;
    // 三种补/改 status 的情形：原本没有 status（只有 position_status）→ 插入；
    // 什么都没有 → 插入默认 pending；有 status 但与 effective 不一致 → 改写。
    const needsStatusInsert = candidate.status === undefined && effective !== undefined;
    const needsStatusSeed = candidate.status === undefined && candidate.positionStatus === undefined;
    const needsStatusRewrite = candidate.status !== undefined && candidate.status !== effective;
    const dropPosition = candidate.positionStatus === 'pending' && candidate.status !== 'pending';

    if (needsStatusSeed) {
      seeded.push(`${candidate.file} ${candidate.id}`);
      edits.insertions.push({ at: candidate.endLine, lines: [`${pad}status: ${effective ?? 'pending'}`] });
    } else if (needsStatusInsert) {
      aligned.push(`${candidate.file} ${candidate.id}（补 status: ${effective}，原只有 position_status）`);
      edits.insertions.push({ at: candidate.endLine, lines: [`${pad}status: ${effective}`] });
    } else if (needsStatusRewrite) {
      aligned.push(`${candidate.file} ${candidate.id}（${candidate.status} → ${effective}）`);
      const line = findLineInBlock(candidate.file, candidate, /^\s+status:/);
      if (line) edits.replacements.set(line, `${pad}status: ${effective}`);
    }
    if (dropPosition) {
      const line = findLineInBlock(candidate.file, candidate, /^\s+position_status:/);
      if (line) edits.deletions.push(line);
    }
    edits.insertions.push({ at: candidate.endLine, lines: renderBlocker(extraction, candidate.indent).split('\n') });
    perFile.set(candidate.file, edits);
  }

  console.log(`机械抽取 blocker：${candidates.length} 个 pending/undeclared 候选（已带 blocker 的跳过）`);
  for (const entry of report) {
    const mark = entry.extraction.missing.length > 0 ? '⚠' : '✓';
    console.log(`  ${mark} ${entry.file} ${entry.id} → kind=${entry.extraction.kind} owner=[${entry.extraction.owner.join(',')}]`);
  }

  console.log(`\nposition_status 对齐回 status：${aligned.length} 条${aligned.length > 0 ? `（${aligned.join('；')}）` : ''}`);
  console.log(`status 由脚本补默认值 pending（原本无状态声明）：${seeded.length} 条${seeded.length > 0 ? `（${seeded.join('；')}）` : ''}`);
  console.log(`trigger 用 kind 派生模板（note 未写明具体事件）：${templated.length} 条`);

  console.log(`\n未命中清单（抽不出 kind 或 owner，交人工判）：${unresolved.length} 条`);
  for (const item of unresolved) {
    console.log(`  ✗ ${item.file} ${item.id} 缺 ${item.missing.join(' + ')}`);
    console.log(`      note 摘录: ${item.note.slice(0, 200)}`);
  }

  if (write) {
    for (const [file, edits] of perFile) applyEdits(file, edits);
    console.log(`\n已写回 ${perFile.size} 个 config 文件。`);
  } else {
    console.log('\n（dry-run；加 --write 才落盘）');
  }

  // 落盘后自校验：抽出的值必须全部落在枚举内，否则立刻显形。
  const badKind = report.filter((entry) => !BLOCKER_KINDS.includes(entry.extraction.kind));
  const badOwner = report.flatMap((entry) => entry.extraction.owner.filter((owner) => !BLOCKER_OWNERS.includes(owner)).map((owner) => `${entry.id}:${owner}`));
  if (badKind.length > 0 || badOwner.length > 0) {
    console.error(`抽取结果越界：kind ${badKind.map((entry) => entry.id).join(',')}；owner ${badOwner.join(',')}`);
    process.exitCode = 1;
  }
  // 未命中清单非空 = 本轮抽取不完整，退出码非零，逼人工处理后再 --write。
  if (unresolved.length > 0) process.exitCode = 1;
}

main();
