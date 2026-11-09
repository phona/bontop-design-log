/**
 * 待决视图的「现役载体」登记与覆盖自检（issue #98 第六阶段 S2；2026-11-10 修 Codex major）。
 *
 * 由来：PR #122 的 `scripts/docs/generate-pending-view.ts` 原来只消费
 * `collectElements()`——它只枚举电气 / 给排水 / 吊顶三类场景构件。S2 把原量房手账的
 * 「梁体推断」搬成 `config/layout/model-geometry.yaml` 的 `beams` 段后，梁**不是**
 * SceneElement：没有场景 objectId、没有运行期几何消费方，整段既不进构件采集器、
 * 也不进待决视图。旧手账 #1 删除后，按新命令打印的量房清单整类漏掉梁位 / 梁宽 /
 * 梁底实测任务——而当时的覆盖自检只核对「已采集 rows 是否被三张表筛掉」，源侧一整类
 * 没被采集时它没有任何可对账的对象，所以全绿。
 *
 * 本模块把「哪些配置段承载 pending 语义」变成一张**可自检的载体登记表**：
 *
 *   ① 每个载体声明权威文件 + 段路径，并**从源文件独立提取**带 pending 语义的条目 id
 *      （不复用 collectElements 的过滤结果——否则采集器漏掉的类，自检也跟着漏）；
 *   ② 视图生成后逐条比对「源里有、视图里没有」：任何一类整类缺席都在这里炸，
 *      不是只核对已采集 rows 的内部一致性；
 *   ③ 再反向扫 `config/**\/*.yaml`：出现 pending 语义的段必须在表里登记
 *      （消费者或带理由的显式豁免）。新增载体不能靠「没人记得加」静默漏掉。
 *
 * 数据纪律：本模块只读权威 config，不抄任何数值到第二处。梁体条目的邻户读数是指针
 * （`inferred.neighbor_ref` → `config/hvac.yaml` 的 reference_constraints），本模块
 * 原样透传指针；HVAC 参考约束的数值只在它自己的段里出现一次。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import type { ComponentBlocker } from './types.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG_ROOT = path.join(ROOT, 'config');

/** 带 pending 语义的条目的统一形状（待决视图用它排一行）。 */
export interface PendingCarrierItem {
  /** 输出行 id：源名前缀 + 源 id，便于回查权威文件。 */
  id: string;
  /** 视图中「类型」列的值。 */
  kind: string;
  label: string;
  status: string;
  room?: string;
  note?: string;
  blocker: ComponentBlocker;
  /** 现场要量的字段（一句话，直接可执行）。 */
  measure: string;
  /** 当前推断值摘要——逐字来自权威段，标明推断 / 不入施工。 */
  currentValue: string;
}

/** 一个「现役载体」：权威文件里承载 pending 语义的一段。 */
export interface PendingCarrier {
  /** 载体名（自检消息与测试的稳定键）。 */
  id: string;
  /** 权威文件（仓库相对路径）。 */
  file: string;
  /** YAML 段路径；顶层数组记 `(root)`。 */
  section: string;
  /** 载体语义说明（为什么这段该进待决视图）。 */
  description: string;
  /** 源侧提取：这段里带 pending 语义的全部条目，返回**输出行 id**。 */
  pendingIds: () => string[];
  /**
   * 需要并入待决视图的额外行。已经由 `collectElements()` 覆盖的构件载体返回 []——
   * 它们的行由采集器生成，载体只负责源侧对账。
   */
  rows: () => PendingCarrierItem[];
}

/**
 * 一段 YAML 是否声明了 pending 语义。四个标记都是「这条现在不能当已确认事实用」的
 * 结构化写法；只看字段，不看 note 散文（散文匹配留给 collectRows 的补充通道）。
 */
export function hasPendingSemantics(node: Record<string, unknown>): boolean {
  if (node.blocker !== undefined && node.blocker !== null) return true;
  if (node.status === 'pending' || node.status === 'undeclared') return true;
  if (node.construction_status === 'pending') return true;
  if (node.not_for_construction === true) return true;
  return false;
}

