import type { CeilingZone, ElectricalPoint, HvacAnchor, HvacDiagram, HvacTerminal, ProjectHvacFacts, ProjectRenderFactsProjection, Vec3, VrfOutdoorUnit } from '../types.js';
import { resolvePointPlacementInWalls, type PointMountHost, type PointWall } from '../point-placement.js';
import { normalizeCeilingZone } from '../ceiling-zone.js';

export interface HvacBuilderSources {
  ceiling?: CeilingZone[];
  electrical?: ElectricalPoint[];
  outdoor?: VrfOutdoorUnit[];
  /**
   * 点位宿主墙索引（issue #98 S3）：电气 ref 的平面坐标走 shared/point-placement.ts 单一
   * 解算——沿墙点位（sock_child_ac 等）不再声明绝对 x/z，直读声明值会丢锚点。
   */
  pointWalls?: ReadonlyMap<string, PointWall>;
  /**
   * mount 挂载点位的家具宿主索引（issue #98 S2，第五阶段 S1 补字段）：与 pointWalls 同批
   * 透传给解算器。暖通 anchor 今天不引用 mount 点位，故补它不改变解果；缺字段则将来一旦
   * 引用即静默解不出（B F6 潜伏缺口：10 个 endpointSourcesFromFacts 装配点必须带全两份索引）。
   */
  mountHosts?: ReadonlyMap<string, PointMountHost>;
}

export interface HvacBuilderSourceInput {
  projection?: ProjectRenderFactsProjection;
  ceiling?: CeilingZone[];
  electrical?: ElectricalPoint[];
  hvac?: ProjectHvacFacts;
  outdoor?: VrfOutdoorUnit[];
  /** 点位宿主墙索引（issue #98 S3）：透传给 HvacBuilderSources.pointWalls。 */
  pointWalls?: ReadonlyMap<string, PointWall>;
  /** 家具宿主索引（issue #98 S2 / 第五阶段 S1）：透传给 HvacBuilderSources.mountHosts。 */
  mountHosts?: ReadonlyMap<string, PointMountHost>;
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
    ...(input.pointWalls ? { pointWalls: input.pointWalls } : {}),
    ...(input.mountHosts ? { mountHosts: input.mountHosts } : {}),
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

/**
 * anchor 定位解析。返回 `{ position }` 或 `{ diagnostic }`——**不返回 undefined 让调用方
 * 猜**（issue #98 S1，E7：原 `if (!position) continue` 让 projection-only 源静默丢掉
 * 6/47 个 power anchor，导出检查还自产期望集报 ready=true，A §2c/§4.1）。
 */
function resolveAnchor(anchor: HvacAnchor, sources: HvacBuilderSources): { position: Vec3; diagnostic?: undefined } | { position?: undefined; diagnostic: string } {
  if (anchor.position) return { position: anchor.position };
  if (!anchor.ref) return { diagnostic: `hvac anchor ${anchor.id}: 既无 position 也无 ref，无法定位（禁止静默跳过）` };
  if (anchor.ref.source === 'ceiling') {
    const item = sources.ceiling?.find((zone) => zone.id === anchor.ref!.id);
    if (!item) return { diagnostic: `hvac anchor ${anchor.id}: ref ceiling 宿主 "${anchor.ref.id}" 不在来源里（断引用）` };
    // area-only 分区经 shared/ceiling-zone.ts 归一（与 MEP resolveMepEndpoint 同一实现，E F-2）。
    const zone = normalizeCeilingZone(item);
    if (zone.x === undefined || zone.z === undefined) return { diagnostic: `hvac anchor ${anchor.id}: ceiling 宿主 "${anchor.ref.id}" 无 x/z 且无 area，平面中心解不出` };
    return { position: { x: zone.x, y: zone.height ?? 2.85, z: zone.z } };
  }
  if (anchor.ref.source === 'electrical') {
    // issue #98 S3：坐标走 shared/point-placement.ts 单一解算（与 MEP resolveMepEndpoint 的
    // ref 解析同源）。绝对点位解果即声明值；沿墙点位（sock_child_ac）不再声明绝对 x/z，
    // 必须由调用方经 sources.pointWalls 提供宿主墙索引——缺索引即解析失败显形，不拿
    // undefined 当坐标。（暖通对象化仍属阶段五，本段只保证坐标单一解算。）
    const item = sources.electrical?.find((point) => point.id === anchor.ref!.id);
    if (!item) return { diagnostic: `hvac anchor ${anchor.id}: ref electrical 宿主 "${anchor.ref.id}" 不在来源里（断引用，或调用方未传 electrical）` };
    const { placement, diagnostic } = resolvePointPlacementInWalls(item, sources.pointWalls, sources.mountHosts);
    if (!placement) return { diagnostic: `hvac anchor ${anchor.id}: ${diagnostic ?? '点位定位解算失败'}` };
    return { position: { x: placement.x, y: item.height ?? 0, z: placement.z } };
  }
  const item = sources.outdoor?.find((unit) => unit.id === anchor.ref!.id);
  if (!item) return { diagnostic: `hvac anchor ${anchor.id}: ref outdoor 宿主 "${anchor.ref.id}" 不在来源里（断引用）` };
  return { position: { x: item.x, y: item.height / 2, z: item.z } };
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
    const resolved = resolveAnchor(anchor, sources);
    if (resolved.position) positions.set(anchor.id, { x: resolved.position.x, z: resolved.position.z });
  }
  return positions;
}

