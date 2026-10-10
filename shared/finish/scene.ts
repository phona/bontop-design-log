/**
 * F08 的场景采集：buildScene 实际产出了哪些面层网格。
 *
 * 声明是一回事，**场景里有没有实体是另一回事**。`computePaintScope` 照样按声明算面积
 * 进预算，而 3D 里那块什么都没有——预算算了钱、现场找不到活儿。所以要把「声明 → 场景
 * 实体」的对应关系做成门禁级检查，而不仅靠测试断言 `report.unsupported` 为空。
 *
 * 与 `shared/penetration/scene.ts` 同构：verifier 与测试共用同一份采集，结论不会漂移。
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { buildScene } from '../render/SceneBuilder.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

export interface FinishSceneMeshes {
  /** buildScene 产出的全部 objectId。门洞会把一段声明拆成 `${id}:s${n}`。 */
  meshIds: Set<string>;
  /** 有 ceiling 网格的房间（objectId = `ceiling:<room>`）。 */
  ceilingRooms: Set<string>;
}

export function collectFinishSceneMeshes(layout: { walls: unknown[]; rooms: unknown[] }): FinishSceneMeshes {
  const overlay = parseOverlay(readFileSync(path.join(ROOT, 'config/layout/overlay.yaml'), 'utf8'));
  const elements = mergeSceneElements(layout.walls as any, overlay);
  const scene = buildScene({ walls: layout.walls, rooms: layout.rooms, elements: elements as any, furnishings: {} } as any);
  const root: any = (scene as any).exportRoot ?? (scene as any).root ?? scene;
  const meshIds = new Set<string>();
  const ceilingRooms = new Set<string>();
  root.traverse((object: any) => {
    const objectId = object?.userData?.objectId as string | undefined;
    if (objectId) meshIds.add(objectId);
    if (object?.userData?.type === 'ceiling' && objectId?.startsWith('ceiling:')) {
      ceilingRooms.add(objectId.slice('ceiling:'.length));
    }
  });
  return { meshIds, ceilingRooms };
}