function readYamlDocument(file: string): unknown {
  return parseYaml(readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8'));
}

function asRecord(value: unknown, file: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} 顶层不是对象，无法按段读载体`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${what} 缺字符串字段`);
  return value;
}

function requireNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${what} 缺有限数字段`);
  return value;
}

/** 去掉句末标点，拼接时由调用方统一加分号（避免「。；」这种双标点）。 */
function trimSentence(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/[。；;\s]+$/u, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 区间 / 单值统一成「0.35–0.40」这样的显示串；缺字段时显式说缺，不补默认值。 */
function formatSpan(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  if (Array.isArray(value) && value.length === 2) {
    const [min, max] = value as unknown[];
    if (typeof min === 'number' && typeof max === 'number') return `${min.toFixed(2)}–${max.toFixed(2)}`;
  }
  return undefined;
}

function formatRange(range: unknown): string | undefined {
  if (!range || typeof range !== 'object') return undefined;
  const { x1, x2, z1, z2 } = range as Record<string, unknown>;
  if (typeof x1 !== 'number' || typeof x2 !== 'number' || typeof z1 !== 'number' || typeof z2 !== 'number') {
    return undefined;
  }
  return `x ${x1.toFixed(2)}–${x2.toFixed(2)} / z ${z1.toFixed(2)}–${z2.toFixed(2)}`;
}

// ── 构件载体：源侧独立提取（不复用 collectElements 的过滤） ──────────────────

const ELEMENT_CARRIERS = [
  { id: 'element:electrical', file: 'config/electrical.yaml', prefix: 'electrical:' },
  { id: 'element:plumbing', file: 'config/plumbing.yaml', prefix: 'plumbing:' },
  { id: 'element:ceiling', file: 'config/model/envelope/ceiling.yaml', prefix: 'ceiling:' },
] as const;

function collectElementPendingIds(file: string, prefix: string): string[] {
  const doc = readYamlDocument(file);
  if (!Array.isArray(doc)) throw new Error(`${file} 顶层不是数组，构件载体无法按条目读`);
  const ids: string[] = [];
  for (const entry of doc) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (!hasPendingSemantics(record)) continue;
    const id = requireString(record.id, `${file} 的 pending 条目`);
    ids.push(`${prefix}${id}`);
  }
  return ids.sort();
}

// ── layout:beams：S2 从旧手账「梁体推断」表迁入几何文件的量房目标 ─────────────

interface BeamRowSource {
  id: string;
  orientation: string;
  line: { x1: number; x2: number; z1: number; z2: number };
  structure_status: string;
  not_for_construction: boolean;
  inferred: { height?: unknown; width?: unknown; basis: string; neighbor_ref?: string };
  note?: string;
}

function readBeams(): BeamRowSource[] {
  const file = 'config/layout/model-geometry.yaml';
  const doc = asRecord(readYamlDocument(file), file);
  const beams = doc.beams;
  if (!Array.isArray(beams)) throw new Error(`${file} 缺 beams 段：梁体量房目标必须有权威载体`);
  return beams.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${file} beams[${index}] 不是对象`);
    }
    const record = entry as Record<string, unknown>;
    const id = requireString(record.id, `${file} beams[${index}]`);
    const line = record.line as Record<string, unknown> | undefined;
    if (!line) throw new Error(`${file} beams[${index}] (${id}) 缺 line`);
    const inferred = record.inferred as Record<string, unknown> | undefined;
    if (!inferred) throw new Error(`${file} beams[${index}] (${id}) 缺 inferred`);
    return {
      id,
      orientation: requireString(record.orientation, `${file} ${id}.orientation`),
      line: {
        x1: requireNumber(line.x1, `${file} ${id}.line.x1`),
        x2: requireNumber(line.x2, `${file} ${id}.line.x2`),
        z1: requireNumber(line.z1, `${file} ${id}.line.z1`),
        z2: requireNumber(line.z2, `${file} ${id}.line.z2`),
      },
      structure_status: requireString(record.structure_status, `${file} ${id}.structure_status`),
      not_for_construction: record.not_for_construction === true,
      inferred: {
        ...(inferred.height !== undefined ? { height: inferred.height } : {}),
        ...(inferred.width !== undefined ? { width: inferred.width } : {}),
        basis: requireString(inferred.basis, `${file} ${id}.inferred.basis`),
        ...(typeof inferred.neighbor_ref === 'string' ? { neighbor_ref: inferred.neighbor_ref } : {}),
      },
      ...(typeof record.note === 'string' ? { note: record.note } : {}),
    };
  });
}

