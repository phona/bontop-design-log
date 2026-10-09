import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseCeilingZones, parseElectricalPoints, parsePlumbingPoints, parseProjectHvacFacts } from './project-render-facts-schema.js';
import type { ElementInput, ElementKind } from './element-state.js';

/**
 * 构件采集：从权威配置里读出「有哪些构件、各自的声明状态」。
 *
 * 与 `element-state.ts`（纯派生）分开：这里做 I/O，那里不做。CLI 与测试共用同一份
 * 采集，避免「CLI 采一套、测试另写一套」导致计数对不上。
 *
 * 几何与状态一律来自配置，本模块不推断、不补默认值。
 */

const ROOT = path.resolve(import.meta.dirname, '..');

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

function extractDecision(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const match = note.match(/DEC-\d{4}-\d{2}-\d{2}-[A-Za-z0-9.]+/);
  return match ? match[0] : undefined;
}

/** 承载场景构件的配置 → objectId 前缀。 */
export const ELEMENT_SOURCES = {
  electrical: 'config/electrical.yaml',
  plumbing: 'config/plumbing.yaml',
  ceiling: 'config/ceiling.yaml',
  hvac: 'config/hvac.yaml',
} as const;

/**
 * HVAC 状态词（config/hvac.yaml 的 `anchor.status`）→ 统一状态词（ElementState 词汇）映射。
 *
 * HVAC 用 confirmed / inferred / pending；电气/给排水用 measured / likely / inferred / pending。
 * 两套词汇在 `config/state-model.yaml` 的 `status_vocabulary` 里已对齐，HVAC 三个词恰好都是
 * 合法键、且同名同义，因此这里做**同名透传**，并显式列表以防未来词汇漂移：
 *
 *   HVAC `confirmed` → `confirmed`：有成交/裁定依据的确认（如 DEC-2026-10-04-R1 房间映射业主
 *                                 确认）。它对应 ElementState 的 confirmed——「有依据的确认」，
 *                                 而非电气的 measured（实测几何）/likely（未核实估计）。
 *   HVAC `inferred`  → `inferred` ：按邻户图、吊顶走向等示意，未经自家量房核实——与电气 inferred 同义。
 *   HVAC `pending`   → `pending`  ：明确待量房/厂家深化、未冻结——与电气 pending 同义。
 *
 * 之所以 confirmed 直接对应 confirmed：ElementState 词汇里 confirmed 的语义就是「有依据的裁定」，
 * 与 HVAC confirmed（成交/业主确认）吻合；把它降级成 inferred 会抹掉已有的成交依据。
 */
const HVAC_STATUS_TO_ELEMENT_STATE: Record<string, string> = {
  confirmed: 'confirmed',
  inferred: 'inferred',
  pending: 'pending',
};

/** 把 HVAC anchor 的 status 映射成 ElementState 词汇（未知词直接抛错，不静默猜测）。 */
export function mapHvacStatus(status: string): string {
  const mapped = HVAC_STATUS_TO_ELEMENT_STATE[status];
  if (!mapped) throw new Error(`Unknown HVAC status: ${status}`);
  return mapped;
}

/**
 * 保守度排序：confirmed 最确认、pending 最不确认。数值越大越不确认。
 * 同一 ceiling id 被多个 anchor 引用时取**最不确认**的那个状态。
 */
const HVAC_CONSERVATISM_RANK: Record<string, number> = { confirmed: 0, inferred: 1, pending: 2 };
function hvacConservatismRank(status: string): number {
  return HVAC_CONSERVATISM_RANK[status] ?? Number.MAX_SAFE_INTEGER;
}

/** 一个 ceiling id 上合并后的 HVAC 绑定结果。 */
export interface CeilingHvacBinding {
  /** 合并后的统一状态词（ElementState 词汇，可直接作 configStatus）。 */
  status: string;
  /** 权威出处：config/hvac.yaml + 全部 anchor id + 各自 status/reason，供 statusSource 追溯。 */
  statusSource: string;
  /** 引用该 ceiling id 的全部 anchor id（按 id 排序）。 */
  anchorIds: string[];
}

/**
 * 合并指向同一 ceiling id 的多个 HVAC anchor。
 *
 * 规则：**取最保守（最不确认）的状态**。一个内机往往同时被 refrigerant / power / condensate
 * 三个 anchor 引用；只要其中一条还没确认（如冷凝水仍 pending），整个构件就不能按 confirmed
 * 计——否则「电源 confirmed」会把「冷凝水仍 pending」盖掉，掩盖真实待核项。statusSource 里
 * **列出全部 anchor id**，不许只报一个，保证可追溯。
 */
export function mergeCeilingHvacAnchors(
  anchors: Array<{ id: string; status: string; reason?: string }>,
): CeilingHvacBinding {
  const sorted = [...anchors].sort((a, b) => a.id.localeCompare(b.id));
  let status = sorted[0].status;
  for (const anchor of sorted) {
    if (hvacConservatismRank(anchor.status) > hvacConservatismRank(status)) status = anchor.status;
  }
  const detail = sorted
    .map((anchor) => `${anchor.id}:${anchor.status}${anchor.reason?.trim() ? ` (${anchor.reason.trim()})` : ''}`)
    .join(' | ');
  const statusSource = `config/hvac.yaml ${sorted.length > 1 ? 'anchors' : 'anchor'} ${detail}`;
  return { status: mapHvacStatus(status), statusSource, anchorIds: sorted.map((anchor) => anchor.id) };
}

