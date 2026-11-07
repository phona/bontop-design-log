/**
 * 面层核查的输入装配（finish-scope 层唯一实现）。
 *
 * 2026-11-07 issue #98 第三阶段 S4：面层配方下沉为对象特征后，本模块是「config → 核查输入」
 * 的唯一装配点——此前同一段装配在 scripts/verify/finish/verify-finish-scope.ts 与
 * tests/server/finish-scope.test.ts 各存一份（连 `/^walltile/` 这种按 id 前缀猜分类的
 * 反模式都抄了两遍）。现在两边都 import 这里，配方来源改了只改一处。
 *
 * 数据来源（S4 后）：
 *   贴砖带 / 涂装带 → config/layout/model-geometry.yaml 墙条目 finish.tile_bands / paint_bands
 *   防水台贴砖 / 飘窗涂装 → config/model/envelope/openings.yaml bay_sill 条目 finish.tile / paint
 *   顶面涂装 → model-geometry.yaml 房间条目 ceiling_finish
 * 判定层（shared/finish/rules.ts）只认 FinishWallSpan / FinishSillClaim 抽象，不关心声明住哪。
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { loadCeilingConfig } from '../../server/config-loader.js';
import { loadOverlayDoc } from '../../server/overlay-merge.js';
import { openingsAlongWall } from '../wall-segments.js';
import { collectFinishSceneMeshes } from './scene.js';
import { loadFinishLintConfig, SOURCE } from './registry.js';
import type { FinishScopeInput } from './rules.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

function readYaml(file: string): any {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8'));
}

/** config → 核查输入。verifier 与测试共用同一份装配，结论不会两边漂移。 */
export function buildFinishScopeInput(tolerance = 0.01): FinishScopeInput {
  const MG = readYaml('config/layout/model-geometry.yaml');
  const OV = loadOverlayDoc();
  const layout = resolveLayout(MG);
  const elements: any[] = OV.elements ?? [];
  const vertexById = new Map((MG.vertices ?? []).map((v: any) => [v.id, v]));

  // 面层配方下沉（S4）：带在 tile_bands 里就是砖、在 paint_bands 里就是漆——**类型即语义，
  // 不再按 id 前缀猜**（原 `/^walltile/` 正则是「按名字猜身份」的反模式，随平级元素一起退场）。
  const walls: FinishScopeInput['walls'] = [];
  for (const wall of MG.walls ?? []) {
    for (const band of wall.finish?.tile_bands ?? []) {
      walls.push({
        id: band.id, wall: wall.id, room: band.room,
        along: [Math.min(...band.along), Math.max(...band.along)],
        bottom: band.bottom ?? 0, top: band.height ?? 2.65,
        finish: 'tile', type: 'wall_region',
      });
    }
    for (const band of wall.finish?.paint_bands ?? []) {
      walls.push({
        id: band.id, wall: wall.id, room: band.room,
        along: [Math.min(...band.along), Math.max(...band.along)],
        bottom: band.bottom ?? 0, top: band.height ?? 2.8,
        finish: 'paint', type: 'paint_region',
      });
    }
  }

  const sills: FinishScopeInput['sills'] = [];
  for (const element of elements) {
    if (element.type !== 'bay_sill') continue;
    for (const band of element.finish?.tile ?? []) {
      sills.push({ id: band.id, element: element.id, room: band.room, faces: band.face ? [band.face] : [], finish: 'tile', type: 'sill_region' });
    }
    for (const band of element.finish?.paint ?? []) {
      sills.push({ id: band.id, element: element.id, room: band.room, faces: band.faces ?? [], finish: 'paint', type: 'paint_sill_region' });
    }
  }

  const rooms: FinishScopeInput['rooms'] = [];
  for (const raw of MG.rooms ?? []) {
    const points = (raw.boundary ?? []).map((id: string) => vertexById.get(id)).filter(Boolean) as Array<{ x: number; z: number }>;
    if (points.length >= 3) rooms.push({ id: raw.id, points });
  }

  const wallGeometry: FinishScopeInput['wallGeometry'] = {};
  for (const wall of layout.walls as any[]) {
    const polyline = wall.segments?.length ? wall.segments.map((s: any) => ({ x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2 })) : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    wallGeometry[wall.id] = {
      id: wall.id, polyline,
      length: polyline.reduce((sum: number, s: any) => sum + Math.hypot(s.x2 - s.x1, s.z2 - s.z1), 0),
      suppressed: Boolean(wall.suppressed),
      ...(wall.line_datum ? { line_datum: wall.line_datum } : {}),
    };
  }

  const ceilings: FinishScopeInput['ceilings'] = [];
  for (const zone of loadCeilingConfig() as any[]) {
    if (!zone.room) continue;
    ceilings.push({ id: zone.id, room: zone.room, type: zone.type, ...(zone.area ? { area: zone.area as [number, number, number, number] } : {}) });
  }
  const roomRects: FinishScopeInput['roomRects'] = (layout.rooms as any[]).map((room) => ({ id: room.id, x: room.x, z: room.z, width: room.width ?? 0, depth: room.depth ?? 0 }));
  // 顶面：只收显式声明的房间特征（S4 前是 paint_ceiling_region 元素）；不从墙面涂装房间集合推导。
  const ceilingPaintRooms = new Set<string>(
    (MG.rooms ?? []).filter((room: any) => room.ceiling_finish?.paint === true).map((room: any) => String(room.id)),
  );

  // 门/窗洞：resolved layout 的 openings 带世界坐标 x/z/width，投影统一走
  // shared/wall-segments.ts 的 openingsAlongWall（洞底标高 fail-closed：非门缺 sill 抛错）。
  const openings: FinishScopeInput['openings'] = [];
  for (const wall of layout.walls as any[]) {
    const polyline = wallGeometry[wall.id]?.polyline ?? [];
    for (const span of openingsAlongWall({
      x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2,
      ...(polyline.length ? { segments: polyline } : {}),
      openings: wall.openings ?? [],
    })) {
      openings.push({ id: span.id, wall: wall.id, kind: span.kind, from: span.from, to: span.to, bottom: span.bottom, top: span.top });
    }
  }

  // F08/F09 与测试共用同一份 buildScene 采集：声明 → 场景实体的对应关系只有一套。
  const scene = collectFinishSceneMeshes(layout as any);
  const config = loadFinishLintConfig();

  return {
    walls, sills, rooms, wallGeometry, ceilings, roomRects, ceilingPaintRooms, openings,
    sceneMeshIds: scene.meshIds, sceneCeilingRooms: scene.ceilingRooms,
    sceneMeshes: scene.meshes, sceneBayOutlines: scene.bayOutlines,
    tolerance: config.tolerance ?? tolerance, source: SOURCE,
  };
}