function beamPositionText(beam: BeamRowSource): string {
  const { x1, x2, z1, z2 } = beam.line;
  if (beam.orientation === 'east_west') {
    return `东西向梁，线 z=${z1.toFixed(2)}，x ${Math.min(x1, x2).toFixed(2)}–${Math.max(x1, x2).toFixed(2)}`;
  }
  if (beam.orientation === 'north_south') {
    return `南北向梁，线 x=${x1.toFixed(2)}，z ${Math.min(z1, z2).toFixed(2)}–${Math.max(z1, z2).toFixed(2)}`;
  }
  return `${beam.orientation} 梁，x ${x1}–${x2} / z ${z1}–${z2}`;
}

function collectBeamRows(): PendingCarrierItem[] {
  const file = 'config/layout/model-geometry.yaml';
  return readBeams().map((beam) => {
    const height = formatSpan(beam.inferred.height);
    const width = formatSpan(beam.inferred.width);
    const inferredText = [
      height ? `梁高 ${height}m（推断）` : '梁高未给区间（见邻户读数指针）',
      width ? `梁宽 ${width}m（推断）` : '梁宽未给区间（见邻户读数指针）',
    ].join('、');
    const pointer = beam.inferred.neighbor_ref ? `；邻户读数指针：${beam.inferred.neighbor_ref}` : '';
    const note = beam.note ? `；${beam.note}` : '';
    return {
      id: `layout:beam:${beam.id}`,
      kind: 'beam',
      label: `结构梁 ${beam.id}`,
      status: beam.structure_status,
      blocker: {
        kind: 'site_measurement',
        owner: ['量房'],
        trigger: `交房量房：实测 ${beam.id} 的梁位、梁宽、梁底标高`,
        reverses_if:
          `实测与推断不符 → 回改 ${file} 的 ${beam.id}（结构梁表）并按实测重算吊顶/HVAC 净空；` +
          '若现场无梁则删除该条目，不保留推断值',
        rationale:
          `structure_status=${beam.structure_status}、not_for_construction=${beam.not_for_construction}：` +
          `推断值不得作为开孔/穿梁/压标高的施工依据。依据：${beam.inferred.basis}${pointer}${note}`,
      },
      measure: `梁位线（${beamPositionText(beam)}）、梁宽、梁底标高`,
      currentValue: `${inferredText}；structure_status=${beam.structure_status}、not_for_construction=${beam.not_for_construction}`,
    };
  });
}

// ── hvac:reference-constraints：梁体读数在 hvac.yaml 的权威副本 ───────────────

interface HvacReferenceRowSource {
  id: string;
  status: string;
  range?: unknown;
  reference_beam_bottom_y?: number;
  reference_bottom_drop_m?: number;
  uncertainty_m?: number;
  source?: string;
  reason?: string;
  risk?: string;
  survey_confirmation?: string;
  not_for_construction?: boolean;
}

function readHvacReferenceConstraints(): HvacReferenceRowSource[] {
  const file = 'config/hvac.yaml';
  const doc = asRecord(readYamlDocument(file), file);
  const plans = doc.plans;
  if (!Array.isArray(plans)) throw new Error(`${file} 缺 plans 段`);
  const constraints: HvacReferenceRowSource[] = [];
  for (const plan of plans) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) continue;
    const diagram = (plan as Record<string, unknown>).diagram;
    if (!diagram || typeof diagram !== 'object' || Array.isArray(diagram)) continue;
    const list = (diagram as Record<string, unknown>).reference_constraints;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      constraints.push({
        id: requireString(record.id, `${file} reference_constraints 条目`),
        status: requireString(record.status, `${file} ${String(record.id)}.status`),
        ...(record.range !== undefined ? { range: record.range } : {}),
        ...(typeof record.reference_beam_bottom_y === 'number'
          ? { reference_beam_bottom_y: record.reference_beam_bottom_y }
          : {}),
        ...(typeof record.reference_bottom_drop_m === 'number'
          ? { reference_bottom_drop_m: record.reference_bottom_drop_m }
          : {}),
        ...(typeof record.uncertainty_m === 'number' ? { uncertainty_m: record.uncertainty_m } : {}),
        ...(typeof record.source === 'string' ? { source: record.source } : {}),
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
        ...(typeof record.risk === 'string' ? { risk: record.risk } : {}),
        ...(typeof record.survey_confirmation === 'string' ? { survey_confirmation: record.survey_confirmation } : {}),
        ...(record.not_for_construction === true ? { not_for_construction: true } : {}),
      });
    }
  }
  return constraints;
}

