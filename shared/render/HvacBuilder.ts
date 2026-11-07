import type { CeilingZone, ElectricalPoint, HvacAnchor, HvacDiagram, HvacTerminal, ProjectHvacFacts, ProjectRenderFactsProjection, Vec3, VrfOutdoorUnit } from '../types.js';

export interface HvacBuilderSources {
  ceiling?: CeilingZone[];
  electrical?: ElectricalPoint[];
  outdoor?: VrfOutdoorUnit[];
}

export interface HvacBuilderSourceInput {
  projection?: ProjectRenderFactsProjection;
  ceiling?: CeilingZone[];
  electrical?: ElectricalPoint[];
  hvac?: ProjectHvacFacts;
  outdoor?: VrfOutdoorUnit[];
}

function normalizeCeilingZone(zone: CeilingZone): CeilingZone {
  if (zone.x !== undefined && zone.z !== undefined) return { ...zone };
  if (zone.area) {
    const [x1, z1, x2, z2] = zone.area;
    return { ...zone, x: (x1 + x2) / 2, z: (z1 + z2) / 2 };
  }
  return { ...zone };
}

function uniqueById<T extends { id: string }>(items: T[] | undefined): T[] {
  const seen = new Set<string>();
  return (items ?? []).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).map((item) => ({ ...item }));
}

export function buildHvacBuilderSources(input: HvacBuilderSourceInput = {}): HvacBuilderSources {
  const projection = input.projection;
  const ceiling = projection?.ceiling ?? input.ceiling ?? [];
  const electrical = input.electrical ?? [];
  const planId = projection?.hvac.status === 'implemented' ? projection.hvac.planId : undefined;
  const outdoor = input.outdoor ?? (planId ? input.hvac?.plans.find((plan) => plan.id === planId)?.outdoor ? [input.hvac.plans.find((plan) => plan.id === planId)!.outdoor] : [] : []);
  return {
    ceiling: uniqueById(ceiling).map(normalizeCeilingZone),
    electrical: uniqueById(electrical),
    outdoor: uniqueById(outdoor),
  };
}

export interface HvacEntityDescriptor {
  objectId: string;
  kind: 'anchor' | 'terminal';
  position: Vec3;
  status: HvacAnchor['status'];
  system: HvacAnchor['system'];
  source: HvacAnchor | HvacTerminal;
}

function resolveAnchor(anchor: HvacAnchor, sources: HvacBuilderSources): Vec3 | undefined {
  if (anchor.position) return anchor.position;
  if (!anchor.ref) return undefined;
  if (anchor.ref.source === 'ceiling') {
    const item = sources.ceiling?.find((zone) => zone.id === anchor.ref!.id);
    return item?.x === undefined || item.z === undefined ? undefined : { x: item.x, y: item.height ?? 2.85, z: item.z };
  }
  if (anchor.ref.source === 'electrical') {
    // 暖通 ref 通道本期不改走点位解算器（阶段五暖通的前置，见设计文档 §6.3）：x/z 是断言字段，
    // 全量点位在迁移期内恒有值；缺值即解析失败显形，不拿 undefined 当坐标。
    const item = sources.electrical?.find((point) => point.id === anchor.ref!.id);
    if (!item || item.x === undefined || item.z === undefined) return undefined;
    return { x: item.x, y: item.height ?? 0, z: item.z };
  }
  const item = sources.outdoor?.find((unit) => unit.id === anchor.ref!.id);
  return item ? { x: item.x, y: item.height / 2, z: item.z } : undefined;
}

/**
 * hvac.yaml anchors（id → 平面位置），含 ref 链解析（issue #98 PR-10）。
 *
 * 家具锚点派生（house.yaml `anchor: {source: 'hvac', id: 'indoor_master'}`）要按 id 引用
 * 内机锚点，与 MEP `resolveMepEndpoint` 的 ref 解析同源；渲染只画 confirmed/带 position
 * 的实体（buildHvacEntityDescriptors），这里不套那层过滤——协调链要能引用 pending 态锚点。
 */
export function hvacAnchorPositions(diagram: HvacDiagram, sources: HvacBuilderSources = {}): Map<string, { x: number; z: number }> {
  const positions = new Map<string, { x: number; z: number }>();
  for (const anchor of diagram.anchors) {
    const position = resolveAnchor(anchor, sources);
    if (position) positions.set(anchor.id, { x: position.x, z: position.z });
  }
  return positions;
}

/** Shared Web/CLI contract for exportable HVAC entities. */
export function buildHvacEntityDescriptors(planId: string, diagram: HvacDiagram, sources: HvacBuilderSources = { ceiling: [], electrical: [], outdoor: [] }): HvacEntityDescriptor[] {
  const entities: HvacEntityDescriptor[] = [];
  const seen = new Set<string>();
  for (const anchor of diagram.anchors) {
    // Confirmed equipment refs and explicitly positioned coordination anchors are renderable.
    if (anchor.status !== 'confirmed' && !anchor.position) continue;
    const objectId = `hvac:${planId}:anchor:${anchor.id}`;
    if (seen.has(objectId)) continue;
    seen.add(objectId);
    const position = resolveAnchor(anchor, sources);
    if (!position) continue;
    entities.push({ objectId, kind: 'anchor', position, status: anchor.status, system: anchor.system, source: anchor });
  }
  for (const terminal of diagram.terminals) {
    if (terminal.kind === 'condensate_drain_candidate') continue;
    const objectId = `hvac:${planId}:terminal:${terminal.id}`;
    if (seen.has(objectId)) continue;
    seen.add(objectId);
    entities.push({ objectId, kind: 'terminal', position: terminal.position, status: terminal.status, system: terminal.system, source: terminal });
  }
  return entities;
}

export function expectedHvacExportIds(planId: string, diagram: HvacDiagram): string[] {
  return buildHvacEntityDescriptors(planId, diagram).map((entity) => entity.objectId);
}