/**
 * 全部**面层配方** id（墙贴砖带/涂装带 + 防水台与飘窗的贴砖/涂装面 + S5 起派生的踢脚带）。
 *
 * 为什么单独导出一个集合：各 phase 的 control.yaml 成本项 `targets` 只收**对象** id
 * （issue #98 PR-8 的按对象算账），而面层配方是「宿主对象身上的派生量」——109 个配方
 * （18 砖带 + 31 漆带 + 28 窗台面 + 24 派生踢脚，S4 前还是 overlay 平级元素）一旦进 targets，
 * 按对象算账视图就被配方稀释（迁移设计 §5.7）。配方 id 与对象 id 都是稳定字符串，
 * **没有任何 schema 能区分**，只能由知道配方住在哪儿的本模块给出全集去拦。
 *
 * 与上面 buildFinishScopeInput 同一批读取、同一套枚举（不另写第二份配方清单）；
 * 派生踢脚直接取合并文档里的 skirting_region 元素 id（湿区不生成的不会出现）。
 */
export function collectFinishRecipeIds(): Set<string> {
  const ids = new Set<string>();
  const MG = readYaml('config/layout/model-geometry.yaml');
  for (const wall of MG.walls ?? []) {
    for (const band of wall.finish?.tile_bands ?? []) ids.add(String(band.id));
    for (const band of wall.finish?.paint_bands ?? []) ids.add(String(band.id));
  }
  for (const element of (loadOverlayDoc().elements ?? []) as any[]) {
    if (element.type === 'skirting_region') {
      ids.add(String(element.id));
      continue;
    }
    if (element.type !== 'bay_sill') continue;
    for (const band of element.finish?.tile ?? []) ids.add(String(band.id));
    for (const band of element.finish?.paint ?? []) ids.add(String(band.id));
  }
  return ids;
}