function collectHvacReferenceRows(): PendingCarrierItem[] {
  const file = 'config/hvac.yaml';
  return readHvacReferenceConstraints().map((constraint) => {
    const range = formatRange(constraint.range);
    const values = [
      range ? `范围 ${range}` : '范围未登记',
      constraint.reference_beam_bottom_y !== undefined
        ? `参考梁底 ${constraint.reference_beam_bottom_y.toFixed(2)}m`
        : '梁底未登记',
      constraint.reference_bottom_drop_m !== undefined
        ? `底沉 ${constraint.reference_bottom_drop_m.toFixed(2)}m`
        : undefined,
      constraint.uncertainty_m !== undefined ? `±${constraint.uncertainty_m.toFixed(2)}m` : undefined,
    ].filter((value): value is string => Boolean(value));
    const evidence = constraint.source ? `来源 ${constraint.source}（邻户参考，非实测）` : '邻户参考，非实测';
    const reason = trimSentence(constraint.reason);
    const survey = trimSentence(constraint.survey_confirmation);
    const risk = trimSentence(constraint.risk);
    return {
      id: `hvac:ref:${constraint.id}`,
      kind: 'hvac_reference_constraint',
      label: `HVAC 参考约束 ${constraint.id}`,
      status: constraint.status,
      blocker: {
        kind: 'site_measurement',
        owner: ['量房'],
        trigger: `交房量房：复核 ${constraint.id} 的梁位、梁宽、梁底标高`,
        reverses_if:
          `实测与邻户参考值不符 → 回改 ${file} 的 ${constraint.id} 及引用它的 MEP 路线/注记；` +
          '若现场无梁则删除该约束，不保留参考值',
        rationale:
          `status=${constraint.status}、not_for_construction=${constraint.not_for_construction === true}：` +
          `${evidence}。${reason ?? '（无 reason）'}` +
          `${survey ? `；量房动作：${survey}` : ''}` +
          `${risk ? `；风险：${risk}` : ''}`,
      },
      measure: '梁位/范围、梁宽、梁底标高（邻户参考约束复核）',
      currentValue: `${values.join('、')}；status=${constraint.status}、not_for_construction=${constraint.not_for_construction === true}`,
    };
  });
}

// ── 载体登记表 ──────────────────────────────────────────────────────────────

/**
 * 现役载体清单。顺序只影响自检消息；行排序仍按 kind + id。
 *
 * 构件载体（electrical / plumbing / ceiling）的 `rows()` 返回 []：它们的行由
 * `collectElements()` + 状态派生生成，这里只从源文件独立提取 id 做逐条对账。
 * 新增「不经过 SceneElement 的 pending 段」时，必须在这里登记，否则下面的
 * `findUnregisteredPendingSections()` 会把它报成未登记载体。
 */
export const PENDING_CARRIERS: readonly PendingCarrier[] = [
  ...ELEMENT_CARRIERS.map((carrier) => ({
    id: carrier.id,
    file: carrier.file,
    section: '(root)',
    description: '场景构件（电气 / 给排水 / 吊顶）：行由 collectElements + 状态派生生成，载体负责源侧逐条对账',
    pendingIds: () => collectElementPendingIds(carrier.file, carrier.prefix),
    rows: () => [],
  })),
  {
    id: 'layout:beams',
    file: 'config/layout/model-geometry.yaml',
    section: 'beams',
    description: 'S2 从旧手账「梁体推断」表迁入的结构梁：无 SceneElement 载体，必须由本表并入量房清单',
    pendingIds: () => readBeams().map((beam) => `layout:beam:${beam.id}`).sort(),
    rows: collectBeamRows,
  },
  {
    id: 'hvac:reference-constraints',
    file: 'config/hvac.yaml',
    section: 'plans.diagram.reference_constraints',
    description: '梁体读数的 hvac 权威副本（邻户参考 + survey_confirmation）：测试/施工前必须现场复核',
    pendingIds: () => readHvacReferenceConstraints().map((c) => `hvac:ref:${c.id}`).sort(),
    rows: collectHvacReferenceRows,
  },
];