/** Shared Web/CLI contract for exportable HVAC entities. */
export function buildHvacEntityDescriptors(planId: string, diagram: HvacDiagram, sources: HvacBuilderSources = { ceiling: [], electrical: [], outdoor: [] }, diagnostics?: string[]): HvacEntityDescriptor[] {
  const entities: HvacEntityDescriptor[] = [];
  const seen = new Set<string>();
  for (const anchor of diagram.anchors) {
    // Confirmed equipment refs and explicitly positioned coordination anchors are renderable.
    if (anchor.status !== 'confirmed' && !anchor.position) continue;
    const objectId = `hvac:${planId}:anchor:${anchor.id}`;
    if (seen.has(objectId)) continue;
    seen.add(objectId);
    const resolved = resolveAnchor(anchor, sources);
    // issue #98 S1（E7）：解析失败记诊断后跳过，禁止静默 continue。诊断经 SceneBuilder 的
    // placementDiagnostics 通道上浮（3D 控制台 + verify-spatial + DXF/GLB 装配日志）。
    if (!resolved.position) {
      diagnostics?.push(resolved.diagnostic);
      continue;
    }
    entities.push({ objectId, kind: 'anchor', position: resolved.position, status: anchor.status, system: anchor.system, source: anchor });
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

/**
 * 导出期望集（issue #98 S1，E7 独立化）：按**声明态**枚举可渲染实体的 id——**不解析位置**。
 *
 * 为什么不再过 buildHvacEntityDescriptors：期望集的职责是「config 声明了哪些可导出实体」，
 * 必须与「本次装配解算出几个」解耦。若期望集也走同一解算器，则源缺件（调用方少传
 * pointWalls / electrical）时期望集同步缩水——「场景里没有」与「期望里也没有」同时成立，
 * ready 恒真，这正是 A §4.1 记的自产期望集失效模式（旧写法 `[...index.all.keys()]` 与
 * 「期望集过同一解算器」是同一个病的两种形态）。
 *
 * 声明态口径与 buildHvacEntityDescriptors 的过滤一致（confirmed 或带 position 的 anchor +
 * 非冷凝候选 terminal），但这个「一致」不是抄来的恒等——它由
 * tests/server/hvac-mep-drift-guard.test.ts 与 scripts/verify/project/verify-project-render-facts.ts
 * 里**独立推导**的 id 集合逐 id 对账（两侧任一侧漂移即红）。
 */
export function expectedHvacExportIds(planId: string, diagram: HvacDiagram): string[] {
  return [
    ...diagram.anchors
      .filter((anchor) => anchor.status === 'confirmed' || anchor.position !== undefined)
      .map((anchor) => `hvac:${planId}:anchor:${anchor.id}`),
    ...diagram.terminals
      .filter((terminal) => terminal.kind !== 'condensate_drain_candidate')
      .map((terminal) => `hvac:${planId}:terminal:${terminal.id}`),
  ];
}
