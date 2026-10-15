/**
 * F08/F09 的场景采集：buildScene 实际产出了哪些面层网格、它们各停在什么位置。
 *
 * 声明是一回事，**场景里有没有实体是另一回事**。`computePaintScope` 照样按声明算面积
 * 进预算，而 3D 里那块什么都没有——预算算了钱、现场找不到活儿。所以要把「声明 → 场景
 * 实体」的对应关系做成门禁级检查，而不仅靠测试断言 `report.unsupported` 为空。
 *
 * F09 更进一步：F08 只查「声明的 id 在不在场景里」，查不出**网格存在但位置错了**。
 * 弧墙（圆角）上 `mid = 起终点弦中点` 让整块砖面飘 0.50m，F08 一声不响。所以这里同时
 * 采集每块面层网格的**世界包围盒中心**与它的**附着锚点**（userData 里的 wallId /
 * elementId），以及 bay_sill 构件的 footprint——后者是 sill 类网格唯一的锚。
 *
 * 与 `shared/penetration/scene.ts` 同构：verifier 与测试共用同一份采集，结论不会漂移。
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Box3 } from 'three';
import { loadCeilingConfig } from '../../server/config-loader.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { buildScene } from '../render/SceneBuilder.js';
import { buildBaySillGeometry } from '../render/BaySillGeometry.js';
import type { FinishSceneMesh } from './rules.js';

export type { FinishSceneMesh, FinishMeshAnchor } from './rules.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** 面层核查关心的网格类型（userData.type）。其余（墙/门/家具/吊顶…）与 F09 无关。 */
const FINISH_MESH_TYPES = ['wall_region', 'paint_region', 'sill_region', 'paint_sill_region'] as const;

export interface FinishSceneMeshes {
  /** buildScene 产出的全部 objectId。门洞会把一段声明拆成 `${id}:s${n}`。 */
  meshIds: Set<string>;
  /** 有 ceiling 网格的房间（objectId = `ceiling:<room>`）。 */
  ceilingRooms: Set<string>;
  /**
   * 每块面层网格的世界包围盒中心（key = objectId）。F09 判「贴不贴墙」就拿它和锚几何比。
   *
   * 只收面层网格：ceiling 之类父组与子网格共用一个 objectId，全收会互相覆盖。
   * 另注意 objectId **不保证唯一**——`computePaintSillScope` 的 start_end 与 end_end
   * 都产 `${id}:${i}`，真实配置里 `paint_master_bedroom_west_bay:0` 就被两块网格共用
   * （154 块网格、153 个 id）。按 id 收敛必然丢一块，所以**逐块判据必须用 `meshes`**，
   * 本 Map 只是 id → 中心的视图（后者覆盖前者）。
   */
  meshCentres: Map<string, { x: number; z: number }>;
  /** 逐块清单（含中心与锚点）。F09 遍历它，一块都不漏。 */
  meshes: FinishSceneMesh[];
  /** bay_sill 构件的 footprint 多边形（key = 构件 id）。sill 类网格的锚。 */
  bayOutlines: Map<string, Array<{ x: number; z: number }>>;
}

export function collectFinishSceneMeshes(layout: { walls: unknown[]; rooms: unknown[] }): FinishSceneMeshes {
  const overlay = parseOverlay(readFileSync(path.join(ROOT, 'config/layout/overlay.yaml'), 'utf8'));
  const elements = mergeSceneElements(layout.walls as any, overlay);
  const scene = buildScene({
    walls: layout.walls,
    rooms: layout.rooms,
    elements: elements as any,
    ceilingZones: loadCeilingConfig(),
    furnishings: {},
  } as any);
  const root: any = (scene as any).exportRoot ?? (scene as any).root ?? scene;
  const meshIds = new Set<string>();
  const ceilingRooms = new Set<string>();
  const meshCentres = new Map<string, { x: number; z: number }>();
  const meshes: FinishSceneMesh[] = [];
  root.traverse((object: any) => {
    const objectId = object?.userData?.objectId as string | undefined;
    if (objectId) meshIds.add(objectId);
    const type = object?.userData?.type as string | undefined;
    if (type === 'ceiling' && objectId?.startsWith('ceiling:')) {
      ceilingRooms.add(String(object.userData.roomId ?? objectId.slice('ceiling:'.length)));
    } else if (type === 'ceiling_zone_solid' && typeof object.userData.roomId === 'string') {
      // Explicit ceiling zones (including zones owned by semantic_only rooms) are real
      // ceiling geometry too. Include them so paint_ceiling_region checks do not infer
      // an unattached surface merely because no default room ceiling was generated.
      ceilingRooms.add(object.userData.roomId);
    }
    if (!objectId || !type || !(FINISH_MESH_TYPES as readonly string[]).includes(type)) return;
    // 包围盒中心：Box3.setFromObject 用 geometry.boundingBox 过 matrixWorld，
    // 对面层网格这种 PlaneGeometry/ShapeGeometry 是精确的（盒的 8 个角就是平面的 4 个角）。
    object.updateWorldMatrix(true, false);
    const box = new Box3().setFromObject(object);
    const centre = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
    meshCentres.set(objectId, centre);
    meshes.push({
      objectId,
      centre,
      type,
      ...(typeof object.userData.kind === 'string' ? { kind: object.userData.kind } : {}),
      ...(typeof object.userData.face === 'string' ? { face: object.userData.face } : {}),
      ...(typeof object.userData.wallId === 'string' ? { wallId: object.userData.wallId } : {}),
      ...(typeof object.userData.elementId === 'string' ? { elementId: object.userData.elementId } : {}),
    });
  });

  // bay footprint 必须和 SceneBuilder 出网时同源（同一份 mergeSceneElements 结果），
  // 否则「预算算的面积」与「判定用的锚」会是两套几何。建不出来的 bay 不进表——
  // 引用它的网格会在 F09 报 unknown_anchor（fail-closed），不会静默跳过。
  const bayOutlines = new Map<string, Array<{ x: number; z: number }>>();
  for (const element of elements as any[]) {
    if (element?.type !== 'bay_sill' || !element.wallRefs?.length) continue;
    try {
      bayOutlines.set(element.id, buildBaySillGeometry(element.wallRefs, layout.rooms as any, element.depth).outline);
    } catch {
      // 留给 F09 报 unknown_anchor
    }
  }
  return { meshIds, ceilingRooms, meshCentres, meshes, bayOutlines };
}