/**
 * 带 pending 语义、但**不**进待决视图的段：每条必须给出理由。
 *
 * 判定标准：它不是现场量房对象，且它的 pending 状态没有独立的「卡在谁」语义——
 * 要么是设计/厂家深化中的候选几何，要么是全文件级的 proposal 口径（逐条列出会把
 * 量房清单淹掉）。加新条目必须写清「这些 pending 由谁承载」，不许只写「不需要」。
 */
export interface PendingSectionExemption {
  file: string;
  section: string;
  reason: string;
}

export const PENDING_SECTION_EXEMPTIONS: readonly PendingSectionExemption[] = [
  {
    file: 'config/electrical-topology.yaml',
    section: 'circuits',
    reason:
      '回路/箱位规划状态：pending 来自箱体单双排、空调厂家配电图与回路拆并（见文件头注释），不是现场量房任务；' +
      '点位本体（含各自 blocker）在 config/electrical.yaml，已由 element:electrical 载体覆盖',
  },
  {
    file: 'config/hvac.yaml',
    section: 'plans.diagram.anchors',
    reason:
      '冷凝水/风口候选锚点：pending 属设计与厂家深化（候选几何未冻结），不是量房任务；' +
      '量房相关的梁体读数在同文件 reference_constraints（已登记为 hvac:reference-constraints）',
  },
  {
    file: 'config/hvac.yaml',
    section: 'plans.diagram.terminals',
    reason:
      '风口/冷凝水候选终端：协调示意几何，status pending = 候选未冻结，owner 设计/厂家；' +
      '不是现场量房对象，量房目标在 reference_constraints',
  },
  {
    file: 'config/hvac.yaml',
    section: 'plans.diagram.routes',
    reason:
      '冷凝水候选路由：协调示意几何，候选未冻结；端点/穿墙点由 ceiling anchor 与 plumbing 点位承载；' +
      '不是现场量房对象',
  },
  {
    file: 'config/mep-hvac-coordination.yaml',
    section: 'routes',
    reason:
      'MEP 路线是 proposal 几何：construction_status: pending 是全文件级口径（schema 默认值，所有未确认路线同一状态），' +
      '逐条不是量房任务；路线端点/点位状态由 config/plumbing.yaml 与 config/electrical.yaml 的点位 blocker 承载，' +
      '梁体参考由 hvac reference_constraints 承载',
  },
];

// ── 自检 ────────────────────────────────────────────────────────────────────

export interface CarrierCoverageIssue {
  carrier: string;
  file: string;
  section: string;
  /** 源里有 pending 语义、视图里没有对应行的条目 id。 */
  missing: string[];
}

/**
 * 逐条对账：每个载体从**源文件**提取的 pending 条目，都必须在视图 rows 里出现。
 *
 * 这是 Codex major 的正面修复：原来的自检只核对已采集 rows 的并集 = rows.length，
 * 整类没被采集时没有可对账的源侧条目。现在源侧独立提取，整类缺席会被报出来。
 */
export function checkCarrierCoverage(renderedIds: ReadonlySet<string>): CarrierCoverageIssue[] {
  const issues: CarrierCoverageIssue[] = [];
  for (const carrier of PENDING_CARRIERS) {
    const missing = carrier.pendingIds().filter((id) => !renderedIds.has(id));
    if (missing.length > 0) {
      issues.push({ carrier: carrier.id, file: carrier.file, section: carrier.section, missing });
    }
  }
  return issues;
}