/**
 * 从 config/hvac.yaml 解析出「指回 ceiling 构件」的 HVAC 权威状态。
 *
 * 用项目现成的 `parseProjectHvacFacts`（zod 严格解析，禁止自己正则刮 yaml）。只取
 * `ref.source === 'ceiling'` 的 anchor（power_* 指 electrical、outdoor_a2 指 outdoor，均不在此列），
 * 按 `ref.id` 聚到对应 `ceiling:<id>` 构件上并合并成一条绑定。
 */
function collectCeilingHvacBindings(raw: string): Map<string, CeilingHvacBinding> {
  const byCeilingId = new Map<string, Array<{ id: string; status: string; reason?: string }>>();
  const facts = parseProjectHvacFacts(raw);
  for (const plan of facts.plans) {
    for (const anchor of plan.diagram.anchors) {
      if (anchor.ref?.source !== 'ceiling') continue;
      const list = byCeilingId.get(anchor.ref.id) ?? [];
      list.push({ id: anchor.id, status: anchor.status, ...(anchor.reason ? { reason: anchor.reason } : {}) });
      byCeilingId.set(anchor.ref.id, list);
    }
  }
  const bindings = new Map<string, CeilingHvacBinding>();
  for (const [ceilingId, anchors] of byCeilingId) bindings.set(ceilingId, mergeCeilingHvacAnchors(anchors));
  return bindings;
}

export function collectElements(): ElementInput[] {
  const elements: ElementInput[] = [];

  for (const point of parseElectricalPoints(read(ELEMENT_SOURCES.electrical))) {
    const note = (point as { note?: string }).note;
    const decision = extractDecision(note);
    elements.push({
      id: `electrical:${point.id}`,
      kind: 'electrical',
      label: `${point.type} ${point.id}`,
      ...(point.room ? { room: point.room } : {}),
      // position_status 优先于 status：前者描述「这个位置准不准」，后者描述「这项定没定」
      ...(point.position_status ? { configStatus: point.position_status } : point.status ? { configStatus: point.status } : {}),
      ...(decision ? { decision } : {}),
    });
  }

  for (const point of parsePlumbingPoints(read(ELEMENT_SOURCES.plumbing))) {
    const note = (point as { note?: string }).note;
    const decision = extractDecision(note);
    // 与电气同口径：position_status（位置准不准）优先于 status（这项定没定）。
    // 早期只读 position_status，导致已有 `status: inferred` 的给排水点被误判成 undeclared。
    const positionStatus = (point as { position_status?: string }).position_status;
    const itemStatus = (point as { status?: string }).status;
    elements.push({
      id: `plumbing:${point.id}`,
      kind: 'plumbing',
      label: `${point.type} ${point.id}`,
      ...(point.room ? { room: point.room } : {}),
      ...(positionStatus ? { configStatus: positionStatus } : itemStatus ? { configStatus: itemStatus } : {}),
      ...(decision ? { decision } : {}),
    });
  }

  // HVAC 权威状态：config/hvac.yaml 的 anchor 通过 `ref.source: ceiling` 指回 ceiling 构件，
  // 并带有成交/示意级 status。采集器此前没读 hvac.yaml，导致 6 个 ac_* 内机虽是成交确认件
  // 却被判 undeclared——这是「权威状态本就存在、采集器没去读」，不是缺申报。
  const hvacCeilingBindings = collectCeilingHvacBindings(read(ELEMENT_SOURCES.hvac));

  for (const zone of parseCeilingZones(read(ELEMENT_SOURCES.ceiling))) {
    const decision = extractDecision(zone.note);
    const hvac = hvacCeilingBindings.get(zone.id);
    elements.push({
      id: `ceiling:${zone.id}`,
      kind: (zone.type === 'ac_indoor' ? 'hvac' : 'ceiling') as ElementKind,
      label: `${zone.type} ${zone.id}`,
      ...(zone.room ? { room: zone.room } : {}),
      // HVAC anchor 的 status（已映射成 ElementState 词汇）与出处覆盖 config_status 默认格式，
      // 使 statusSource 能说清「来自 config/hvac.yaml 的哪条 anchor、依据是什么」。
      ...(hvac ? { configStatus: hvac.status, configStatusSource: hvac.statusSource } : {}),
      ...(decision ? { decision } : {}),
    });
  }

  return elements;
}

/** 这些配置里出现过的 type 取值——用于把台账里的 `ac_indoor` 这类类型引用与元素 id 区分开。 */
export function collectKnownTypes(): Set<string> {
  const types = new Set<string>();
  for (const point of parseElectricalPoints(read(ELEMENT_SOURCES.electrical))) types.add(String(point.type));
  for (const point of parsePlumbingPoints(read(ELEMENT_SOURCES.plumbing))) types.add(String(point.type));
  for (const zone of parseCeilingZones(read(ELEMENT_SOURCES.ceiling))) types.add(String(zone.type));
  return types;
}
