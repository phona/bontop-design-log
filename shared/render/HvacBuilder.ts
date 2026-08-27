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
    const item = sources.electrical?.find((point) => point.id === anchor.ref!.id);
    return item ? { x: item.x, y: item.height ?? 0, z: item.z } : undefined;
  }
  const item = sources.outdoor?.find((unit) => unit.id === anchor.ref!.id);
  return item ? { x: item.x, y: item.height / 2, z: item.z } : undefined;
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