export function formatCarrierCoverage(issues: readonly CarrierCoverageIssue[]): string {
  return [
    '待决视图覆盖不完整：以下载体在源文件里有 pending 语义，但视图里没有对应行——',
    ...issues.map(
      (issue) =>
        `  - ${issue.carrier}（${issue.file} 的 ${issue.section}）：缺 ${issue.missing.length} 条：${issue.missing.join(', ')}`,
    ),
  ].join('\n');
}

/** 生成器入口用：覆盖不全直接抛错，不许打印一份缺类的清单。 */
export function assertCarrierCoverage(renderedIds: ReadonlySet<string>): void {
  const issues = checkCarrierCoverage(renderedIds);
  if (issues.length > 0) throw new Error(formatCarrierCoverage(issues));
}

export interface UnregisteredPendingSection {
  file: string;
  section: string;
  ids: string[];
}

/** 扫 config 下全部 YAML，按「文件 + 段路径」收集带 pending 语义的条目 id。 */
function scanPendingSections(configRoot: string = CONFIG_ROOT): Map<string, UnregisteredPendingSection> {
  const found = new Map<string, UnregisteredPendingSection>();
  const visit = (node: unknown, file: string, section: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, file, section);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (hasPendingSemantics(record)) {
      const key = `${file}\u0000${section || '(root)'}`;
      const entry =
        found.get(key) ??
        { file, section: section || '(root)', ids: [] };
      const id = typeof record.id === 'string' ? record.id : '(no-id)';
      if (!entry.ids.includes(id)) entry.ids.push(id);
      found.set(key, entry);
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (childKey === 'blocker') continue;
      visit(child, file, section ? `${section}.${childKey}` : childKey);
    }
  };

  const files: string[] = [];
  const walkDir = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (/\.ya?ml$/.test(name)) files.push(full);
    }
  };
  walkDir(configRoot);
  for (const full of files) {
    const file = path.relative(ROOT, full);
    visit(readYamlDocument(file), file, '');
  }
  return found;
}

/**
 * 反向自检：config 里出现 pending 语义的每个段，都必须已登记（消费者或显式豁免）。
 *
 * 这一条防的是「新增一类 pending 载体时没人记得加进视图」——包括本次的形态：
 * S2 把梁搬进 model-geometry.yaml，采集器与视图都没跟上，而当时的自检无从发现。
 * 现在同一形态会在这里报 `未登记的 pending 载体段`，必须二选一：并入视图，或写清豁免理由。
 */
export function findUnregisteredPendingSections(configRoot: string = CONFIG_ROOT): UnregisteredPendingSection[] {
  const registered = new Set(PENDING_CARRIERS.map((carrier) => `${carrier.file}\u0000${carrier.section}`));
  const exempted = new Set(PENDING_SECTION_EXEMPTIONS.map((item) => `${item.file}\u0000${item.section}`));
  for (const key of registered) {
    if (exempted.has(key)) {
      throw new Error(`pending 载体段既登记又豁免（表里两份说法）：${key.replace('\u0000', ' ')}`);
    }
  }
  const unregistered: UnregisteredPendingSection[] = [];
  for (const [key, entry] of scanPendingSections(configRoot)) {
    if (registered.has(key) || exempted.has(key)) continue;
    unregistered.push({ file: entry.file, section: entry.section, ids: [...entry.ids].sort() });
  }
  return unregistered.sort((a, b) => a.file.localeCompare(b.file) || a.section.localeCompare(b.section));
}

export function formatUnregisteredPendingSections(sections: readonly UnregisteredPendingSection[]): string {
  return [
    '发现未登记的 pending 载体段（config 里有 pending 语义，但 PENDING_CARRIERS 没登记、也没写豁免理由）：',
    ...sections.map((section) => `  - ${section.file} 的 ${section.section}：${section.ids.length} 条（${section.ids.slice(0, 5).join(', ')}${section.ids.length > 5 ? '…' : ''}）`),
    '请把它并入待决视图（登记载体并生成行），或在 PENDING_SECTION_EXEMPTIONS 写明为什么它不是量房/待决对象。',
  ].join('\n');
}

export function assertNoUnregisteredPendingSections(): void {
  const sections = findUnregisteredPendingSections();
  if (sections.length > 0) throw new Error(formatUnregisteredPendingSections(sections));
}
